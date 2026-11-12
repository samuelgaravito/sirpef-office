#!/usr/bin/env tsx
/**
 * Comprobación del canal de eventos en tiempo real.
 *
 *   npx tsx scripts/realtime-smoke.ts
 *
 * Necesita PostgreSQL (el handshake lee la tabla de usuarios para validar la
 * sesión). Levanta la API en un puerto libre y comprueba que:
 *  - una conexión sin sesión se rechaza,
 *  - una conexión con la cookie de sesión recibe el saludo del servidor,
 *  - un evento solo llega a los destinatarios,
 *  - el envío de un documento avisa al administrador y su aprobación avisa
 *    al remitente, sin necesidad de recargar la página.
 */
import { eq, inArray } from 'drizzle-orm';
import { WebSocket } from 'ws';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import { documents, users } from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { publishInboxEvent } from '../src/modules/realtime/events.js';
import { startRealtimeListener, stopRealtimeListener } from '../src/modules/realtime/hub.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

/** Espera el siguiente mensaje del socket. */
function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('✖ No llegó ningún mensaje')), 5000);
    socket.once('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
  });
}

/** Espera a que llegue un evento de un tipo concreto (o se agota el tiempo). */
async function waitForEvent(
  socket: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await Promise.race([
      nextMessage(socket).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    if (!message) continue;
    if (message.type === type) return message;
  }
  return null;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await startRealtimeListener(app.log);

  const [admin] = await db
    .select()
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1);

  const [member] = await db
    .insert(users)
    .values({
      email: `smoke-realtime-${Date.now()}@example.com`,
      name: 'Asistente de prueba',
      role: 'member' as const,
      isActive: true,
    })
    .returning();

  if (!admin || !member) throw new Error('Se necesitan un admin y un member activos');

  const tokenFor = (user: typeof admin): Promise<string> =>
    signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const wsUrl = `ws://127.0.0.1:${port}/api/ws`;
  const api = `http://127.0.0.1:${port}/api`;

  const open = async (token?: string): Promise<{ socket: WebSocket; closed: Promise<number> }> => {
    const headers = token ? { cookie: `sd_access=${token}` } : undefined;
    const socket = new WebSocket(wsUrl, { headers });
    const closed = new Promise<number>((resolve) => {
      socket.on('close', (code) => resolve(code));
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', (error) => reject(error));
    });
    return { socket, closed };
  };

  const call = async <T>(
    path: string,
    token: string,
    method = 'GET',
    body?: unknown,
  ): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* respuesta de texto */
    }
    return { status: response.status, body: parsed as T };
  };

  const createdDocumentIds: string[] = [];

  try {
    /* 1. Sin sesión no hay canal. */
    const anonymous = await open();
    const anonymousCode = await anonymous.closed;
    assert(anonymousCode === 4401, 'Una conexión sin sesión se cierra con 4401');

    /* 2. Con sesión, el servidor saluda. */
    const memberSocket = await open(await tokenFor(member));
    const greeting = await nextMessage(memberSocket.socket);
    assert(
      greeting.type === 'connection.ready',
      'Con sesión válida el servidor saluda con connection.ready',
    );

    const adminSocket = await open(await tokenFor(admin));
    await nextMessage(adminSocket.socket);

    /* 3. Un evento solo llega a su destinatario. */
    const forMember = nextMessage(memberSocket.socket);
    const forAdmin = nextMessage(adminSocket.socket);

    await publishInboxEvent({
      type: 'inbox.message.created',
      userIds: [member.id],
      messageId: '00000000-0000-4000-8000-000000000001',
      documentId: '00000000-0000-4000-8000-000000000002',
      documentTitle: 'Memo de prueba',
      subject: 'Prueba de tiempo real',
      actorName: 'Remitente',
      status: 'sent',
    });

    const received = await forMember;
    assert(received.type === 'inbox.message.created', 'El destinatario recibe el evento');
    const payload = received.payload as { subject?: string; actorName?: string } | null;
    assert(payload?.subject === 'Prueba de tiempo real', 'El evento llega con su contenido');
    assert(payload?.actorName === 'Remitente', 'El evento indica quién lo provocó');

    const leaked = await Promise.race([
      forAdmin.then(() => 'recibido'),
      new Promise<string>((resolve) => setTimeout(() => resolve('silencio'), 700)),
    ]);
    assert(leaked === 'silencio', 'Un usuario que no es destinatario no recibe el evento');

    /* 4. El envío de un documento avisa al administrador que puede aprobarlo. */
    const memberToken = await tokenFor(member);
    const adminToken = await tokenFor(admin);

    const created = await call<{ document: { id: string; version: number } }>(
      '/documents',
      memberToken,
      'POST',
      {},
    );
    assert(created.status === 201, 'El asistente crea un borrador');
    const documentId = created.body.document.id;
    createdDocumentIds.push(documentId);

    const pendingForAdmin = waitForEvent(adminSocket.socket, 'inbox.message.pending');
    const submitted = await call<{ id: string; status: string }>('/inbox', memberToken, 'POST', {
      documentId,
      recipientIds: [admin.id],
      subject: 'Revisión de tiempo real',
      body: 'Adjunto el memo para revisión.',
      expectedVersion: created.body.document.version,
    });
    assert(submitted.status === 201, 'El asistente solicita el envío');
    assert(submitted.body.status === 'pending_approval', 'El envío queda pendiente de aprobación');

    const pendingEvent = await pendingForAdmin;
    assert(
      pendingEvent !== null,
      'El administrador recibe el aviso de envío pendiente sin recargar la página',
    );
    const pendingPayload = pendingEvent?.payload as { subject?: string } | null;
    assert(
      pendingPayload?.subject === 'Revisión de tiempo real',
      'El aviso de pendiente lleva el asunto del envío',
    );

    /* 5. La aprobación avisa al remitente. */
    const approvedForMember = waitForEvent(memberSocket.socket, 'inbox.result.approved');
    const approved = await call<{ status: string }>(
      `/inbox/${submitted.body.id}/approve`,
      adminToken,
      'POST',
      { expectedVersion: created.body.document.version },
    );
    assert(approved.status === 200, 'El administrador aprueba el envío');

    const resultEvent = await approvedForMember;
    assert(
      resultEvent !== null,
      'El remitente recibe el aviso de aprobación sin recargar la página',
    );
    const resultPayload = resultEvent?.payload as { actorName?: string } | null;
    assert(
      resultPayload?.actorName === admin.name,
      'El aviso de aprobación indica quién aprobó',
    );

    console.log('\n✔ Tiempo real: todas las comprobaciones pasaron');
  } finally {
    await stopRealtimeListener(app.log);
    await app.close();
    if (createdDocumentIds.length > 0) {
      await db.delete(documents).where(inArray(documents.id, createdDocumentIds));
    }
    await db.delete(users).where(eq(users.id, member.id));
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
