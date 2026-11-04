import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Carga backend/.env
for (const path of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (existsSync(path)) loadEnv({ path, override: false });
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Falta DATABASE_URL. Copia .env.example a .env dentro de backend/.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
