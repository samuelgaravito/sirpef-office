import { randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

import {
  AI_NODE_MAX_RESPONSE_CHARS,
  type AiNodeCapabilities,
  type AiNodeServerMessage,
} from '@sirpefoffice/shared';

import { env } from '../../../env.js';
import { AppError } from '../../../lib/errors.js';

/**
 * Registro en memoria de los equipos conectados por el túnel.
 *
 * Vive en el proceso de la API: con una sola instancia es suficiente. Si algún
 * día se escala horizontalmente, el agente debe quedar pegado a su instancia
 * (sticky) o este registro tendrá que compartirse entre procesos.
 */

export interface ConnectedNode {
  id: string;
  userId: string;
  name: string;
  socket: WebSocket;
  capabilities: AiNodeCapabilities | null;
  /** ¿Contestó al último ping? */
  alive: boolean;
  /** ¿Tiene un trabajo en curso? */
  busy: boolean;
  lastSeenAt: Date;
  /** Cola: un equipo atiende de uno en uno (Ollama también serializa). */
  chain: Promise<unknown>;
}

interface PendingJob {
  id: string;
  nodeId: string;
  onProgress?: (chars: number) => void;
  resolve: (content: string) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  buffer: string;
  content: string;
  reported: number;
  done: boolean;
}

/** Cada cuánto se comprueba que el agente sigue vivo. */
const HEARTBEAT_MS = 25_000;

const byId = new Map<string, ConnectedNode>();
const bySocket = new Map<WebSocket, ConnectedNode>();
const jobs = new Map<string, PendingJob>();

let heartbeatTimer: NodeJS.Timeout | null = null;

function open(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN;
}

function ensureHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const node of byId.values()) {
      if (!open(node.socket)) {
        remove(node.id, node.socket);
        continue;
      }
      if (!node.alive) {
        // Dos latidos sin respuesta: la conexión está muerta.
        node.socket.terminate();
        remove(node.id, node.socket);
        continue;
      }
      node.alive = false;
      try {
        node.socket.ping();
        // El `pong` lo recibe el socket; el handler se instala al registrar.
      } catch {
        node.socket.terminate();
        remove(node.id, node.socket);
      }
    }
    if (byId.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
}

/** Da de alta la conexión de un equipo. Si había otra del mismo id, la cierra. */
export function registerNode(input: {
  id: string;
  userId: string;
  name: string;
  socket: WebSocket;
}): ConnectedNode {
  const previous = byId.get(input.id);
  if (previous && previous.socket !== input.socket) {
    try {
      previous.socket.close(4409, 'Otra conexión del mismo equipo');
    } catch {
      previous.socket.terminate();
    }
    remove(previous.id, previous.socket);
  }

  const node: ConnectedNode = {
    id: input.id,
    userId: input.userId,
    name: input.name,
    socket: input.socket,
    capabilities: null,
    alive: true,
    busy: false,
    lastSeenAt: new Date(),
    chain: Promise.resolve(),
  };

  byId.set(node.id, node);
  bySocket.set(node.socket, node);
  ensureHeartbeat();
  return node;
}

/** Olvida una conexión y rechaza el trabajo que tuviera en curso. */
export function remove(nodeId: string, socket: WebSocket): void {
  const node = byId.get(nodeId);
  if (!node || node.socket !== socket) return;

  byId.delete(nodeId);
  bySocket.delete(socket);

  for (const job of jobs.values()) {
    if (job.nodeId !== nodeId || job.done) continue;
    fail(job, new AppError(503, 'AI_NODE_OFFLINE', 'El equipo se desconectó durante la redacción.'));
  }
}

/** Marca la conexión como viva cuando llega cualquier mensaje. */
export function touch(nodeId: string): void {
  const node = byId.get(nodeId);
  if (!node) return;
  node.alive = true;
  node.lastSeenAt = new Date();
}

/** Guarda las capacidades que el agente reporta en `hello`. */
export function setCapabilities(nodeId: string, capabilities: AiNodeCapabilities): void {
  const node = byId.get(nodeId);
  if (node) node.capabilities = capabilities;
}

/** Nodo conectado del usuario, prefiriendo uno libre. */
export function pickNodeForUser(userId: string): ConnectedNode | null {
  const candidates = [...byId.values()].filter((node) => node.userId === userId && open(node.socket));
  if (candidates.length === 0) return null;
  return candidates.find((node) => !node.busy) ?? candidates[0] ?? null;
}

/** Nodos conectados ahora mismo (para combinar con la base). */
export function connectedNodes(): ConnectedNode[] {
  return [...byId.values()].filter((node) => open(node.socket));
}

/** ¿Sigue conectado este equipo? */
export function isOnline(nodeId: string): boolean {
  const node = byId.get(nodeId);
  return Boolean(node && open(node.socket));
}

/** Cierra la conexión de un equipo (al revocar su token). */
export function closeNode(nodeId: string, reason = 'Equipo revocado'): void {
  const node = byId.get(nodeId);
  if (!node) return;
  try {
    node.socket.close(4403, reason);
  } catch {
    node.socket.terminate();
  }
  remove(nodeId, node.socket);
}

/** Procesa un mensaje de trabajo (`chunk`, `done`, `error`). */
export function handleJobMessage(nodeId: string, message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const raw = message as { type?: unknown; id?: unknown; data?: unknown; message?: unknown };
  if (typeof raw.id !== 'string') return;
  const job = jobs.get(raw.id);
  if (!job || job.done || job.nodeId !== nodeId) return;

  if (raw.type === 'chunk') {
    if (typeof raw.data !== 'string') return;
    job.buffer += raw.data;
    drain(job);
    return;
  }

  if (raw.type === 'done') {
    // Una respuesta sin streaming llega como un JSON único sin salto final.
    if (job.buffer.trim()) job.buffer += '\n';
    drain(job);
    succeed(job);
    return;
  }

  if (raw.type === 'error') {
    const detail = typeof raw.message === 'string' ? raw.message.slice(0, 400) : 'error desconocido';
    fail(
      job,
      new AppError(502, 'AI_PROVIDER_ERROR', `El modelo local respondió con un error: ${detail}`),
    );
  }
}

/**
 * Pide una respuesta al equipo indicado.
 *
 * El cuerpo es exactamente el que se enviaría a Ollama; el agente solo lo
 * reenvía y devuelve el NDJSON. El parseo y el saneado siguen en el servidor.
 */
export async function chatViaNode(
  nodeId: string,
  body: unknown,
  onProgress?: (chars: number) => void,
): Promise<string> {
  const node = byId.get(nodeId);
  if (!node || !open(node.socket)) {
    throw new AppError(
      503,
      'AI_NODE_OFFLINE',
      'Tu equipo no está conectado. Enciende el agente de IA local o usa el proveedor del servidor.',
    );
  }

  const run = (): Promise<string> => {
    node.busy = true;
    return runJob(node, body, onProgress).finally(() => {
      node.busy = false;
      node.lastSeenAt = new Date();
    });
  };

  // La cola garantiza un trabajo por equipo; si uno falla, el siguiente sigue.
  const next = node.chain.then(run, run);
  node.chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function runJob(node: ConnectedNode, body: unknown, onProgress?: (chars: number) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!open(node.socket)) {
      reject(
        new AppError(503, 'AI_NODE_OFFLINE', 'Tu equipo se desconectó antes de empezar la redacción.'),
      );
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      const job = jobs.get(id);
      if (!job) return;
      send(node, { type: 'abort', id });
      fail(
        job,
        new AppError(
          504,
          'AI_TIMEOUT',
          'El equipo local tardó demasiado en responder. Redactar un documento entero puede tardar ' +
            'varios minutos: inténtalo de nuevo o usa un modelo más pequeño.',
        ),
      );
    }, env.AI_LOCAL_TIMEOUT_MS);
    timer.unref();

    const job: PendingJob = {
      id,
      nodeId: node.id,
      ...(onProgress ? { onProgress } : {}),
      resolve,
      reject,
      timer,
      buffer: '',
      content: '',
      reported: 0,
      done: false,
    };
    jobs.set(id, job);

    send(node, { type: 'job', id, path: '/api/chat', body }, (error) => {
      if (error) fail(job, new AppError(503, 'AI_NODE_OFFLINE', 'No se pudo enviar el trabajo al equipo.'));
    });
  });
}

function send(node: ConnectedNode, message: AiNodeServerMessage, onError?: (error: Error) => void): void {
  try {
    node.socket.send(JSON.stringify(message), (error?: Error) => {
      if (error) onError?.(error);
    });
  } catch {
    onError?.(new Error('socket cerrado'));
  }
}

/** Consume las líneas NDJSON acumuladas, igual que hace el proveedor HTTP. */
function drain(job: PendingJob): void {
  let newline = job.buffer.indexOf('\n');
  while (newline >= 0) {
    const line = job.buffer.slice(0, newline).trim();
    job.buffer = job.buffer.slice(newline + 1);
    newline = job.buffer.indexOf('\n');
    if (!line) continue;

    let chunk: { error?: string; message?: { content?: string } };
    try {
      chunk = JSON.parse(line) as typeof chunk;
    } catch {
      continue;
    }

    if (chunk.error) {
      fail(
        job,
        new AppError(502, 'AI_PROVIDER_ERROR', `El modelo local respondió con un error: ${chunk.error}`),
      );
      return;
    }

    if (typeof chunk.message?.content === 'string') job.content += chunk.message.content;

    if (job.content.length - job.reported >= 60) {
      job.reported = job.content.length;
      job.onProgress?.(job.content.length);
    }

    if (job.content.length > AI_NODE_MAX_RESPONSE_CHARS) {
      fail(
        job,
        new AppError(502, 'AI_BAD_RESPONSE', 'El equipo devolvió una respuesta demasiado grande.'),
      );
      return;
    }
  }
}

function succeed(job: PendingJob): void {
  if (job.done) return;
  job.done = true;
  clearTimeout(job.timer);
  jobs.delete(job.id);

  const content = job.content;
  if (!content) {
    job.reject(new AppError(502, 'AI_EMPTY', 'El equipo no devolvió contenido.'));
    return;
  }
  if (content.length > job.reported) job.onProgress?.(content.length);
  job.resolve(content);
}

function fail(job: PendingJob, error: unknown): void {
  if (job.done) return;
  job.done = true;
  clearTimeout(job.timer);
  jobs.delete(job.id);
  job.reject(error);
}
