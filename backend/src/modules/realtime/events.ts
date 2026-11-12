import type { RealtimeEvent, RealtimeEventPayload, RealtimeEventType } from '@sirpefoffice/shared';

import { sql } from '../../db/index.js';

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
  } catch (error) {
    // El aviso en tiempo real es accesorio: nunca debe romper la operación
    // que lo origina.
    console.error('No se pudo publicar el evento en tiempo real:', error);
  }
}

/** Publica un aviso de la bandeja dirigido a una lista concreta de usuarios. */
export async function publishInboxEvent(params: {
  type: RealtimeEventType;
  userIds: string[];
  messageId: string;
  documentId: string;
  documentTitle: string;
  subject: string;
  actorName: string;
  status: string;
}): Promise<void> {
  const userIds = [...new Set(params.userIds)];
  if (userIds.length === 0) return;

  const payload: RealtimeEventPayload = {
    messageId: params.messageId,
    documentId: params.documentId,
    documentTitle: params.documentTitle,
    subject: params.subject,
    actorName: params.actorName,
    status: params.status,
  };

  await publishRealtimeEvent({
    type: params.type,
    userIds,
    payload,
    ts: new Date().toISOString(),
  });
}
