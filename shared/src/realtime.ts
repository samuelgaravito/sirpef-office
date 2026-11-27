/**
 * Contrato de los eventos en tiempo real.
 *
 * El servidor publica los cambios por PostgreSQL (`NOTIFY`) y el hub los
 * reparte a los navegadores conectados por WebSocket. El evento es
 * deliberadamente pequeño: **avisa de que algo ha cambiado** y el cliente
 * vuelve a pedir los datos con la API de siempre. Así no hay dos versiones de
 * la forma de un documento que se puedan desincronizar.
 *
 * El payload nunca lleva el contenido TipTap: PostgreSQL limita `NOTIFY` a
 * unos 8 KB y el JSON completo puede superarlo con facilidad.
 */

/** Eventos de la bandeja (mensajes entre usuarios). */
export const INBOX_REALTIME_EVENT_TYPES = [
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
  /** Un envío pendiente se aprobó o rechazó: refresca la vista del aprobador. */
  'inbox.message.reviewed',
  /** El aprobador firmó y selló el documento. */
  'inbox.message.signed',
  /** El administrador que aprobó un memo lo deja sin efecto. */
  'inbox.message.annulled',
] as const;

/** Cambios sobre un documento. */
export const DOCUMENT_REALTIME_EVENT_TYPES = [
  /** Se creó un documento (o se materializó un borrador). */
  'document.created',
  /** Cambió el contenido, los metadatos o el estado. */
  'document.updated',
  /** El documento se movió a la papelera. */
  'document.deleted',
  /** El documento se restauró desde la papelera. */
  'document.restored',
  /** Se compartió con un usuario. */
  'document.shared',
  /** Se retiró el acceso a un usuario. */
  'document.unshared',
  /** El documento quedó sellado y en solo lectura. */
  'document.locked',
] as const;

/** Eventos del ciclo de vida del teléfono de firma. */
export const MOBILE_REALTIME_EVENT_TYPES = [
  /** La web revocó este teléfono; la app debe cerrar la sesión. */
  'mobile.device.revoked',
] as const;

export const REALTIME_EVENT_TYPES = [
  ...INBOX_REALTIME_EVENT_TYPES,
  ...DOCUMENT_REALTIME_EVENT_TYPES,
  ...MOBILE_REALTIME_EVENT_TYPES,
] as const;

export type InboxRealtimeEventType = (typeof INBOX_REALTIME_EVENT_TYPES)[number];
export type DocumentRealtimeEventType = (typeof DOCUMENT_REALTIME_EVENT_TYPES)[number];
export type MobileRealtimeEventType = (typeof MOBILE_REALTIME_EVENT_TYPES)[number];
export type RealtimeEventType =
  | InboxRealtimeEventType
  | DocumentRealtimeEventType
  | MobileRealtimeEventType;

export type DocumentRealtimeChange =
  | 'create'
  | 'content'
  | 'metadata'
  | 'status'
  | 'trash'
  | 'restore'
  | 'share'
  | 'unshare'
  | 'lock';

/** Datos mínimos de un evento de bandeja. */
export interface InboxRealtimeEventPayload {
  messageId: string;
  documentId: string;
  documentTitle: string;
  subject: string;
  /** Quién provocó el cambio (remitente, aprobador…). */
  actorId?: string;
  actorName: string;
  /** Estado del mensaje después del cambio. */
  status: string;
  /** Firma recién estampada, cuando corresponde. */
  signedAt?: string | null;
  serial?: string | null;
}

/** Datos mínimos de un evento de documento. */
export interface DocumentRealtimeEventPayload {
  documentId: string;
  documentTitle: string;
  actorId: string;
  actorName: string;
  version: number;
  updatedAt: string;
  change: DocumentRealtimeChange;
  status?: string | null;
}

/** Datos mínimos del teléfono revocado. */
export interface MobileRealtimeEventPayload {
  deviceId: string;
}

export type RealtimeEventPayload =
  | InboxRealtimeEventPayload
  | DocumentRealtimeEventPayload
  | MobileRealtimeEventPayload;

/**
 * Evento tal y como viaja por PostgreSQL. `userIds` decide quién lo recibe:
 * un evento nunca se reparte a más usuarios de los indicados.
 */
export type InboxRealtimeEvent = {
  type: InboxRealtimeEventType;
  userIds: string[];
  payload: InboxRealtimeEventPayload;
  ts: string;
};

export type DocumentRealtimeEvent = {
  type: DocumentRealtimeEventType;
  userIds: string[];
  payload: DocumentRealtimeEventPayload;
  ts: string;
};

export type MobileRealtimeEvent = {
  type: MobileRealtimeEventType;
  userIds: string[];
  payload: MobileRealtimeEventPayload;
  ts: string;
};

export type RealtimeEvent =
  | InboxRealtimeEvent
  | DocumentRealtimeEvent
  | MobileRealtimeEvent;

/** Lo que llega al navegador: el evento sin la lista de destinatarios. */
export type InboxRealtimeMessage = {
  type: InboxRealtimeEventType;
  payload: InboxRealtimeEventPayload | null;
  ts: string;
};

export type DocumentRealtimeMessage = {
  type: DocumentRealtimeEventType;
  payload: DocumentRealtimeEventPayload;
  ts: string;
};

export type MobileRealtimeMessage = {
  type: MobileRealtimeEventType;
  payload: MobileRealtimeEventPayload;
  ts: string;
};

export type RealtimeMessage =
  | InboxRealtimeMessage
  | DocumentRealtimeMessage
  | MobileRealtimeMessage;

/** ¿El evento afecta a la bandeja? */
export function isInboxRealtimeEvent(type: RealtimeEventType): type is InboxRealtimeEventType {
  return type.startsWith('inbox.');
}

/** ¿El evento afecta a un documento? */
export function isDocumentRealtimeEvent(
  type: RealtimeEventType,
): type is DocumentRealtimeEventType {
  return type.startsWith('document.');
}

/** ¿El evento afecta al dispositivo móvil? */
export function isMobileRealtimeEvent(
  type: RealtimeEventType,
): type is MobileRealtimeEventType {
  return type.startsWith('mobile.');
}

/** Estrecha un mensaje a los eventos de bandeja. */
export function isInboxMessage(
  message: RealtimeMessage,
): message is InboxRealtimeMessage {
  return isInboxRealtimeEvent(message.type);
}

/** Estrecha un mensaje a los eventos de documento. */
export function isDocumentMessage(
  message: RealtimeMessage,
): message is DocumentRealtimeMessage {
  return isDocumentRealtimeEvent(message.type);
}
