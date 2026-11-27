import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { documentMessages, documents } from '../../db/schema.js';
import { logActivity } from '../../lib/activity.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { saveVersion } from '../../lib/versions.js';
import { publishDocumentEvent, publishInboxEvent } from '../realtime/events.js';
import { verifyUserTotp } from '../token/service.js';

export interface AnnulMessageInput {
  user: AuthenticatedUser;
  messageId: string;
  expectedVersion: number;
  reason: string | null;
  /** Código de SirpefOffice Token; obligatorio. */
  code: string;
}

export interface AnnulMessageResult {
  ok: true;
  id: string;
  status: 'cancelled';
}

/**
 * Anula un memo aprobado y enviado.
 *
 * Solo puede hacerlo el administrador que lo aprobó, y exige un código de
 * SirpefOffice Token. El memo conserva su número y su sello, pero pasa a
 * «Anulado» y deja de mostrarse a los destinatarios.
 */
export async function annulMessage(input: AnnulMessageInput): Promise<AnnulMessageResult> {
  const { user } = input;
  if (user.role !== 'admin') {
    throw forbidden('Solo un administrador puede anular un documento');
  }

  const [message] = await db
    .select()
    .from(documentMessages)
    .where(eq(documentMessages.id, input.messageId))
    .limit(1);

  if (!message) throw notFound('Mensaje no encontrado');
  if (message.status !== 'sent' || !message.sentAt) {
    throw conflict('Solo se puede anular un memo aprobado y enviado');
  }
  if (message.approvedById !== user.sub) {
    throw forbidden('Solo el administrador que aprobó este documento puede anularlo');
  }
  if (message.annulledAt) {
    throw conflict('Este memo ya fue anulado');
  }

  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, message.documentId))
    .limit(1);

  if (!document || document.deletedAt) throw notFound('Documento no encontrado');
  if (document.version !== input.expectedVersion) {
    throw conflict('El documento cambió desde que lo abriste', {
      currentVersion: document.version,
    });
  }

  const totp = await verifyUserTotp({
    userId: user.sub,
    code: input.code,
    purpose: 'annul',
  });

  const now = new Date();
  const reason = input.reason && input.reason.length > 0 ? input.reason : null;

  await db.transaction(async (tx) => {
    await tx
      .update(documentMessages)
      .set({
        status: 'cancelled',
        annulledAt: now,
        annulledReason: reason,
        updatedAt: now,
      })
      .where(eq(documentMessages.id, message.id));

    // El memo sigue sellado y conserva su número: solo queda marcado como
    // anulado.
    await tx
      .update(documents)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(documents.id, document.id));
  });

  await saveVersion(document.id, user.sub, 'manual', 'Anulado');
  await logActivity(user.sub, 'document', document.id, 'annulled', {
    messageId: message.id,
    reason,
    totpStep: totp.step,
  });

  await publishInboxEvent({
    type: 'inbox.message.annulled',
    userIds: [message.senderId, user.sub],
    messageId: message.id,
    documentId: document.id,
    documentTitle: document.title,
    subject: message.subject,
    actorId: user.sub,
    actorName: user.name,
    status: 'cancelled',
  });

  await publishDocumentEvent({
    type: 'document.updated',
    documentId: document.id,
    documentTitle: document.title,
    actorId: user.sub,
    actorName: user.name,
    version: document.version,
    updatedAt: now.toISOString(),
    change: 'status',
    status: 'cancelled',
  });

  return { ok: true, id: message.id, status: 'cancelled' };
}
