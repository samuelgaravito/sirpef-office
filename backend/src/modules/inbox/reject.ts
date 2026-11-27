import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { documentMessages, documents } from '../../db/schema.js';
import { assertDocumentMutable } from '../../lib/access.js';
import { logActivity } from '../../lib/activity.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { conflict, notFound } from '../../lib/errors.js';
import { publishDocumentEvent, publishInboxEvent } from '../realtime/events.js';

export interface RejectMessageInput {
  user: AuthenticatedUser;
  messageId: string;
  reason: string;
  allowEdit: boolean;
}

export interface RejectMessageResult {
  ok: true;
  id: string;
  status: 'rejected';
  allowEdit: boolean;
}

/**
 * Devuelve el documento al asistente con un motivo.
 *
 * Es una decisión exclusiva de la app móvil de firma.
 */
export async function rejectMessage(input: RejectMessageInput): Promise<RejectMessageResult> {
  const { user } = input;

  const [message] = await db
    .select()
    .from(documentMessages)
    .where(eq(documentMessages.id, input.messageId))
    .limit(1);

  if (!message) throw notFound('Mensaje no encontrado');
  if (message.status !== 'pending_approval') {
    throw conflict('Este envío ya fue procesado');
  }

  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, message.documentId))
    .limit(1);

  if (!document || document.deletedAt) throw notFound('Documento no encontrado');
  assertDocumentMutable(document);

  const now = new Date();
  const allowEdit = input.allowEdit;

  await db.transaction(async (tx) => {
    await tx
      .update(documentMessages)
      .set({
        status: 'rejected',
        rejectedReason: input.reason,
        allowSenderEdit: allowEdit,
        approvedById: user.sub,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(documentMessages.id, message.id));

    await tx
      .update(documents)
      .set({
        status: allowEdit ? 'draft' : 'rejected',
        lockedAt: allowEdit ? null : now,
        lockedBy: allowEdit ? null : user.sub,
        updatedAt: now,
      })
      .where(eq(documents.id, document.id));
  });

  await logActivity(user.sub, 'document', document.id, 'rejected', {
    messageId: message.id,
    reason: input.reason,
    allowEdit,
  });

  await publishInboxEvent({
    type: 'inbox.result.rejected',
    userIds: [message.senderId],
    messageId: message.id,
    documentId: document.id,
    documentTitle: document.title,
    subject: message.subject,
    actorId: user.sub,
    actorName: user.name,
    status: 'rejected',
  });

  await publishInboxEvent({
    type: 'inbox.message.reviewed',
    userIds: [user.sub],
    messageId: message.id,
    documentId: document.id,
    documentTitle: document.title,
    subject: message.subject,
    actorId: user.sub,
    actorName: user.name,
    status: 'rejected',
  });

  await publishDocumentEvent({
    type: allowEdit ? 'document.updated' : 'document.locked',
    documentId: document.id,
    documentTitle: document.title,
    actorId: user.sub,
    actorName: user.name,
    version: document.version,
    updatedAt: now.toISOString(),
    change: allowEdit ? 'status' : 'lock',
    status: allowEdit ? 'draft' : 'rejected',
  });

  return { ok: true, id: message.id, status: 'rejected', allowEdit };
}
