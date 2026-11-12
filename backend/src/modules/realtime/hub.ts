import { inArray } from 'drizzle-orm';
import type { WebSocket } from 'ws';

import type { RealtimeEvent } from '@sirpefoffice/shared';

import { db, sql } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { REALTIME_CHANNEL } from './events.js';

/** Registro mínimo del logger de Fastify que usa este módulo. */
type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/** Conexión viva de un usuario. */
interface Client {
  socket: WebSocket;
  /** ¿Contestó al último ping? Si no, la conexión se corta. */
  alive: boolean;
}

/** Conexiones agrupadas por usuario: un usuario puede abrir varias pestañas. */
const byUser = new Map<string, Set<Client>>();
/** Acceso directo desde el socket, para el latido y la limpieza. */
const bySocket = new Map<WebSocket, Client>();

/** Cada cuánto se comprueba que los navegadores siguen ahí. */
const HEARTBEAT_MS = 30_000;
/** Cada cuánto se reintenta la escucha si la base de datos no estaba lista. */
const RETRY_MS = 10_000;
/** Cada cuánto se comprueba que las cuentas de los conectados siguen activas. */
const VALIDATION_MS = 5 * 60_000;

let heartbeatTimer: NodeJS.Timeout | null = null;
let validationTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let listener: ReturnType<typeof sql.listen> | null = null;

/** Registra una conexión y la devuelve ya suscrita. */
export function registerClient(userId: string, socket: WebSocket): void {
  const client: Client = { socket, alive: true };
  const set = byUser.get(userId) ?? new Set<Client>();
  set.add(client);
  byUser.set(userId, set);
  bySocket.set(socket, client);

  socket.on('pong', () => {
    client.alive = true;
  });
}

/** Olvida una conexión (se cerró o falló). */
export function unregisterClient(userId: string, socket: WebSocket): void {
  const client = bySocket.get(socket);
  if (!client) return;
  bySocket.delete(socket);

  const set = byUser.get(userId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) byUser.delete(userId);
}

/** Número de conexiones abiertas (para el health check). */
export function realtimeConnectionCount(): number {
  return bySocket.size;
}

/** Envía un evento a los usuarios destinatarios. */
export function dispatchRealtimeEvent(event: RealtimeEvent): void {
  const data = JSON.stringify({
    type: event.type,
    payload: event.payload,
    ts: event.ts,
  });

  for (const userId of event.userIds) {
    const set = byUser.get(userId);
    if (!set) continue;
    for (const client of set) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      client.socket.send(data, (error) => {
        if (error) client.socket.terminate();
      });
    }
  }
}

/**
 * Empieza a escuchar los eventos que publican los demás procesos.
 *
 * La escucha usa una conexión propia de PostgreSQL, así que no compite con el
 * pool de consultas de la aplicación.
 */
export function startRealtimeListener(log: Logger): Promise<void> {
  if (listener) return Promise.resolve();

  const request = sql.listen(REALTIME_CHANNEL, (payload) => {
    try {
      const event = JSON.parse(payload) as RealtimeEvent;
      if (!event?.type || !Array.isArray(event.userIds)) return;
      dispatchRealtimeEvent(event);
    } catch (error) {
      log.warn({ err: error }, 'Evento en tiempo real ilegible');
    }
  });

  listener = request;

  const ready = request.then(
    () => undefined,
    (error) => {
      log.error({ err: error }, 'No se pudieron escuchar los eventos en tiempo real');
      listener = null;
      // La base de datos puede no estar lista todavía: se reintenta solo.
      scheduleRetry(log);
    },
  );

  startHeartbeat();
  startValidation();
  return ready;
}

/** Cierra la escucha y corta las conexiones abiertas. */
export async function stopRealtimeListener(log: Logger): Promise<void> {
  stopHeartbeat();
  stopValidation();
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  const request = listener;
  listener = null;
  if (request) {
    try {
      // Espera a que la conexión esté lista para poder desuscribirse.
      const meta = await Promise.race([
        request,
        new Promise<null>((resolve) => {
          const timer = setTimeout(() => resolve(null), 2000);
          timer.unref();
        }),
      ]);
      if (meta) await meta.unlisten();
    } catch (error) {
      log.warn({ err: error }, 'No se pudo cerrar la escucha de eventos en tiempo real');
    }
  }

  for (const client of bySocket.values()) {
    client.socket.close(1001, 'El servidor se está apagando');
  }
  bySocket.clear();
  byUser.clear();
}

/** Latido: si un navegador no contesta, su conexión está muerta. */
function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const client of bySocket.values()) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch {
        client.socket.terminate();
      }
    }
  }, HEARTBEAT_MS);
  // No debe mantener vivo el proceso por su cuenta.
  heartbeatTimer.unref();
}

function stopHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/**
 * Comprueba que las cuentas de los conectados siguen activas.
 *
 * El handshake solo mira la sesión al abrirse: sin esta comprobación, una
 * baja seguiría recibiendo avisos hasta que se cerrara el navegador.
 */
function startValidation(): void {
  if (validationTimer) return;
  validationTimer = setInterval(() => {
    void validateClients();
  }, VALIDATION_MS);
  validationTimer.unref();
}

function stopValidation(): void {
  if (!validationTimer) return;
  clearInterval(validationTimer);
  validationTimer = null;
}

async function validateClients(): Promise<void> {
  const userIds = [...byUser.keys()];
  if (userIds.length === 0) return;

  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, userIds));
    const active = new Set(rows.map((row) => row.id));

    for (const [userId, set] of byUser) {
      if (active.has(userId)) continue;
      for (const client of set) {
        client.socket.close(4401, 'La cuenta ya no está activa');
      }
    }
  } catch (error) {
    // Si la base de datos falla no se corta a nadie: se reintenta al ciclo
    // siguiente.
    console.error('No se pudo comprobar la sesión de los clientes en tiempo real:', error);
  }
}

function scheduleRetry(log: Logger): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    startRealtimeListener(log);
  }, RETRY_MS);
  retryTimer.unref();
}
