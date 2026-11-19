/**
 * Añade el módulo «Estadísticas» a los usuarios existentes.
 *
 * La clave `stats` nace activa para las cuentas nuevas (`DEFAULT_MENU_KEYS`),
 * pero las que ya existían guardan su selección en `users.menu_keys` y no la
 * reciben solas. Este script **solo añade**: nunca quita un menú asignado y es
 * idempotente.
 *
 * Uso:
 *   npm run db:migrate:stats-menu
 */
import { normalizeMenuKeys } from '@sirpefoffice/shared';
import postgres from 'postgres';

import { env } from '../src/env.js';

interface UserRow {
  id: string;
  email: string;
  menu_keys: string[] | null;
}

async function main(): Promise<void> {
  const sql = postgres(env.DATABASE_URL, { max: 5, onnotice: () => {} });

  try {
    const rows = await sql<UserRow[]>`
      select id, email, menu_keys
      from users
      order by created_at asc
    `;

    let changed = 0;

    await sql.begin(async (tx) => {
      for (const row of rows) {
        const current = Array.isArray(row.menu_keys) ? row.menu_keys : [];
        const next = normalizeMenuKeys([...current, 'stats']);
        const unchanged =
          next.length === current.length && next.every((key, index) => key === current[index]);
        if (unchanged) continue;

        await tx`
          update users
          set menu_keys = ${next}::text[], updated_at = now()
          where id = ${row.id}
        `;
        changed += 1;
      }
    });

    if (changed === 0) {
      console.log('✔ Todos los usuarios ya tienen el módulo Estadísticas.');
    } else {
      console.log(`✔ ${changed} usuario(s) recibieron el módulo Estadísticas.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('Error habilitando el módulo Estadísticas:', error);
  process.exit(1);
});
