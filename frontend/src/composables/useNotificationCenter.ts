import { computed, ref } from 'vue';

import {
  isDocumentMessage,
  isInboxMessage,
  type RealtimeMessage,
} from '@sirpefoffice/shared';

import { onRealtimeEvent } from '@/composables/useRealtime';

export type AppNotificationKind =
  | 'inbox'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'signed'
  | 'shared'
  | 'locked'
  | 'updated'
  | 'deleted';

export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  detail: string;
  /** Destino al pulsar. */
  documentId?: string;
  messageId?: string;
  at: string;
  read: boolean;
}

const MAX_ITEMS = 50;
const STORAGE_PREFIX = 'sirpefoffice.avisos:';

const items = ref<AppNotification[]>([]);
const userId = ref<string | null>(null);
/** Evita suscribirse dos veces al arrancar la app. */
let unsubscribe: (() => void) | null = null;

const unread = computed(() => items.value.filter((item) => !item.read).length);

function storageKey(): string | null {
  return userId.value ? `${STORAGE_PREFIX}${userId.value}` : null;
}

function persist(): void {
  const key = storageKey();
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items.value.slice(0, MAX_ITEMS)));
  } catch {
    // Sin almacenamiento el historial dura lo que la pestaña.
  }
}

function load(): void {
  const key = storageKey();
  if (!key) {
    items.value = [];
    return;
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as AppNotification[]) : [];
    items.value = Array.isArray(parsed)
      ? parsed.filter((item) => typeof item?.id === 'string').slice(0, MAX_ITEMS)
      : [];
  } catch {
    items.value = [];
  }
}

function identifier(message: RealtimeMessage): string {
  const payload = message.payload;
  if (payload && 'messageId' in payload) return `${message.ts}:${payload.messageId}:${message.type}`;
  if (payload && 'documentId' in payload) return `${message.ts}:${payload.documentId}:${message.type}`;
  return `${message.ts}:${message.type}`;
}

function describe(message: RealtimeMessage): Omit<AppNotification, 'id' | 'at' | 'read'> | null {
  if (isInboxMessage(message)) {
    const payload = message.payload;
    if (!payload) return null;
    const base = {
      documentId: payload.documentId,
      messageId: payload.messageId,
    };
    switch (message.type) {
      case 'inbox.message.created':
        return {
          kind: 'inbox',
          title: `Nuevo documento de ${payload.actorName}`,
          detail: payload.subject,
          ...base,
        };
      case 'inbox.message.pending':
        return {
          kind: 'pending',
          title: 'Envío pendiente de aprobación',
          detail: `${payload.subject} · ${payload.actorName}`,
          ...base,
        };
      case 'inbox.message.approved':
        return {
          kind: 'approved',
          title: 'Documento aprobado y enviado',
          detail: payload.subject,
          ...base,
        };
      case 'inbox.result.approved':
        return {
          kind: 'approved',
          title: `Documento aprobado por ${payload.actorName}`,
          detail: payload.subject,
          ...base,
        };
      case 'inbox.result.rejected':
        return {
          kind: 'rejected',
          title: `Documento rechazado por ${payload.actorName}`,
          detail: payload.subject,
          ...base,
        };
      case 'inbox.message.cancelled':
        return {
          kind: 'inbox',
          title: 'Envío cancelado',
          detail: payload.subject,
          ...base,
        };
      case 'inbox.message.signed':
        return {
          kind: 'signed',
          title: 'Documento firmado y sellado',
          detail: payload.subject,
          ...base,
        };
      case 'inbox.message.reviewed':
      case 'connection.ready':
      default:
        return null;
    }
  }

  if (isDocumentMessage(message)) {
    const payload = message.payload;
    switch (message.type) {
      case 'document.shared':
        return {
          kind: 'shared',
          title: `${payload.actorName} compartió un documento contigo`,
          detail: payload.documentTitle,
          documentId: payload.documentId,
        };
      case 'document.deleted':
        return {
          kind: 'deleted',
          title: 'Documento movido a la papelera',
          detail: payload.documentTitle,
          documentId: payload.documentId,
        };
      default:
        return null;
    }
  }

  return null;
}

function handle(message: RealtimeMessage): void {
  if (!userId.value) return;

  const payload = message.payload;
  if (payload?.actorId && payload.actorId === userId.value) return;

  const copy = describe(message);
  if (!copy) return;

  items.value = [
    {
      ...copy,
      id: identifier(message),
      at: message.ts,
      read: false,
    },
    ...items.value.filter((item) => item.id !== identifier(message)),
  ].slice(0, MAX_ITEMS);
  persist();
}

/** Carga el historial del usuario y empieza a escuchar eventos. */
function start(currentUserId: string): void {
  if (userId.value !== currentUserId) {
    userId.value = currentUserId;
    load();
  }
  if (unsubscribe) return;
  unsubscribe = onRealtimeEvent(handle);
}

/** Deja de escuchar y limpia el estado en memoria (fin de sesión). */
function stop(): void {
  unsubscribe?.();
  unsubscribe = null;
  userId.value = null;
  items.value = [];
}

function markRead(id: string): void {
  const item = items.value.find((entry) => entry.id === id);
  if (!item || item.read) return;
  item.read = true;
  persist();
}

function markAllRead(): void {
  if (!items.value.some((item) => !item.read)) return;
  items.value = items.value.map((item) => ({ ...item, read: true }));
  persist();
}

function clear(): void {
  items.value = [];
  persist();
}

export function useNotificationCenter() {
  return {
    items,
    unread,
    start,
    stop,
    markRead,
    markAllRead,
    clear,
  };
}
