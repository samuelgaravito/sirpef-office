import { and, eq } from 'drizzle-orm';

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
 *
 * - El **administrador** puede exportar los documentos a los que tenga acceso:
 *   los abiertos sin restricción y los sellados si es el que aprobó/rechazó
 *   el envío o si es destinatario.
 * - El **asistente** solo puede exportar si el administrador lo autorizó
 *   explícitamente al aprobar el envío (`allow_sender_export`). Un borrador
 *   nunca está autorizado: para obtener una copia el jefe tiene que aprobar
 *   el envío y marcar «el asistente también podrá exportarlo».
 */
export async function canExportDocument(
  userId: string,
  role: UserRole,
  doc: Pick<DocumentRow, 'id' | 'lockedAt' | 'status'>,
): Promise<boolean> {
  if (role === 'admin') {
    if (!isDocumentLocked(doc)) return true;

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

  // Autorización explícita del administrador sobre el envío del documento.
  const [authorized] = await db
    .select({ id: documentMessages.id })
    .from(documentMessages)
    .where(
      and(
        eq(documentMessages.documentId, doc.id),
        eq(documentMessages.status, 'sent'),
        eq(documentMessages.senderId, userId),
        eq(documentMessages.allowSenderExport, true),
      ),
    )
    .limit(1);

  return Boolean(authorized);
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
