import { createHash, randomBytes } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AI_NODE_PROTOCOL_VERSION,
  type AiNodeCapabilities,
} from '@sirpefoffice/shared';

import { db } from '../../../db/index.js';
import { aiNodes, users } from '../../../db/schema.js';
import { authenticate, requireAdmin } from '../../../lib/auth-guard.js';
import { AppError, notFound } from '../../../lib/errors.js';
import {
  closeNode,
  connectedNodes,
  handleJobMessage,
  registerNode,
  remove,
  setCapabilities,
  touch,
} from './registry.js';
import { toNodeSummary } from './summary.js';

/**
 * Equipos de IA local.
 *
 * El agente abre un WebSocket saliente hacia `/api/ai/node` con el token del
 * equipo. El servidor le manda trabajos y recibe el NDJSON de su Ollama; el
 * saneado del resultado sigue siendo cosa del servidor.
 */

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_PROTOCOL = 4426;

const createNodeSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del equipo es obligatorio').max(80),
});

/** Hash del token: en la base nunca se guarda el valor en claro. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** Valida y recorta el `hello` del agente. Es un auto-reporte, no un permiso. */
function parseCapabilities(message: Record<string, unknown>): AiNodeCapabilities | null {
  const raw = message.capabilities;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const models = Array.isArray(value.models)
    ? value.models
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 120))
        .slice(0, 100)
    : [];

  const number = (input: unknown): number | null =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0
      ? Math.round(input * 100) / 100
      : null;

  return {
    ollamaVersion:
      typeof value.ollamaVersion === 'string' ? value.ollamaVersion.slice(0, 40) : null,
    models,
    gpu: value.gpu === true,
    vramGb: number(value.vramGb),
    tokensPerSecond: number(value.tokensPerSecond),
  };
}

export async function aiNodeRoutes(app: FastifyInstance): Promise<void> {
  /** Equipos del usuario con su estado actual. */
  app.get('/ai/nodes', async (request) => {
    const user = await authenticate(request);
    const rows = await db
      .select()
      .from(aiNodes)
      .where(and(eq(aiNodes.userId, user.sub), isNull(aiNodes.revokedAt)))
      .orderBy(desc(aiNodes.createdAt));

    const live = new Map(connectedNodes().map((node) => [node.id, node]));
    return { nodes: rows.map((row) => toNodeSummary(row, live.get(row.id))) };
  });

  /** Inventario de todos los equipos (solo administradores). */
  app.get('/ai/nodes/all', async (request) => {
    await requireAdmin(request);

    const rows = await db
      .select({
        node: aiNodes,
        ownerId: users.id,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(aiNodes)
      .innerJoin(users, eq(users.id, aiNodes.userId))
      .where(isNull(aiNodes.revokedAt))
      .orderBy(desc(aiNodes.createdAt));

    const live = new Map(connectedNodes().map((node) => [node.id, node]));
    return {
      nodes: rows.map((row) => ({
        ...toNodeSummary(row.node, live.get(row.node.id)),
        owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail },
      })),
    };
  });

  /** Crea un equipo y devuelve el token una sola vez. */
  app.post('/ai/nodes', async (request) => {
    const user = await authenticate(request);
    const body = createNodeSchema.parse(request.body ?? {});

    const token = randomBytes(32).toString('base64url');
    const [row] = await db
      .insert(aiNodes)
      .values({
        userId: user.sub,
        name: body.name,
        tokenHash: hashToken(token),
      })
      .returning();

    if (!row) throw new AppError(500, 'AI_NODE_CREATE_FAILED', 'No se pudo crear el equipo');

    return { node: toNodeSummary(row), token };
  });

  /** Revoca un equipo: el agente no podrá reconectarse. */
  app.delete('/ai/nodes/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(aiNodes)
      .where(and(eq(aiNodes.id, id), isNull(aiNodes.revokedAt)))
      .limit(1);

    if (!row) throw notFound('El equipo no existe');
    if (row.userId !== user.sub && user.role !== 'admin') {
      throw notFound('El equipo no existe');
    }

    await db.update(aiNodes).set({ revokedAt: new Date() }).where(eq(aiNodes.id, id));
    closeNode(id, 'Equipo revocado');

    return { ok: true };
  });

  /** Rota el token: la conexión actual se cierra y hay que actualizar el agente. */
  app.post('/ai/nodes/:id/token', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(aiNodes)
      .where(and(eq(aiNodes.id, id), isNull(aiNodes.revokedAt)))
      .limit(1);

    if (!row) throw notFound('El equipo no existe');
    if (row.userId !== user.sub && user.role !== 'admin') {
      throw notFound('El equipo no existe');
    }

    const token = randomBytes(32).toString('base64url');
    const [updated] = await db
      .update(aiNodes)
      .set({
        tokenHash: hashToken(token),
        // Las capacidades se vuelven a reportar en el próximo `hello`.
        lastSeenAt: null,
        ollamaVersion: null,
        models: [],
        gpu: false,
        vramGb: null,
        tokensPerSecond: null,
      })
      .where(eq(aiNodes.id, id))
      .returning();

    if (!updated) throw new AppError(500, 'AI_NODE_ROTATE_FAILED', 'No se pudo rotar el token');

    closeNode(id, 'Token rotado');

    return { node: toNodeSummary(updated), token };
  });

  /**
   * Túnel del agente.
   *
   * La autenticación va en la cabecera `Authorization`, no en la query: el
   * agente no es un navegador y así el token no acaba en los logs de acceso.
   */
  app.get(
    '/ai/node',
    {
      websocket: true,
      // El handshake no comparte el cupo global: un reinicio del servidor o una
      // red inestable hacen que varios agentes reconecten a la vez y no deben
      // quedarse fuera por el límite pensado para la API normal.
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
    },
    async (socket, request) => {
    const token = bearer(request);
    if (!token) {
      socket.close(CLOSE_UNAUTHENTICATED, 'Token requerido');
      return;
    }

    const [row] = await db
      .select()
      .from(aiNodes)
      .where(eq(aiNodes.tokenHash, hashToken(token)))
      .limit(1);

    if (!row || row.revokedAt) {
      socket.close(CLOSE_UNAUTHENTICATED, 'Token inválido');
      return;
    }

    const node = registerNode({
      id: row.id,
      userId: row.userId,
      name: row.name,
      socket,
    });

    socket.on('pong', () => touch(node.id));

    socket.on('message', (raw) => {
      touch(node.id);

      let message: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw.toString()) as unknown;
        if (!parsed || typeof parsed !== 'object') return;
        message = parsed as Record<string, unknown>;
      } catch {
        return;
      }

      if (message.type === 'hello') {
        if (message.protocol !== AI_NODE_PROTOCOL_VERSION) {
          socket.close(CLOSE_PROTOCOL, 'Versión de protocolo incompatible');
          return;
        }
        const capabilities = parseCapabilities(message);
        if (!capabilities) return;

        setCapabilities(node.id, capabilities);
        void db
          .update(aiNodes)
          .set({
            lastSeenAt: new Date(),
            ollamaVersion: capabilities.ollamaVersion,
            models: capabilities.models,
            gpu: capabilities.gpu,
            vramGb: capabilities.vramGb,
            tokensPerSecond: capabilities.tokensPerSecond,
          })
          .where(eq(aiNodes.id, node.id))
          .catch((error: unknown) => {
            request.log.warn({ err: error }, 'No se pudo guardar el estado del equipo de IA');
          });
        return;
      }

      handleJobMessage(node.id, message);
    });

    socket.on('close', () => remove(node.id, socket));
    socket.on('error', () => remove(node.id, socket));
  });
}

/** Cierra el túnel de todos los equipos (apagado ordenado). */
export function closeAllNodes(): void {
  for (const node of connectedNodes()) closeNode(node.id, 'El servidor se está apagando');
}
