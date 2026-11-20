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
import type { AddressInfo } from 'node:net';

import { eq } from 'drizzle-orm';
import WebSocket from 'ws';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import { aiNodes, users } from '../src/db/schema.js';
import { chatViaNode, isOnline } from '../src/modules/ai/nodes/registry.js';

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
  } finally {
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
