/**
 * Sincroniza la proyección local con SVA y reporta usuarios locales que no
 * existen en SVA.
 *
 * Uso: npm run sva:sync
 */
import { and, eq, ne, sql } from 'drizzle-orm';

import { db, sql as connection } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { syncSvaUsers } from '../src/lib/sva-sync.js';

async function main(): Promise<void> {
  if (env.AUTH_MODE === 'local') {
    console.error('AUTH_MODE=local: configura SVA_SERVER_URL y SVA_API_KEY antes de sincronizar.');
    process.exitCode = 1;
    return;
  }

  const result = await syncSvaUsers();
  console.log('\nSincronización con SVA');
  console.log(`  Usuarios remotos : ${result.total}`);
  console.log(`  Creados          : ${result.created}`);
  console.log(`  Actualizados     : ${result.updated}`);
  console.log(`  Desactivados     : ${result.deactivated}`);
  console.log(`  Omitidos         : ${result.skipped}`);

  if (result.errors.length > 0) {
    console.log('\nIncidencias (corrígelas en SVA):');
    for (const error of result.errors) console.log(`  · ${error}`);
  }

  const unmatched = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.authProvider, 'local'),
        eq(users.isActive, true),
        ne(sql`lower(${users.email})`, env.SEED_ADMIN_EMAIL.toLowerCase()),
      ),
    );

  if (unmatched.length > 0) {
    console.log('\nUsuarios locales que no están en SVA (solo break-glass):');
    for (const user of unmatched) console.log(`  · ${user.name} <${user.email}>`);
  }
}

try {
  await main();
} catch (error) {
  console.error('No se pudo sincronizar con SVA:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await connection.end({ timeout: 5 });
}
