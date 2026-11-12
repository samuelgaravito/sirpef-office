import { ref } from 'vue';

import { isInboxRealtimeEvent, type RealtimeMessage } from '@sirpefoffice/shared';

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';

/** Espera máxima entre reintentos de conexión. */
const MAX_BACKOFF_MS = 30_000;

const status = ref<RealtimeStatus>('idle');
const lastMessage = ref<RealtimeMessage | null>(null);

/** Suscriptores: cada vista que necesite reaccionar a un evento. */
const listeners = new Set<(message: RealtimeMessage) => void>();

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let attempts = 0;
/** `true` cuando el cierre es intencionado (fin de sesión). */
let closing = false;

/** URL del canal: el mismo origen y la misma ruta que usa la API. */
function realtimeUrl(): string {
  const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  const url = new URL(base, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname}/ws`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return;
  const delay = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
  attempts += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connectRealtime();
  }, delay + Math.random() * 500);
}

/**
 * Abre el canal de eventos.
 *
 * Solo hay una conexión por sesión: la comparten todas las vistas. Se
 * reconecta sola con espera creciente porque el servidor puede reiniciarse
 * (en desarrollo, `tsx watch` reinicia la API en cada cambio de fichero).
 */
export function connectRealtime(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  closing = false;
  status.value = 'connecting';

  let ws: WebSocket;
  try {
    ws = new WebSocket(realtimeUrl());
  } catch {
    status.value = 'closed';
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempts = 0;
    status.value = 'open';
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    let message: RealtimeMessage;
    try {
      message = JSON.parse(event.data) as RealtimeMessage;
    } catch {
      return;
    }
    if (!message?.type) return;

    lastMessage.value = message;
    for (const listener of listeners) {
      try {
        listener(message);
      } catch {
        // Un suscriptor que falla no puede cortar el aviso de los demás.
      }
    }
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    status.value = 'closed';
    // 4401: el servidor no acepta la sesión. Se reintenta igual: para
    // entonces el cliente ya habrá renovado el token.
    if (!closing) scheduleReconnect();
  };

  ws.onerror = () => {
    // El cierre llega después y es él quien programa el reintento.
  };
}

/** Cierra el canal (fin de sesión). */
export function disconnectRealtime(): void {
  closing = true;
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  const ws = socket;
  socket = null;
  status.value = 'idle';
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(1000, 'Cierre de sesión');
  }
}

/** Fuerza un reintento inmediato (por ejemplo, al volver a la pestaña). */
export function reconnectRealtime(): void {
  if (status.value === 'open') return;
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  connectRealtime();
}

/** Se suscribe a los eventos. Devuelve la función para cancelar la suscripción. */
export function onRealtimeEvent(listener: (message: RealtimeMessage) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ¿El canal está conectado? */
export function isRealtimeConnected(): boolean {
  return status.value === 'open';
}

export function useRealtime() {
  return {
    status,
    lastMessage,
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    reconnect: reconnectRealtime,
    on: onRealtimeEvent,
    isConnected: isRealtimeConnected,
    isInboxEvent: isInboxRealtimeEvent,
  };
}
