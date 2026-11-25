#!/usr/bin/env tsx
/**
 * Comprueba que un documento enviado desde la web aparece en la bandeja
 * «Recibidos» de la API móvil, que es lo que consume la app Android.
 */
import { eq } from 'drizzle-orm';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import { documents, users } from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function main(): Promise<void> {
  const app = await buildApp();
  const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) throw new Error('Se necesita un administrador');

  const [member] = await db
    .insert(users)
    .values({
      email: `smoke-received-${Date.now()}@example.com`,
      name: 'Destinatario de prueba',
      role: 'member',
      isActive: true,
    })
    .returning();
  if (!member) throw new Error('No se pudo crear el destinatario');

  const tokenFor = (user: typeof admin) =>
    signAccessToken({ sub: user.id, email: user.email, name: user.name, role: user.role });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const api = `http://127.0.0.1:${port}/api`;

  const call = async <T>(path: string, token: string, method = 'GET', body?: unknown) => {
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

  let documentId: string | null = null;

  try {
    const adminToken = await tokenFor(admin);
    const memberToken = await tokenFor(member);

    const created = await call<{ document: { id: string; version: number } }>(
      '/documents',
      adminToken,
      'POST',
      { title: 'Documento recibido de prueba' },
    );
    assert(created.status === 201, 'El administrador crea un documento');
    documentId = created.data.document.id;

    const sent = await call<{ id: string; status: string }>('/inbox', adminToken, 'POST', {
      documentId,
      recipientIds: [member.id],
      subject: 'Envío directo de prueba',
      body: 'Comprueba la bandeja Recibidos.',
      expectedVersion: created.data.document.version,
    });
    assert(sent.status === 201 && sent.data.status === 'sent', 'El envío directo se crea');

    const received = await call<{
      items: Array<{ id: string; documentId: string; subject: string }>;
      total?: number;
    }>('/mobile/documents?scope=received', memberToken);
    assert(received.status === 200, 'La bandeja móvil de recibidos responde');
    assert(
      received.data.items.some(
        (item) => item.id === sent.data.id && item.documentId === documentId,
      ),
      'El documento enviado aparece en Recibidos sin refrescar',
    );

    const bootstrap = await call<{ counts: { received: number } }>(
      '/mobile/bootstrap',
      memberToken,
    );
    assert(
      bootstrap.status === 200 && bootstrap.data.counts.received >= 1,
      'El contador de recibidos se actualiza',
    );

    const pending = await call<{ items: unknown[] }>('/mobile/documents?scope=pending', memberToken);
    assert(
      pending.status === 200 && pending.data.items.length === 0,
      'Un miembro no ve pendientes de firma',
    );

    console.log('\n✔ Bandeja móvil Recibidos: todas las comprobaciones pasaron');
  } finally {
    if (documentId) {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
    await db.delete(users).where(eq(users.id, member.id));
    await app.close();
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
