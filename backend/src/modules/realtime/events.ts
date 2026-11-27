import { eq } from 'drizzle-orm';
import type {
  DocumentRealtimeChange,
  DocumentRealtimeEventType,
  DocumentRealtimeEventPayload,
  InboxRealtimeEventPayload,
  InboxRealtimeEventType,
  RealtimeEvent,
} from '@sirpefoffice/shared';

import { db, sql } from '../../db/index.js';
import { documentShares, documents } from '../../db/schema.js';
import { sendPushForRealtimeEvent } from '../notifications/push.js';

/** Canal de PostgreSQL por el que viajan los eventos. */
export const REALTIME_CHANNEL = 'sirpefoffice_realtime';

/**
 * Publica un evento para todos los procesos conectados a la base de datos.
 *
 * Se usa `NOTIFY` en lugar de un emisor en memoria porque los scripts de la
 * propia aplicación (demo, humo, siembra) escriben en la bandeja conectándose
 * directamente a PostgreSQL: con un emisor en memoria sus cambios nunca
 * llegarían al navegador.
 */
export async function publishRealtimeEvent(event: RealtimeEvent): Promise<void> {
  try {
    await sql.notify(REALTIME_CHANNEL, JSON.stringify(event));
    // El push se lanza en segundo plano: no debe frenar la ruta que lo origina.
    void sendPushForRealtimeEvent(event).catch((error) => {
      console.error('No se pudo enviar el push del evento:', error);
    });
  } catch (error) {
    // El aviso en tiempo real es accesorio: nunca debe romper la operación
    // que lo origina.
    console.error('No se pudo publicar el evento en tiempo real:', error);
  }
}

/** Publica un aviso de la bandeja dirigido a una lista concreta de usuarios. */
export async function publishInboxEvent(params: {
  type: InboxRealtimeEventType;
  userIds: string[];
  messageId: string;
  documentId: string;
  documentTitle: string;
  subject: string;
  actorId?: string;
  actorName: string;
  status: string;
  signedAt?: string | null;
  serial?: string | null;
}): Promise<void> {
  const userIds = [...new Set(params.userIds)];
  if (userIds.length === 0) return;

  const payload: InboxRealtimeEventPayload = {
    messageId: params.messageId,
    documentId: params.documentId,
    documentTitle: params.documentTitle,
    subject: params.subject,
    actorId: params.actorId,
    actorName: params.actorName,
    status: params.status,
    signedAt: params.signedAt ?? null,
    serial: params.serial ?? null,
  };

  await publishRealtimeEvent({
    type: params.type,
    userIds,
    payload,
    ts: new Date().toISOString(),
  });
}

/**
 * Audiencia de un documento: propietario + usuarios con acceso explícito.
 *
 * Los destinatarios de un envío y los administradores que deben aprobarlo
 * reciben una fila en `document_shares` dentro de la operación, así que
 * quedan incluidos sin consultas adicionales.
 */
export async function documentAudience(documentId: string): Promise<string[]> {
  const [doc] = await db
    .select({ ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return [];

  const shares = await db
    .select({ userId: documentShares.userId })
    .from(documentShares)
    .where(eq(documentShares.documentId, documentId));

  return [...new Set([doc.ownerId, ...shares.map((share) => share.userId)])];
}

/** Publica un cambio sobre un documento. */
export async function publishDocumentEvent(params: {
  type: DocumentRealtimeEventType;
  documentId: string;
  documentTitle: string;
  actorId: string;
  actorName: string;
  version: number;
  updatedAt: string;
  change: DocumentRealtimeChange;
  status?: string | null;
  /** Usuarios que deben enterarse aunque ya no tengan acceso (p. ej. al retirarlo). */
  extraUserIds?: string[];
}): Promise<void> {
  const audience = await documentAudience(params.documentId);
  const userIds = [...new Set([...audience, ...(params.extraUserIds ?? [])])];
  if (userIds.length === 0) return;

  const payload: DocumentRealtimeEventPayload = {
    documentId: params.documentId,
    documentTitle: params.documentTitle,
    actorId: params.actorId,
    actorName: params.actorName,
    version: params.version,
    updatedAt: params.updatedAt,
    change: params.change,
    status: params.status ?? null,
  };

  await publishRealtimeEvent({
    type: params.type,
    userIds,
    payload,
    ts: new Date().toISOString(),
  });
}
