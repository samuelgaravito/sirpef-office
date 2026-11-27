import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../../db/index.js';
import { pushSubscriptions } from '../../db/schema.js';
import { authenticate } from '../../lib/auth-guard.js';
import { badRequest } from '../../lib/errors.js';
import { sendPushToUsers, vapidPublicKey } from './push.js';

const subscribeSchema = z.object({
  platform: z.enum(['web', 'android']).default('web'),
  endpoint: z.string().trim().min(1).max(4096),
  keys: z
    .object({
      p256dh: z.string().trim().min(1).max(512),
      auth: z.string().trim().min(1).max(512),
    })
    .optional(),
  deviceId: z.uuid().optional(),
  appVersion: z.string().trim().max(40).optional(),
  userAgent: z.string().trim().max(500).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().trim().min(1).max(4096),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /** Clave pública VAPID: el navegador la necesita antes de suscribirse. */
  app.get('/public-key', async (_request, reply) => {
    const publicKey = vapidPublicKey();
    if (!publicKey) {
      return reply.status(404).send({
        code: 'PUSH_DISABLED',
        message: 'Las notificaciones push no están configuradas en este servidor',
      });
    }
    return { publicKey };
  });

  /** Alta o renovación de la suscripción de este navegador o móvil. */
  app.post('/subscribe', async (request) => {
    const user = await authenticate(request);
    const body = subscribeSchema.parse(request.body);

    if (body.platform === 'web' && !body.keys) {
      throw badRequest('Faltan las claves de la suscripción web (p256dh y auth)');
    }

    const [row] = await db
      .insert(pushSubscriptions)
      .values({
        userId: user.sub,
        platform: body.platform,
        endpoint: body.endpoint,
        p256dh: body.keys?.p256dh ?? null,
        auth: body.keys?.auth ?? null,
        deviceId: body.deviceId ?? null,
        appVersion: body.appVersion ?? '',
        userAgent: body.userAgent ?? request.headers['user-agent'] ?? '',
        status: 'active',
        failureCount: 0,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: user.sub,
          platform: body.platform,
          p256dh: body.keys?.p256dh ?? null,
          auth: body.keys?.auth ?? null,
          deviceId: body.deviceId ?? null,
          appVersion: body.appVersion ?? '',
          userAgent: body.userAgent ?? request.headers['user-agent'] ?? '',
          status: 'active',
          failureCount: 0,
          lastUsedAt: new Date(),
        },
      })
      .returning({ id: pushSubscriptions.id, platform: pushSubscriptions.platform });

    return { ok: true, id: row?.id, platform: row?.platform };
  });

  /** Baja de la suscripción al cerrar sesión o desactivar los avisos. */
  app.post('/unsubscribe', async (request) => {
    const user = await authenticate(request);
    const body = unsubscribeSchema.parse(request.body);
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.userId, user.sub),
        ),
      );
    return { ok: true };
  });

  /** Aviso de prueba: solo al usuario actual y a sus dispositivos. */
  app.post('/test', async (request) => {
    const user = await authenticate(request);
    await sendPushToUsers([user.sub], {
      title: 'Notificaciones activadas',
      body: 'Este es un aviso de prueba de SirpefOffice.',
      url: '/settings',
      type: 'notification.test',
    });
    return { ok: true };
  });
}
