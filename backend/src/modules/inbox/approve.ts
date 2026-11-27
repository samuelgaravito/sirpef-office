import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documents,
  users,
  type DocumentMessageRow,
  type DocumentRow,
} from '../../db/schema.js';
import { assertDocumentDataComplete } from '../../lib/document-data.js';
import { assertDocumentMutable } from '../../lib/access.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { logActivity } from '../../lib/activity.js';
import { numberDocumentInTx } from '../../lib/counter.js';
import type { DbExecutor } from '../../lib/numbering.js';
import { badRequest, conflict, internal, notFound } from '../../lib/errors.js';
import { saveVersion } from '../../lib/versions.js';
import { publishDocumentEvent, publishInboxEvent } from '../realtime/events.js';

export interface ApproveMessageInput {
  user: AuthenticatedUser;
  messageId: string;
  expectedVersion: number;
  subject?: string;
  body?: string;
  allowSenderExport: boolean;
  recipientIds?: string[];
}

export interface ApproveInTxResult {
  message: DocumentMessageRow;
  document: DocumentRow;
  docNumber: string | null;
  subject: string;
  recipientIds: string[];
}

export interface ApproveMessageResult {
  message: DocumentMessageRow;
  documentId: string;
  docNumber: string | null;
  subject: string;
  recipientIds: string[];
}

/**
 * Aprueba un envío pendiente y asigna su correlativo **dentro de la
 * transacción del llamador**. No publica eventos ni guarda versión: eso se
 * hace después del commit con `publishApprovalEffects`.
 *
 * Se usa tanto en la aprobación simple (scripts) como en la aprobación con
 * firma atómica de la app móvil.
 */
export async function approveInTx(
  tx: DbExecutor,
  input: ApproveMessageInput,
): Promise<ApproveInTxResult> {
  const {
    user,
    messageId,
    expectedVersion,
    allowSenderExport,
    recipientIds: requestedRecipients,
  } = input;

  const [message] = await tx
    .select()
    .from(documentMessages)
    .where(eq(documentMessages.id, messageId))
    .for('update')
    .limit(1);

  if (!message) throw notFound('Mensaje no encontrado');
  if (message.status !== 'pending_approval') {
    throw conflict('Este envío ya fue procesado');
  }

  const [document] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, message.documentId))
    .for('update')
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
  let recipientIds: string[];

  if (requestedRecipients) {
    recipientIds = [...new Set(requestedRecipients)];
    if (recipientIds.length === 0) throw badRequest('Selecciona al menos un destinatario');

    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, recipientIds), eq(users.isActive, true)));
    if (rows.length !== recipientIds.length) {
      throw badRequest('Uno o más destinatarios no existen o están inactivos');
    }

    await tx
      .delete(documentMessageRecipients)
      .where(eq(documentMessageRecipients.messageId, messageId));
    await tx
      .insert(documentMessageRecipients)
      .values(recipientIds.map((userId) => ({ messageId, userId })));
  } else {
    const currentRecipients = await tx
      .select({ userId: documentMessageRecipients.userId })
      .from(documentMessageRecipients)
      .where(eq(documentMessageRecipients.messageId, messageId));
    recipientIds = currentRecipients.map((row) => row.userId);
  }

  if (recipientIds.length === 0) {
    throw badRequest('El envío no tiene destinatarios');
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

  // El correlativo se reserva en la misma transacción. No toca `data`.
  const docNumber = await numberDocumentInTx(tx, document.id);

  const [updatedDocument] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, document.id))
    .limit(1);
  if (!updatedDocument) {
    throw internal('APPROVE_DOCUMENT_MISSING', 'No se pudo recargar el documento aprobado');
  }

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

  return {
    message: approved,
    document: updatedDocument,
    docNumber,
    subject: approved.subject,
    recipientIds,
  };
}

/** Efectos posteriores al commit de una aprobación. */
export async function publishApprovalEffects(
  result: ApproveInTxResult,
  user: AuthenticatedUser,
): Promise<void> {
  const { message, document, recipientIds } = result;

  await saveVersion(document.id, user.sub, 'manual', 'Aprobado y enviado');
  await logActivity(user.sub, 'document', document.id, 'approved', {
    messageId: message.id,
    version: document.version,
  });
  await logActivity(user.sub, 'document', document.id, 'sent', { messageId: message.id });

  await publishInboxEvent({
    type: 'inbox.message.approved',
    userIds: recipientIds,
    messageId: message.id,
    documentId: document.id,
    documentTitle: document.title,
    subject: message.subject,
    actorId: user.sub,
    actorName: user.name,
    status: 'sent',
  });
  await publishInboxEvent({
    type: 'inbox.result.approved',
    userIds: [message.senderId],
    messageId: message.id,
    documentId: document.id,
    documentTitle: document.title,
    subject: message.subject,
    actorId: user.sub,
    actorName: user.name,
    status: 'sent',
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
    status: 'sent',
  });
  await publishDocumentEvent({
    type: 'document.locked',
    documentId: document.id,
    documentTitle: document.title,
    actorId: user.sub,
    actorName: user.name,
    version: document.version,
    updatedAt: new Date().toISOString(),
    change: 'lock',
    status: 'sent',
  });
}

/**
 * Aprueba un envío pendiente y le asigna su correlativo.
 *
 * Se conserva para scripts y flujos internos. La app móvil usa
 * `approveAndSeal`, que hace aprobación + firma + certificado en una sola
 * transacción.
 */
export async function approveMessage(input: ApproveMessageInput): Promise<ApproveMessageResult> {
  const result = await db.transaction((tx) => approveInTx(tx, input));
  await publishApprovalEffects(result, input.user);

  return {
    message: result.message,
    documentId: result.document.id,
    docNumber: result.docNumber,
    subject: result.subject,
    recipientIds: result.recipientIds,
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
