#!/usr/bin/env tsx
/**
 * Canje de una sesión SVA por una sesión local sin cookies.
 *
 *   npm run smoke:mobile-auth
 *
 * Levanta un SVA simulado en un puerto efímero y llama con `app.inject()` a
 * `/api/auth/mobile/sva` y `/api/mobile/bootstrap`. No necesita el SVA real.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import { eq } from 'drizzle-orm';

async function main(): Promise<void> {
  const email = `sva-mobile-smoke-${Date.now()}@example.test`;
  const uuid = randomUUID();

  const server: Server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/auth/system/session') {
      response.writeHead(404).end('not found');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      token?: string;
      api_key?: string;
    };

    if (body.api_key !== 'smoke-api-key' || body.token !== 'smoke-sva-token') {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ msg: 'ACCESS DENIED' }));
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: 200,
      message: 'OK',
      data: {
        system: { id: 1, name: 'SirpefOffice' },
        user: {
          uuid,
          name: 'Usuario SVA de prueba',
          email,
          cedula: 'V-00000001',
          avatar: null,
          role: 'admin',
          roleName: 'Administrador',
          systemId: 1,
        },
      },
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir el SVA simulado');

  process.env.AUTH_MODE = 'sva';
  process.env.SVA_SERVER_URL = `http://127.0.0.1:${address.port}`;
  process.env.SVA_API_KEY = 'smoke-api-key';

  const { buildApp } = await import('../src/app.js');
  const { db, sql } = await import('../src/db/index.js');
  const { users } = await import('../src/db/schema.js');

  const app = await buildApp();
  try {
    const exchange = await app.inject({
      method: 'POST',
      url: '/api/auth/mobile/sva',
      headers: { 'content-type': 'application/json' },
      payload: { token: 'smoke-sva-token' },
    });

    if (exchange.statusCode !== 200) {
      throw new Error(`Canje falló: ${exchange.statusCode} ${exchange.body}`);
    }
    const session = JSON.parse(exchange.body) as {
      accessToken?: string;
      refreshToken?: string;
      user?: { email?: string; role?: string };
    };
    if (!session.accessToken || !session.refreshToken) {
      throw new Error('La respuesta no incluyó accessToken y refreshToken');
    }
    if (session.user?.email !== email) {
      throw new Error(`Email inesperado: ${session.user?.email}`);
    }
    console.log('✔ SVA se canjea por una sesión local sin cookies');
    console.log('✔ El usuario se materializa en la tabla local');

    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/mobile/bootstrap',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    if (bootstrap.statusCode !== 200) {
      throw new Error(`Bootstrap falló: ${bootstrap.statusCode} ${bootstrap.body}`);
    }
    const data = JSON.parse(bootstrap.body) as { user?: { email?: string } };
    if (data.user?.email !== email) throw new Error('Bootstrap devolvió otro usuario');
    console.log('✔ El access token nativo abre /api/mobile/bootstrap');

    const [created] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!created) throw new Error('El usuario no quedó en la base');
  } finally {
    await db.delete(users).where(eq(users.email, email));
    await app.close();
    server.close();
    await sql.end({ timeout: 5 });
  }

  console.log('\n✔ Flujo de autenticación móvil con SVA completo');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
