import { eq } from 'drizzle-orm';

import type { VariableDef, VariableValues } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { appSettings } from '../../db/schema.js';
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { chat, type AiConfig, type AiProviderName } from './providers.js';
import { coerce, describeVariable, extractJsonObject, isEmpty } from './values.js';

const SETTINGS_KEY = 'ai';

/* ─────────────────────────── Configuración ─────────────────────────── */

/** Configuración derivada del .env (valores de fábrica). */
export function envConfig(): AiConfig {
  const defaults: AiConfig = {
    provider: env.AI_PROVIDER as AiProviderName,
    baseUrl: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    temperature: 0.4,
    maxTokens: 2500,
  };

  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return { ...defaults, apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, baseUrl: 'https://api.anthropic.com' };
    case 'gemini':
      return {
        ...defaults,
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      };
    case 'ollama':
      return { ...defaults, baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL, apiKey: '' };
    default:
      return defaults;
  }
}

/** Lee la configuración activa: primero la base de datos, luego el .env. */
export async function loadConfig(): Promise<AiConfig> {
  const base = envConfig();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  if (!row) return base;

  const stored = row.value as Partial<AiConfig>;
  return {
    provider: (stored.provider as AiProviderName) ?? base.provider,
    baseUrl: stored.baseUrl ?? base.baseUrl,
    apiKey: stored.apiKey ?? base.apiKey,
    model: stored.model ?? base.model,
    temperature: typeof stored.temperature === 'number' ? stored.temperature : base.temperature,
    maxTokens: typeof stored.maxTokens === 'number' ? stored.maxTokens : base.maxTokens,
  };
}

export interface PublicAiConfig {
  provider: AiProviderName;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  hasApiKey: boolean;
  configured: boolean;
}

export function toPublicConfig(config: AiConfig): PublicAiConfig {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    hasApiKey: config.apiKey.length > 0,
    configured: config.provider !== 'none' && (config.provider === 'ollama' || config.apiKey.length > 0),
  };
}

export async function saveConfig(patch: Partial<AiConfig>, userId: string): Promise<AiConfig> {
  const current = await loadConfig();

  const next: AiConfig = {
    provider: patch.provider ?? current.provider,
    baseUrl: patch.baseUrl ?? current.baseUrl,
    apiKey: patch.apiKey === undefined || patch.apiKey === '' ? current.apiKey : patch.apiKey,
    model: patch.model ?? current.model,
    temperature: patch.temperature ?? current.temperature,
    maxTokens: patch.maxTokens ?? current.maxTokens,
  };

  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: next as unknown as Record<string, unknown>, updatedBy: userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date(), updatedBy: userId },
    });

  return next;
}

export async function clearApiKey(userId: string): Promise<AiConfig> {
  const current = await loadConfig();
  const next: AiConfig = { ...current, apiKey: '' };

  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: next as unknown as Record<string, unknown>, updatedBy: userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date(), updatedBy: userId },
    });

  return next;
}

export async function testConnection(config: AiConfig): Promise<{ ok: boolean; latencyMs: number; sample: string }> {
  const started = Date.now();
  const sample = await chat(
    config,
    [
      { role: 'system', content: 'Eres un asistente conciso. Responde en español.' },
      { role: 'user', content: 'Responde únicamente con la palabra: OK' },
    ],
    false,
  );

  return { ok: true, latencyMs: Date.now() - started, sample: sample.trim().slice(0, 120) };
}

/* ─────────────────────── Rellenado de variables ─────────────────────── */

export interface GenerateOptions {
  title: string;
  docType: string;
  schema: VariableDef[];
  data: VariableValues;
  instructions?: string | null;
  overwrite?: boolean;
}

/** Pide al modelo que rellene las variables vacías del documento. */
export async function generateVariables(
  config: AiConfig,
  options: GenerateOptions,
): Promise<{ data: VariableValues; filled: string[] }> {
  if (config.provider === 'none') {
    throw new AppError(
      400,
      'AI_NOT_CONFIGURED',
      'No hay proveedor de IA configurado. Elige uno en Ajustes o rellena los datos a mano.',
    );
  }

  if (options.schema.length === 0) {
    throw new AppError(400, 'AI_NO_SCHEMA', 'Este documento no tiene variables definidas');
  }

  const targets = options.schema.filter(
    (variable) => options.overwrite || isEmpty(options.data[variable.key]),
  );

  if (targets.length === 0) {
    throw new AppError(
      400,
      'AI_NOTHING_TO_DO',
      'Todos los campos ya están completos. Marca «sobrescribir» para regenerarlos.',
    );
  }

  const known = Object.fromEntries(
    Object.entries(options.data).filter(([, value]) => !isEmpty(value)),
  );

  const system = [
    'Eres un redactor experto en documentos administrativos en español (Perú).',
    'Escribes con un tono formal, claro y conciso, sin inventar datos verificables que no se te den.',
    'Respondes SIEMPRE con un único objeto JSON válido, sin markdown ni comentarios.',
  ].join(' ');

  const user = [
    `Documento: ${options.title} (${options.docType}).`,
    options.instructions ? `Instrucciones de la plantilla:\n"""${options.instructions}"""` : '',
    Object.keys(known).length
      ? `Datos ya conocidos (úsalos como contexto y no los contradigas):\n${JSON.stringify(known, null, 2)}`
      : '',
    `Rellena únicamente estos campos y devuelve un objeto JSON cuyas claves sean exactamente las indicadas:`,
    targets.map(describeVariable).join('\n'),
    'Si un dato no se puede deducir, redacta un contenido plausible y coherente para el resto del documento.',
    'No incluyas la clave "numero" ni correlativos: el sistema los asigna automáticamente.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await chat(config, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], true);

  const parsed = extractJsonObject(raw);
  const result: VariableValues = { ...options.data };
  const filled: string[] = [];

  for (const variable of targets) {
    if (!(variable.key in parsed)) continue;
    const value = coerce(variable, parsed[variable.key]);
    if (isEmpty(value)) continue;
    result[variable.key] = value;
    filled.push(variable.key);
  }

  if (filled.length === 0) {
    throw new AppError(502, 'AI_EMPTY_RESULT', 'La IA no devolvió valores utilizables');
  }

  return { data: result, filled };
}
