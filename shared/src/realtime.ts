/**
 * Contrato de los eventos en tiempo real.
 *
 * El servidor publica los cambios de la bandeja por PostgreSQL (`NOTIFY`) y
 * el hub los reparte a los navegadores conectados por WebSocket. El evento es
 * deliberadamente pequeño: **avisa de que algo ha cambiado** y el cliente
 * vuelve a pedir los datos con la API de siempre. Así no hay dos versiones de
 * la forma de un mensaje que se puedan desincronizar.
 */

/** Tipos de evento que el servidor puede enviar. */
export const REALTIME_EVENT_TYPES = [
  /** El servidor acepta la conexión y la tiene autenticada. */
  'connection.ready',
  /** Llega un mensaje nuevo a la bandeja de un destinatario. */
  'inbox.message.created',
  /** Un envío queda pendiente de aprobación (solo administradores). */
  'inbox.message.pending',
  /** Un envío aprobado llega a los destinatarios. */
  'inbox.message.approved',
  /** La solicitud de aprobación del remitente ha sido aprobada. */
  'inbox.result.approved',
  /** La solicitud de aprobación del remitente ha sido rechazada. */
  'inbox.result.rejected',
  /** Un envío pendiente se cancela. */
  'inbox.message.cancelled',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/** Datos mínimos del evento: identifican el mensaje y a quién hay que avisar. */
export interface RealtimeEventPayload {
  messageId: string;
  documentId: string;
  documentTitle: string;
  subject: string;
  /** Quién provocó el cambio (remitente, aprobador…). */
  actorName: string;
  /** Estado del mensaje después del cambio. */
  status: string;
}

/**
 * Evento tal y como viaja por PostgreSQL. `userIds` decide quién lo recibe:
 * un evento nunca se reparte a más usuarios de los indicados.
 */
export interface RealtimeEvent {
  type: RealtimeEventType;
  /** Solo estos usuarios reciben el evento. */
  userIds: string[];
  payload: RealtimeEventPayload;
  ts: string;
}

/** Lo que llega al navegador: el evento sin la lista de destinatarios. */
export interface RealtimeMessage {
  type: RealtimeEventType;
  /** `null` en `connection.ready`. */
  payload: RealtimeEventPayload | null;
  ts: string;
}

/** ¿El evento afecta a la bandeja? Sirve para refrescar contadores y listas. */
export function isInboxRealtimeEvent(type: RealtimeEventType): boolean {
  return type.startsWith('inbox.');
}
