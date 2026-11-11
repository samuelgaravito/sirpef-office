#!/usr/bin/env tsx
/**
 * Comprobación de los mensajes de error contra la base de datos real.
 *
 *   npx tsx scripts/error-db-smoke.ts
 *
 * Complementa a `error-smoke.ts`: aquí se provocan fallos que solo existen
 * cuando hay PostgreSQL de verdad (unicidad, clave foránea, conexión caída).
 */
import { eq } from 'drizzle-orm';

import { db, sql } from '../src/db/index.js';
import { documentShares, documents, users } from '../src/db/schema.js';
import { errorHandler } from '../src/lib/errors.js';
import { applySpanishZodMessages } from '../src/lib/validation.js';

applySpanishZodMessages();

interface Reply {
  statusCode: number;
  payload: { error?: string; message?: string; reference?: string };
}

/** Invoca el handler global con un error y devuelve lo que se enviaría. */
function handle(error: unknown): Reply {
  const reply = {
    statusCode: 0,
    payload: {} as Reply['payload'],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: Reply['payload']) {
      this.payload = body;
      return this;
    },
  };
  const request = {
    log: { error: () => {}, warn: () => {} },
  } as never;
  errorHandler(error as never, request, reply as never);
  return reply as unknown as Reply;
}

let failures = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`✔ ${name}`);
    console.log(`  ${detail}`);
  } else {
    failures += 1;
    console.log(`✖ ${name}`);
    console.log(`  ${detail}`);
  }
}

async function main(): Promise<void> {
  // 1. Unicidad real: dos usuarios con el mismo correo.
  const email = `error-smoke-${Date.now()}@example.test`;
  const [user] = await db
    .insert(users)
    .values({ email, name: 'Prueba de error', passwordHash: 'x' })
    .returning();
  if (!user) throw new Error('No se pudo crear el usuario de prueba');

  try {
    await db.insert(users).values({ email, name: 'Duplicado', passwordHash: 'x' });
    check('Correo duplicado', false, 'La inserción duplicada no falló (inesperado)');
  } catch (error) {
    const reply = handle(error);
    check(
      'Correo duplicado',
      reply.statusCode === 409 && reply.payload.message?.includes('correo') === true,
      `${reply.statusCode} ${reply.payload.error} — ${reply.payload.message}`,
    );
  }

  // 2. Clave foránea rota: compartir un documento con un usuario inexistente.
  try {
    await db.insert(documentShares).values({
      documentId: '00000000-0000-0000-0000-000000000000',
      userId: '00000000-0000-0000-0000-000000000000',
      permission: 'viewer',
    });
    check('Clave foránea rota', false, 'La inserción huérfana no falló (inesperado)');
  } catch (error) {
    const reply = handle(error);
    check(
      'Clave foránea rota',
      reply.statusCode === 409 && reply.payload.message?.includes('ya no existe') === true,
      `${reply.statusCode} ${reply.payload.error} — ${reply.payload.message}`,
    );
  }

  // 3. Identificador con formato inválido (uuid mal formado).
  try {
    await db.select().from(documents).where(eq(documents.id, 'no-so-un-uuid'));
    check('Uuid inválido', false, 'La consulta con uuid inválido no falló (inesperado)');
  } catch (error) {
    const reply = handle(error);
    check(
      'Uuid inválido',
      reply.statusCode === 400 && reply.payload.message?.includes('identificadores') === true,
      `${reply.statusCode} ${reply.payload.error} — ${reply.payload.message}`,
    );
  }

  // 4. Error desconocido: debe dar referencia y no filtrar detalles.
  const unknown = handle(new Error('secreto interno del servidor'));
  check(
    'Error desconocido',
    unknown.statusCode === 500 &&
      typeof unknown.payload.reference === 'string' &&
      !unknown.payload.message?.includes('secreto interno'),
    `${unknown.statusCode} ${unknown.payload.error} — ${unknown.payload.message}`,
  );

  await db.delete(users).where(eq(users.id, user.id));
  await sql.end();

  console.log(failures === 0 ? '\n✔ Errores de base de datos traducidos' : `\n✖ ${failures} fallos`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
