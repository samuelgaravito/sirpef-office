#!/usr/bin/env tsx
/**
 * Comprueba el alta y la baja de suscripciones push.
 *
 *   npx tsx scripts/push-smoke.ts
 *
 * Necesita PostgreSQL. No envía un push real: verifica el contrato de la API,
 * el aislamiento por usuario y la limpieza de la suscripción al darla de baja.
 */
import { and, eq } from 'drizzle-orm';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import { pushSubscriptions, users } from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function main(): Promise<void> {
  const app = await buildApp();
  const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) throw new Error('Se necesita un administrador');

  const token = await signAccessToken({
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const api = `http://127.0.0.1:${port}/api`;

  const call = async <T>(path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json()) as T;
    return { status: response.status, data };
  };

  const webEndpoint = `https://push.example.test/${Date.now()}`;
  const androidToken = `fcm-test-${Date.now()}`;

  try {
    const key = await fetch(`${api}/notifications/public-key`);
    assert([200, 404].includes(key.status), 'La clave VAPID responde (o indica que está desactivada)');

    const web = await call<{ ok: boolean }>('/notifications/subscribe', 'POST', {
      platform: 'web',
      endpoint: webEndpoint,
      keys: { p256dh: 'a'.repeat(40), auth: 'b'.repeat(20) },
    });
    assert(web.status === 200 && web.data.ok, 'Se registra una suscripción web');

    const android = await call<{ ok: boolean }>('/notifications/subscribe', 'POST', {
      platform: 'android',
      endpoint: androidToken,
      appVersion: 'test',
    });
    assert(android.status === 200 && android.data.ok, 'Se registra un token Android');

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, admin.id));
    assert(
      rows.some((row) => row.endpoint === webEndpoint) &&
        rows.some((row) => row.endpoint === androidToken),
      'Las dos suscripciones quedan asociadas al usuario',
    );

    const removed = await call<{ ok: boolean }>('/notifications/unsubscribe', 'POST', {
      endpoint: webEndpoint,
    });
    assert(removed.status === 200 && removed.data.ok, 'La suscripción web se da de baja');

    const [remaining] = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, admin.id),
          eq(pushSubscriptions.endpoint, webEndpoint),
        ),
      );
    assert(!remaining, 'La fila de la suscripción web ya no existe');

    console.log('\n✔ Push: todas las comprobaciones pasaron');
  } finally {
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, admin.id),
          eq(pushSubscriptions.platform, 'android'),
        ),
      );
    await app.close();
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
