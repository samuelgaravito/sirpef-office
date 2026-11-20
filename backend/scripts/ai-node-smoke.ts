#!/usr/bin/env tsx
/**
 * Prueba del túnel de nodos de IA (`/api/ai/node`).
 *
 *   npm run smoke:ai-node
 *
 * No necesita GPU ni Ollama: un agente falso responde por WebSocket. Sí
 * necesita PostgreSQL, porque el handshake valida el token contra `ai_nodes`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { eq } from 'drizzle-orm';
import WebSocket from 'ws';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import { aiNodes, users } from '../src/db/schema.js';
import { chatViaNode, isOnline } from '../src/modules/ai/nodes/registry.js';
import { chat } from '../src/modules/ai/providers.js';

let failures = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`✔ ${name}`);
  } else {
    failures += 1;
    console.log(`✖ ${name}`);
  }
  console.log(`  ${detail}`);
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${port}/api/ai/node`;

  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('El smoke necesita al menos un usuario en la base');

  const token = randomBytes(32).toString('base64url');
  const [node] = await db
    .insert(aiNodes)
    .values({ userId: user.id, name: 'PC de prueba', tokenHash: hash(token) })
    .returning();

  if (!node) throw new Error('No se pudo crear el nodo de prueba');

  const sockets: WebSocket[] = [];
  let revokedId: string | null = null;
  let fallbackServer: ReturnType<typeof createServer> | null = null;

  try {
    // 1. Token inválido: el servidor cierra el handshake.
    const rejected = await new Promise<number>((resolve, reject) => {
      const bad = new WebSocket(url, { headers: { authorization: 'Bearer token-invalido' } });
      sockets.push(bad);
      bad.on('close', (code) => resolve(code));
      bad.on('error', () => resolve(4401));
      setTimeout(() => reject(new Error('El handshake inválido no cerró')), 5_000);
    });
    check('rechaza un token inválido', rejected === 4401, `código de cierre ${rejected}`);

    // 1b. Un equipo revocado tampoco entra, aunque el token exista.
    const revokedToken = randomBytes(32).toString('base64url');
    const [revoked] = await db
      .insert(aiNodes)
      .values({
        userId: user.id,
        name: 'PC revocada',
        tokenHash: hash(revokedToken),
        revokedAt: new Date(),
      })
      .returning();
    revokedId = revoked?.id ?? null;

    const revokedCode = await new Promise<number>((resolve) => {
      const socket = new WebSocket(url, {
        headers: { authorization: `Bearer ${revokedToken}` },
      });
      sockets.push(socket);
      socket.on('close', (code) => resolve(code));
      socket.on('error', () => resolve(4401));
    });
    check('rechaza un equipo revocado', revokedCode === 4401, `código de cierre ${revokedCode}`);

    // 2. Agente falso: responde a los trabajos con NDJSON como Ollama.
    const agent = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    sockets.push(agent);

    const jobs: string[] = [];
    agent.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type?: string;
        id?: string;
        path?: string;
      };
      if (message.type !== 'job' || !message.id) return;
      jobs.push(message.path ?? '');
      agent.send(
        JSON.stringify({ type: 'chunk', id: message.id, data: '{"message":{"content":"Hola "}}\n' }),
      );
      agent.send(
        JSON.stringify({ type: 'chunk', id: message.id, data: '{"message":{"content":"equipo"}}\n' }),
      );
      agent.send(JSON.stringify({ type: 'done', id: message.id }));
    });

    await new Promise<void>((resolve, reject) => {
      agent.on('open', () => resolve());
      agent.on('error', (error) => reject(error));
      setTimeout(() => reject(new Error('El agente no conectó')), 5_000);
    });

    agent.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        version: '1.0.0',
        capabilities: {
          ollamaVersion: '0.20.0',
          models: ['qwen2.5:14b'],
          gpu: true,
          vramGb: 10.9,
          tokensPerSecond: 37.7,
        },
      }),
    );

    // El handshake del servidor hace una consulta a la base: hay que esperar a
    // que el nodo quede registrado antes de pedirle un trabajo.
    for (let i = 0; i < 40 && !isOnline(node.id); i += 1) await sleep(50);
    check('el agente queda registrado', isOnline(node.id), 'el nodo figura conectado');

    // 3. Un trabajo completo: llega el NDJSON y se acumula el contenido.
    const progress: number[] = [];
    const content = await chatViaNode(node.id, { model: 'qwen2.5:14b', messages: [] }, (chars) =>
      progress.push(chars),
    );
    check('el chat viaja por el túnel', content === 'Hola equipo', `contenido «${content}»`);
    check('se informa el avance', progress.length > 0, `${progress.length} aviso(s)`);
    check(
      'el trabajo pide /api/chat',
      jobs.length === 1 && jobs[0] === '/api/chat',
      `rutas: ${jobs.join(', ')}`,
    );

    // 4. El servidor cierra la conexión y el nodo queda fuera de servicio.
    agent.close();
    await sleep(150);
    let offline = false;
    try {
      await chatViaNode(node.id, { model: 'qwen2.5:14b', messages: [] });
    } catch (error) {
      offline = (error as { code?: string }).code === 'AI_NODE_OFFLINE';
    }
    check('sin agente responde AI_NODE_OFFLINE', offline, 'el fallo se explica y no se cuelga');

    // 5. Si el equipo se cae, la llamada se reintenta en el proveedor del
    //    servidor (un Ollama falso en un puerto local).
    fallbackServer = createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== '/api/chat') {
        response.writeHead(404).end();
        return;
      }
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: { content: 'respuesta del servidor' } }));
    });
    await new Promise<void>((resolve) => fallbackServer?.listen(0, '127.0.0.1', resolve));

    const fallbackPort = (fallbackServer.address() as AddressInfo).port;
    const serverConfig = {
      provider: 'ollama' as const,
      baseUrl: `http://127.0.0.1:${fallbackPort}`,
      apiKey: '',
      model: 'qwen2.5:14b',
      temperature: 0.2,
      maxTokens: 120,
    };
    const fromServer = await chat(
      {
        ...serverConfig,
        node: { id: 'equipo-caido', name: 'Equipo caído' },
        fallback: serverConfig,
      },
      [{ role: 'user', content: 'hola' }],
      false,
    );
    check(
      'reintenta en el servidor si el equipo se cae',
      fromServer === 'respuesta del servidor',
      `contenido «${fromServer}»`,
    );
  } finally {
    if (fallbackServer?.listening) {
      await new Promise<void>((resolve) => fallbackServer?.close(() => resolve()));
    }
    if (revokedId) await db.delete(aiNodes).where(eq(aiNodes.id, revokedId));
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        socket.terminate();
      }
    }
    await db.delete(aiNodes).where(eq(aiNodes.id, node.id));
    await app.close();
    await sql.end({ timeout: 5 });
  }

  console.log(
    failures === 0
      ? '\nRESULTADO: todas las comprobaciones pasaron'
      : `\nRESULTADO: ${failures} comprobación(es) fallaron`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('El smoke falló:', error);
  process.exit(1);
});
