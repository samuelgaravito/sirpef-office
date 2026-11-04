import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * Cliente de PostgreSQL. `max` se mantiene bajo para no agotar los conexiones
 * del contenedor en desarrollo; en producción conviene subirlo.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 15,
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export type Database = typeof db;
export { schema };
