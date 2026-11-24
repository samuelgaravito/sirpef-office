import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documents,
  users,
  type DocumentMessageRow,
} from '../../db/schema.js';
import { assertDocumentDataComplete } from '../../lib/document-data.js';
import { assertDocumentMutable } from '../../lib/access.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { logActivity } from '../../lib/activity.js';
import { numberDocumentInTx } from '../../lib/counter.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { saveVersion } from '../../lib/versions.js';
import { publishInboxEvent } from '../realtime/events.js';

export interface ApproveMessageInput {
  user: AuthenticatedUser;
  messageId: string;
  expectedVersion: number;
  subject?: string;
  body?: string;
  allowSenderExport: boolean;
  recipientIds?: string[];
}

export interface ApproveMessageResult {
  message: DocumentMessageRow;
  documentId: string;
  docNumber: string | null;
  subject: string;
  recipientIds: string[];
}

/**
 * Aprueba un envío pendiente, sella el documento y asigna su correlativo.
 * Vive fuera de la ruta para que la app móvil pueda reutilizarlo antes de
 * estampar la firma sin duplicar la lógica de negocio.
 */
export async function approveMessage(input: ApproveMessageInput): Promise<ApproveMessageResult> {
  const { user, messageId, expectedVersion, allowSenderExport } = input;

  const [message] = await db
    .select()
    .from(documentMessages)
    .where(eq(documentMessages.id, messageId))
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
  await assertDocumentDataComplete(document);

  if (document.version !== expectedVersion) {
    throw conflict('El documento cambió desde que lo abriste', {
      currentVersion: document.version,
    });
  }

  const now = new Date();
  let assignedDocNumber: string | null = null;

  let recipientIds: string[];
  if (input.recipientIds) {
    recipientIds = [...new Set(input.recipientIds)];
    if (recipientIds.length === 0) throw badRequest('Selecciona al menos un destinatario');
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, recipientIds), eq(users.isActive, true)));
    if (rows.length !== recipientIds.length) {
      throw badRequest('Uno o más destinatarios no existen o están inactivos');
    }
  } else {
    const currentRecipients = await db
      .select({ userId: documentMessageRecipients.userId })
      .from(documentMessageRecipients)
      .where(eq(documentMessageRecipients.messageId, messageId));
    recipientIds = currentRecipients.map((row) => row.userId);
  }

  if (recipientIds.length === 0) {
    throw badRequest('El envío no tiene destinatarios');
  }

  await db.transaction(async (tx) => {
    if (input.recipientIds) {
      await tx
        .delete(documentMessageRecipients)
        .where(eq(documentMessageRecipients.messageId, messageId));
      await tx
        .insert(documentMessageRecipients)
        .values(recipientIds.map((userId) => ({ messageId, userId })));
    }

    await tx
      .update(documentMessages)
      .set({
        status: 'sent',
        subject: input.subject ?? message.subject,
        body: input.body ?? message.body,
        approvedById: user.sub,
        approvedAt: now,
        sentAt: now,
        allowSenderExport,
        documentVersion: document.version,
        updatedAt: now,
      })
      .where(eq(documentMessages.id, messageId));

    await tx
      .update(documents)
      .set({ status: 'sent', lockedAt: now, lockedBy: user.sub, updatedAt: now })
      .where(eq(documents.id, document.id));

    // Aprobación: el memo se sella y recibe su número correlativo de forma
    // atómica con el cambio de estado. Si ya tenía número, es idempotente.
    assignedDocNumber = await numberDocumentInTx(tx, document.id);

    await tx
      .insert(documentShares)
      .values(
        recipientIds.map((userId) => ({
          documentId: document.id,
          userId,
          permission: 'viewer' as const,
        })),
      )
      .onConflictDoNothing();
  });

  const approved: DocumentMessageRow = {
    ...message,
    status: 'sent',
    subject: input.subject ?? message.subject,
    body: input.body ?? message.body,
    approvedById: user.sub,
    approvedAt: now,
    sentAt: now,
    allowSenderExport,
    documentVersion: document.version,
    updatedAt: now,
  };

  await saveVersion(document.id, user.sub, 'manual', 'Aprobado y enviado');
  await logActivity(user.sub, 'document', document.id, 'approved', {
    messageId,
    version: document.version,
  });
  await logActivity(user.sub, 'document', document.id, 'sent', { messageId });

  const subject = approved.subject;
  await publishInboxEvent({
    type: 'inbox.message.approved',
    userIds: recipientIds,
    messageId,
    documentId: document.id,
    documentTitle: document.title,
    subject,
    actorName: user.name,
    status: 'sent',
  });
  await publishInboxEvent({
    type: 'inbox.result.approved',
    userIds: [message.senderId],
    messageId,
    documentId: document.id,
    documentTitle: document.title,
    subject,
    actorName: user.name,
    status: 'sent',
  });

  return {
    message: approved,
    documentId: document.id,
    docNumber: assignedDocNumber,
    subject,
    recipientIds,
  };
}

/** Comprueba que el usuario sea el aprobador de un envío ya sellado. */
export async function assertApproverForDocument(
  userId: string,
  documentId: string,
): Promise<DocumentMessageRow> {
  const [message] = await db
    .select()
    .from(documentMessages)
    .where(
      and(
        eq(documentMessages.documentId, documentId),
        eq(documentMessages.approvedById, userId),
        inArray(documentMessages.status, ['sent']),
      ),
    )
    .limit(1);

  if (!message) {
    throw notFound('No eres el aprobador de este documento');
  }
  return message;
}
