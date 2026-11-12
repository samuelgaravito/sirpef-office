import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { corsOrigins } from '../../env.js';
import { ACCESS_COOKIE } from '../../lib/auth-guard.js';
import { verifyAccessToken } from '../../lib/jwt.js';
import { registerClient, unregisterClient } from './hub.js';

/**
 * Códigos de cierre propios. El rango 4000-4999 queda reservado para las
 * aplicaciones (RFC 6455) y el 1000-4999 para el cierre con código.
 */
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN_ORIGIN = 4403;

/**
 * El navegador no puede mandar cabeceras en el handshake de un WebSocket, así
 * que la sesión se toma de la cookie httpOnly que ya emite el login. El token
 * en la query es solo una alternativa para clientes que no manejen cookies.
 */
function extractToken(request: FastifyRequest): string | undefined {
  const cookie = request.cookies?.[ACCESS_COOKIE];
  if (cookie) return cookie;

  const query = request.query as { token?: unknown } | undefined;
  return typeof query?.token === 'string' ? query.token : undefined;
}

/** Valida la sesión del handshake y devuelve el identificador del usuario. */
async function authenticateSocket(request: FastifyRequest): Promise<string | null> {
  const token = extractToken(request);
  if (!token) return null;

  const payload = await verifyAccessToken(token);
  if (!payload) return null;

  // El estado se lee de la base local para que una baja surta efecto sin
  // esperar a que caduque el token.
  const [row] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  return row?.isActive ? payload.sub : null;
}

/**
 * CORS no se aplica al handshake: el origen se comprueba a mano.
 *
 * Se acepta el origen si está en la lista de CORS **o** si coincide con el
 * host de la propia petición: en producción la SPA y la API comparten origen
 * y no hay CORS que validar.
 */
function originAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (corsOrigins.includes(origin)) return true;

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/**
 * Canal de eventos en tiempo real.
 *
 * La ruta vive bajo `/api` para que los proxies de producción la sirvan sin
 * reglas extra y para que el navegador use el mismo origen que el resto de la
 * API (y con ello la cookie de sesión).
 */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, async (socket, request) => {
    if (!originAllowed(request)) {
      socket.close(CLOSE_FORBIDDEN_ORIGIN, 'Origen no permitido');
      return;
    }

    const userId = await authenticateSocket(request);
    if (!userId) {
      socket.close(CLOSE_UNAUTHENTICATED, 'Sesión no autenticada');
      return;
    }

    registerClient(userId, socket);
    socket.on('close', () => unregisterClient(userId, socket));
    socket.on('error', () => unregisterClient(userId, socket));
    // El canal es de una sola vía: el cliente solo lo usa para el latido.
    socket.on('message', (raw) => {
      if (raw.toString() === 'ping') socket.send('pong');
    });

    socket.send(
      JSON.stringify({
        type: 'connection.ready',
        payload: null,
        ts: new Date().toISOString(),
      }),
    );
  });
}
