import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadEnvFile } from 'dotenv';
import { z } from 'zod';

/**
 * Carga backend/.env. También acepta ../.env como respaldo si se arranca
 * desde otra carpeta.
 */
function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) loadEnvFile({ path, override: false });
  }
}
loadDotEnv();

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** Booleano opcional de tres estados: `undefined` deja el valor por defecto. */
const optionalBool = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v.trim() === '') return undefined;
    return v === 'true' || v === '1';
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3101),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  /**
   * Fuerza el flag Secure de las cookies de sesión.
   * Sin definir: true en production, false en el resto.
   * Ponlo en false para probar sobre HTTP sin cambiar NODE_ENV.
   */
  COOKIE_SECURE: optionalBool,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET debe tener al menos 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET debe tener al menos 16 caracteres'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  SEED_ADMIN_EMAIL: z.string().default('admin@sirpefoffice.local'),
  SEED_ADMIN_PASSWORD: z.string().default('sirpefoffice'),
  SEED_ADMIN_NAME: z.string().default('Administrador'),

  /* ── SVA (registro único de identidad) ─────────────────────────────── */
  /**
   * local: solo cuentas locales (comportamiento histórico).
   * hybrid: SVA manda; se conserva el admin local de emergencia.
   * sva: solo SVA; el login local queda deshabilitado.
   */
  AUTH_MODE: z.enum(['local', 'hybrid', 'sva']).default('local'),
  SVA_SERVER_URL: z.string().default(''),
  SVA_API_KEY: z.string().default(''),
  SVA_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  SVA_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(10 * 60 * 1_000),
  /** Los usuarios de SVA renuevan su sesión local durante 7 días. */
  SVA_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  AI_PROVIDER: z.enum(['openai', 'anthropic', 'gemini', 'ollama', 'none']).default('none'),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1'),

  CHROME_PATH: z.string().default('/usr/bin/google-chrome'),
  EXPORT_DIR: z.string().default('./data/exports'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3101/auth/google/callback'),
  GOOGLE_DOCUMENT_ID: z.string().default(''),

  // Reservado para futuros usos
  ENABLE_TRACKED_CHANGES: bool,
});

const parsed = envSchema
  .superRefine((value, ctx) => {
    if (value.AUTH_MODE === 'local') return;
    if (!value.SVA_SERVER_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SVA_SERVER_URL'],
        message: 'SVA_SERVER_URL es obligatorio cuando AUTH_MODE es hybrid o sva',
      });
    }
    if (!value.SVA_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SVA_API_KEY'],
        message: 'SVA_API_KEY es obligatorio cuando AUTH_MODE es hybrid o sva',
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error('\n✖ Configuración inválida:\n' + issues);
  console.error('\nRevisa el archivo .env (plantilla en .env.example).\n');
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
