import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  documentEmergencyEdits,
  documentMessageRecipients,
  documentMessages,
  documentSignatures,
  documents,
  signatureCertificates,
  type DocumentRow,
} from '../../db/schema.js';
import { logActivity } from '../../lib/activity.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { assertDocumentDataComplete } from '../../lib/document-data.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { canonicalContentHash } from '../../lib/signature.js';
import { saveVersion } from '../../lib/versions.js';
import { verifyUserTotp } from '../token/service.js';
import { publishDocumentEvent } from '../realtime/events.js';

const EMERGENCY_TTL_MS = 30 * 60 * 1000;

export interface EmergencyEditResult {
  emergencyEditId: string;
  expiresAt: string;
  version: number;
}

async function loadDocument(documentId: string): Promise<DocumentRow> {
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  if (!document) throw notFound('Documento no encontrado');
  return document;
}

/** Aprobador vigente: autor del último mensaje `sent`. */
export async function currentApproverId(documentId: string): Promise<string | null> {
  const [message] = await db
    .select({ approvedById: documentMessages.approvedById })
    .from(documentMessages)
    .where(
      and(
        eq(documentMessages.documentId, documentId),
        eq(documentMessages.status, 'sent'),
      ),
    )
    .orderBy(desc(documentMessages.approvedAt))
    .limit(1);
  return message?.approvedById ?? null;
}

async function assertApprover(user: AuthenticatedUser, document: DocumentRow): Promise<void> {
  if (user.role !== 'admin') {
    throw forbidden('Solo un administrador puede editar de emergencia');
  }
  const approverId = await currentApproverId(document.id);
  if (approverId === user.sub) return;

  // Mientras la emergencia está abierta, el mensaje `sent` anterior ya pasó a
  // `superseded`; la autorización se conserva en la propia fila de emergencia.
  const [open] = await db
    .select({ id: documentEmergencyEdits.id })
    .from(documentEmergencyEdits)
    .where(
      and(
        eq(documentEmergencyEdits.documentId, document.id),
        eq(documentEmergencyEdits.requestedBy, user.sub),
        inArray(documentEmergencyEdits.status, ['open']),
      ),
    )
    .limit(1);
  if (open) return;

  throw new AppError(
    403,
    'EMERGENCY_EDIT_NOT_APPROVER',
    'Solo el administrador que aprobó este documento puede editarlo de emergencia.',
  );
}


export async function activeEmergencyEdit(
  userId: string,
  documentId: string,
): Promise<typeof documentEmergencyEdits.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(documentEmergencyEdits)
    .where(
      and(
        eq(documentEmergencyEdits.documentId, documentId),
        eq(documentEmergencyEdits.requestedBy, userId),
        eq(documentEmergencyEdits.status, 'open'),
      ),
    )
    .orderBy(desc(documentEmergencyEdits.startedAt))
    .limit(1);
  return row ?? null;
}

export async function assertEmergencyEditor(
  user: AuthenticatedUser,
  documentId: string,
): Promise<{
  document: DocumentRow;
  edit: typeof documentEmergencyEdits.$inferSelect;
}> {
  const document = await loadDocument(documentId);
  await assertApprover(user, document);
  const edit = await activeEmergencyEdit(user.sub, documentId);
  if (!edit) {
    throw new AppError(
      403,
      'EMERGENCY_EDIT_REQUIRED',
      'Abre una edición de emergencia antes de guardar este documento.',
    );
  }
  if (edit.expiresAt.getTime() <= Date.now()) {
    throw new AppError(
      403,
      'EMERGENCY_EDIT_EXPIRED',
      'La ventana de edición de emergencia expiró. Termínala para enviar los cambios.',
    );
  }
  return { document, edit };
}

export async function startEmergencyEdit(input: {
  user: AuthenticatedUser;
  documentId: string;
  reason: string;
  expectedVersion: number;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<EmergencyEditResult> {
  const document = await loadDocument(input.documentId);
  if (!document.lockedAt && document.status !== 'sent') {
    throw conflict('Este documento no está aprobado y bloqueado');
  }
  await assertApprover(input.user, document);
  await assertDocumentDataComplete(document);

  if (document.version !== input.expectedVersion) {
    throw conflict('El documento cambió desde que lo abriste', {
      currentVersion: document.version,
    });
  }
  const existing = await activeEmergencyEdit(input.user.sub, document.id);
  if (existing) {
    if (existing.expiresAt.getTime() > Date.now()) {
      throw conflict('Ya hay una edición de emergencia abierta para este documento');
    }
    // Una ventana vencida no debe impedir volver a autorizar la edición.
    await db
      .update(documentEmergencyEdits)
      .set({ status: 'cancelled', cancelledAt: new Date(), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(documentEmergencyEdits.id, existing.id));
  }

  const totp = await verifyUserTotp({
    userId: input.user.sub,
    code: input.code,
    purpose: 'emergency-edit',
  });

  const [message] = await db
    .select({ id: documentMessages.id })
    .from(documentMessages)
    .where(
      and(
        eq(documentMessages.documentId, document.id),
        eq(documentMessages.status, 'sent'),
      ),
    )
    .orderBy(desc(documentMessages.approvedAt))
    .limit(1);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMERGENCY_TTL_MS);
  const [edit] = await db
    .insert(documentEmergencyEdits)
    .values({
      documentId: document.id,
      requestedBy: input.user.sub,
      originalMessageId: message?.id ?? null,
      reason: input.reason.trim(),
      previousStatus: document.status,
      previousVersion: document.version,
      previousLockedAt: document.lockedAt,
      previousLockedBy: document.lockedBy,
      previousDocNumber: document.docNumber,
      beforeContentSha256: canonicalContentHash(document),
      startedAt: now,
      expiresAt,
      reauthMethod: 'totp',
      totpStep: totp.step,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      status: 'open',
      updatedAt: now,
    })
    .returning();

  if (!edit) throw conflict('No se pudo abrir la edición de emergencia');

  await logActivity(input.user.sub, 'document', document.id, 'emergency_edit_started', {
    emergencyEditId: edit.id,
    reason: edit.reason,
    previousVersion: document.version,
    totpStep: totp.step,
  });

  await publishDocumentEvent({
    type: 'document.updated',
    documentId: document.id,
    documentTitle: document.title,
    actorId: input.user.sub,
    actorName: input.user.name,
    version: document.version,
    updatedAt: now.toISOString(),
    change: 'metadata',
    status: document.status,
  });

  return {
    emergencyEditId: edit.id,
    expiresAt: expiresAt.toISOString(),
    version: document.version,
  };
}

/**
 * Primer guardado con cambios: el documento deja de estar sellado, las firmas
 * anteriores quedan supersedidas y el envío antiguo deja de mostrarse como
 * vigente. Todo ocurre en una transacción.
 */
export async function markEmergencyChanged(input: {
  user: AuthenticatedUser;
  document: DocumentRow;
  edit: typeof documentEmergencyEdits.$inferSelect;
}): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(documentSignatures)
      .set({
        status: 'superseded',
        supersededAt: now,
        supersededReason: input.edit.reason,
      })
      .where(
        and(
          eq(documentSignatures.documentId, input.document.id),
          eq(documentSignatures.status, 'sealed'),
        ),
      );

    await tx
      .update(signatureCertificates)
      .set({
        supersededAt: now,
        supersededReason: input.edit.reason,
        supersededBy: input.user.sub,
      })
      .where(
        and(
          eq(signatureCertificates.documentId, input.document.id),
          isNull(signatureCertificates.supersededAt),
        ),
      );

    await tx
      .update(documentMessages)
      .set({ status: 'superseded', updatedAt: now })
      .where(
        and(
          eq(documentMessages.documentId, input.document.id),
          eq(documentMessages.status, 'sent'),
        ),
      );

    await tx
      .update(documents)
      .set({
        status: 'in_review',
        lockedAt: null,
        lockedBy: null,
        emergencyEditOpen: true,
        emergencyEditCount: input.document.emergencyEditCount + 1,
        updatedAt: now,
      })
      .where(eq(documents.id, input.document.id));
  });

  await saveVersion(
    input.document.id,
    input.user.sub,
    'emergency',
    `Edición de emergencia: ${input.edit.reason}`,
  );
  await logActivity(input.user.sub, 'document', input.document.id, 'emergency_edit_changed', {
    emergencyEditId: input.edit.id,
    reason: input.edit.reason,
    beforeVersion: input.document.version,
  });
}

export async function finishEmergencyEdit(input: {
  user: AuthenticatedUser;
  documentId: string;
  editId: string;
}): Promise<{ changed: boolean; messageId: string | null; version: number }> {
  const document = await loadDocument(input.documentId);
  await assertApprover(input.user, document);

  const [edit] = await db
    .select()
    .from(documentEmergencyEdits)
    .where(
      and(
        eq(documentEmergencyEdits.id, input.editId),
        eq(documentEmergencyEdits.documentId, document.id),
        eq(documentEmergencyEdits.requestedBy, input.user.sub),
        eq(documentEmergencyEdits.status, 'open'),
      ),
    )
    .limit(1);
  if (!edit) throw notFound('Edición de emergencia no encontrada o cerrada');

  const afterHash = canonicalContentHash(document);
  const changed = afterHash !== edit.beforeContentSha256;
  const now = new Date();

  if (!changed) {
    await db
      .update(documentEmergencyEdits)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        finishedAt: now,
        afterContentSha256: afterHash,
        resultVersion: document.version,
        updatedAt: now,
      })
      .where(eq(documentEmergencyEdits.id, edit.id));
    await logActivity(input.user.sub, 'document', document.id, 'emergency_edit_cancelled', {
      emergencyEditId: edit.id,
      reason: 'Sin cambios',
    });
    return { changed: false, messageId: null, version: document.version };
  }

  const [original] = edit.originalMessageId
    ? await db
        .select()
        .from(documentMessages)
        .where(eq(documentMessages.id, edit.originalMessageId))
        .limit(1)
    : [];

  const recipients = original
    ? await db
        .select({ userId: documentMessageRecipients.userId })
        .from(documentMessageRecipients)
        .where(eq(documentMessageRecipients.messageId, original.id))
    : [];

  const [message] = await db
    .insert(documentMessages)
    .values({
      documentId: document.id,
      senderId: original?.senderId ?? input.user.sub,
      subject: `REVISIÓN DE EMERGENCIA · ${original?.subject ?? document.title}`,
      body: edit.reason,
      status: 'pending_approval',
      documentVersion: document.version,
      allowSenderEdit: false,
      allowSenderExport: original?.allowSenderExport ?? false,
    })
    .returning();

  if (!message) throw conflict('No se pudo crear la revisión de emergencia');

  if (recipients.length > 0) {
    await db
      .insert(documentMessageRecipients)
      .values(recipients.map((recipient) => ({ messageId: message.id, userId: recipient.userId })))
      .onConflictDoNothing();
  }

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({
        status: 'in_review',
        emergencyEditOpen: false,
        updatedAt: now,
      })
      .where(eq(documents.id, document.id));

    await tx
      .update(documentEmergencyEdits)
      .set({
        status: 'finished',
        finishedAt: now,
        afterContentSha256: afterHash,
        resultVersion: document.version,
        resultMessageId: message.id,
        updatedAt: now,
      })
      .where(eq(documentEmergencyEdits.id, edit.id));
  });

  await logActivity(input.user.sub, 'document', document.id, 'emergency_edit_finished', {
    emergencyEditId: edit.id,
    reason: edit.reason,
    messageId: message.id,
    version: document.version,
  });

  await publishDocumentEvent({
    type: 'document.updated',
    documentId: document.id,
    documentTitle: document.title,
    actorId: input.user.sub,
    actorName: input.user.name,
    version: document.version,
    updatedAt: now.toISOString(),
    change: 'status',
    status: 'in_review',
  });

  return { changed: true, messageId: message.id, version: document.version };
}

export async function cancelEmergencyEdit(input: {
  user: AuthenticatedUser;
  documentId: string;
  editId: string;
}): Promise<{ ok: true }> {
  const document = await loadDocument(input.documentId);
  await assertApprover(input.user, document);

  const [edit] = await db
    .select()
    .from(documentEmergencyEdits)
    .where(
      and(
        eq(documentEmergencyEdits.id, input.editId),
        eq(documentEmergencyEdits.documentId, document.id),
        eq(documentEmergencyEdits.requestedBy, input.user.sub),
        eq(documentEmergencyEdits.status, 'open'),
      ),
    )
    .limit(1);
  if (!edit) throw notFound('Edición de emergencia no encontrada o cerrada');

  if (canonicalContentHash(document) !== edit.beforeContentSha256) {
    throw conflict('Ya hay cambios guardados; termina la edición y envía la revisión');
  }

  const now = new Date();
  await db
    .update(documentEmergencyEdits)
    .set({ status: 'cancelled', cancelledAt: now, finishedAt: now, updatedAt: now })
    .where(eq(documentEmergencyEdits.id, edit.id));

  await logActivity(input.user.sub, 'document', document.id, 'emergency_edit_cancelled', {
    emergencyEditId: edit.id,
    reason: edit.reason,
  });
  return { ok: true };
}

export async function listEmergencyEdits(documentId: string) {
  return db
    .select()
    .from(documentEmergencyEdits)
    .where(eq(documentEmergencyEdits.documentId, documentId))
    .orderBy(desc(documentEmergencyEdits.startedAt));
}
