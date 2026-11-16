import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import { corsOrigins, env, isProduction } from './env.js';
import { errorHandler } from './lib/errors.js';
import { applySpanishZodMessages } from './lib/validation.js';
import { authRoutes } from './modules/auth/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { designRoutes } from './modules/designs/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { exportRoutes } from './modules/exports/routes.js';
import { inboxRoutes } from './modules/inbox/routes.js';
import { menuRoutes } from './modules/menus/routes.js';
import { numberingRoutes } from './modules/numbering/routes.js';
import { realtimeRoutes } from './modules/realtime/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { systemRoutes } from './modules/system/routes.js';
import { templateRoutes } from './modules/templates/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  // Los mensajes de validación de Zod llegan al formulario: en español.
  applySpanishZodMessages();

  const app = Fastify({
    logger: isProduction
      ? { level: 'info' }
      : {
          level: 'debug',
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        },
    // Los documentos con imágenes embebidas pueden pesar varios MB
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      // Permite herramientas sin Origin (curl, Postman) y los orígenes configurados
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origen no permitido: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, {
    secret: env.JWT_REFRESH_SECRET,
    hook: 'onRequest',
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    allowList: [],
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  });

  // El canal de eventos en tiempo real se registra en el ámbito raíz: su
  // hook de ruta es lo que convierte en WebSocket las rutas con la opción
  // `websocket: true`, y debe estar activo antes de declararlas.
  await app.register(websocket);

  app.setErrorHandler(errorHandler);

  app.get('/api/health', async () => ({
    ok: true,
    service: 'sirpefoffice-api',
    version: '0.1.0',
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(menuRoutes, { prefix: '/api/menus' });
  await app.register(aiRoutes, { prefix: '/api' });
  await app.register(templateRoutes, { prefix: '/api/templates' });
  await app.register(numberingRoutes, { prefix: '/api/numbering' });
  await app.register(designRoutes, { prefix: '/api/designs' });
  await app.register(documentRoutes, { prefix: '/api/documents' });
  await app.register(exportRoutes, { prefix: '/api/documents' });
  await app.register(inboxRoutes, { prefix: '/api/inbox' });
  await app.register(statsRoutes, { prefix: '/api/stats' });
  await app.register(realtimeRoutes, { prefix: '/api' });
  await app.register(systemRoutes, { prefix: '/api/system' });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'NOT_FOUND',
      message: `Ruta no encontrada: ${request.method} ${request.url}`,
    });
  });

  return app;
}
