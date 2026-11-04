import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import {
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documents,
  type DocumentRow,
} from '../db/schema.js';
import { forbidden, locked, notFound } from './errors.js';

export type Permission = 'owner' | 'editor' | 'viewer';
export type UserRole = 'admin' | 'member';

const RANK: Record<Permission, number> = { viewer: 1, editor: 2, owner: 3 };

/** Un documento enviado (o sellado explícitamente) es de solo lectura. */
export function isDocumentLocked(doc: Pick<DocumentRow, 'lockedAt' | 'status'>): boolean {
  return doc.lockedAt !== null || doc.status === 'sent';
}

/** Impide cualquier escritura sobre un documento ya aprobado y enviado. */
export function assertDocumentMutable(doc: DocumentRow): void {
  if (isDocumentLocked(doc)) {
    throw locked();
  }
}

/**
 * Determina si el usuario puede exportar el documento.
 * Los documentos abiertos puede exportarlos cualquier usuario con acceso.
 * Los sellados quedan reservados al administrador que aprobó/rechazó el envío,
 * a los administradores destinatarios y, si se autorizó al aprobar, al remitente.
 */
export async function canExportDocument(
  userId: string,
  role: UserRole,
  doc: Pick<DocumentRow, 'id' | 'lockedAt' | 'status'>,
): Promise<boolean> {
  if (!isDocumentLocked(doc)) return true;

  if (role === 'admin') {
    const [approver] = await db
      .select({ id: documentMessages.id })
      .from(documentMessages)
      .where(
        and(
          eq(documentMessages.documentId, doc.id),
          eq(documentMessages.approvedById, userId),
        ),
      )
      .limit(1);
    if (approver) return true;

    const [recipient] = await db
      .select({ messageId: documentMessageRecipients.messageId })
      .from(documentMessageRecipients)
      .innerJoin(documentMessages, eq(documentMessages.id, documentMessageRecipients.messageId))
      .where(
        and(
          eq(documentMessages.documentId, doc.id),
          eq(documentMessages.status, 'sent'),
          eq(documentMessageRecipients.userId, userId),
        ),
      )
      .limit(1);
    if (recipient) return true;
  }

  const [latestSent] = await db
    .select({
      senderId: documentMessages.senderId,
      allowSenderExport: documentMessages.allowSenderExport,
    })
    .from(documentMessages)
    .where(
      and(
        eq(documentMessages.documentId, doc.id),
        eq(documentMessages.status, 'sent'),
      ),
    )
    .orderBy(desc(documentMessages.sentAt), desc(documentMessages.createdAt))
    .limit(1);

  return Boolean(
    latestSent && latestSent.senderId === userId && latestSent.allowSenderExport,
  );
}

/**
 * Devuelve el documento y el permiso efectivo del usuario.
 * Si no tiene acceso se responde 404 para no filtrar la existencia de documentos.
 */
export async function getDocumentAccess(
  userId: string,
  documentId: string,
): Promise<{ document: DocumentRow; permission: Permission }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);

  if (!doc || doc.deletedAt) throw notFound('Documento no encontrado');

  if (doc.ownerId === userId) return { document: doc, permission: 'owner' };

  const [share] = await db
    .select()
    .from(documentShares)
    .where(and(eq(documentShares.documentId, documentId), eq(documentShares.userId, userId)))
    .limit(1);

  if (!share) throw notFound('Documento no encontrado');

  return { document: doc, permission: share.permission };
}

/** Exige un permiso mínimo ('viewer' < 'editor' < 'owner'). */
export async function assertDocument(
  userId: string,
  documentId: string,
  minimum: Permission,
): Promise<{ document: DocumentRow; permission: Permission }> {
  const access = await getDocumentAccess(userId, documentId);
  if (RANK[access.permission] < RANK[minimum]) {
    throw forbidden(
      minimum === 'owner'
        ? 'Solo el propietario puede realizar esta acción'
        : 'Necesitas permiso de edición sobre este documento',
    );
  }
  return access;
}
