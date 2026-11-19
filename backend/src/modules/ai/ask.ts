/**
 * Modo consulta: preguntas en lenguaje natural sobre los documentos.
 *
 * El modelo **no escribe SQL ni ve la base**. Solo traduce la pregunta a un
 * objeto de filtros; el servidor valida esos filtros, ejecuta la consulta con
 * las mismas reglas de visibilidad que el listado y construye la respuesta a
 * partir del resultado real. Por eso las cifras no pueden inventarse.
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DOCUMENT_STATUSES,
  type AiAskFilters,
  type AiAskGroup,
  type AiAskHistoryMessage,
  type AiAskResult,
  type AiAskRow,
  type DocType,
  type DocumentStatus,
  type StatsDocumentFilter,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { documents, templates } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { documentWhere, statsFor, STATUS_LABELS, templateMatches } from '../stats/query.js';
import { normalizeText } from '../../lib/text-search.js';
import { chat, type AiConfig } from './providers.js';
import { extractJsonObject } from './values.js';

/**
 * Filtros ya validados.
 *
 * El modelo se equivoca a menudo en los bordes (`limit: 100`, un estado
 * inventado, `approvedByMe: "true"`). Cada campo cae a su valor por defecto en
 * vez de invalidar toda la interpretación: perder un filtro es mucho mejor que
 * perder la consulta y acabar buscando el texto literal de la pregunta.
 */
const text = z.string().catch('');
const docTypeList = z
  .array(z.string())
  .catch([])
  .transform((list) =>
    list.filter((type): type is DocType => (DOC_TYPES as readonly string[]).includes(type)),
  );

const filtersSchema = z.object({
  intent: z.enum(['count', 'list', 'find']).catch('list'),
  groupBy: z.enum(['none', 'docType', 'status']).catch('none'),
  scope: z.enum(['mine', 'all']).catch('all'),
  docTypes: docTypeList,
  statuses: z
    .array(z.string())
    .catch([])
    .transform((list) =>
      list.filter((status): status is DocumentStatus =>
        (DOCUMENT_STATUSES as readonly string[]).includes(status),
      ),
    ),
  templateName: text,
  recipient: text,
  text,
  from: text,
  to: text,
  dateField: z.enum(['created', 'updated']).catch('created'),
  approvedByMe: z
    .preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean())
    .catch(false),
  limit: z
    .number()
    .catch(8)
    .transform((value) => Math.min(Math.max(Math.trunc(value), 1), 20)),
});

const questionSchema = z.object({ question: z.string().trim().min(3).max(500) });

export { questionSchema };

/**
 * Petición del modo consulta.
 *
 * `filters` es el camino determinista: la interfaz reenvía los filtros ya
 * aplicados (al pulsar una barra o quitar un chip) y el servidor los ejecuta
 * sin llamar al modelo. `history` permite seguimientos como «¿y el mes pasado?».
 */
export const askRequestSchema = questionSchema.extend({
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2_000),
      }),
    )
    .max(6)
    .optional(),
  filters: filtersSchema.optional(),
});

interface AskContext {
  userId: string;
}

function todayIso(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Esquema JSON de la interpretación: ata al modelo a los campos válidos. */
function filtersJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['count', 'list', 'find'],
        description: 'count = cuántos; list = listar; find = buscar uno concreto',
      },
      groupBy: {
        type: 'string',
        enum: ['none', 'docType', 'status'],
        description: 'Agrupar el conteo por tipo de documento o por estado',
      },
      scope: {
        type: 'string',
        enum: ['mine', 'all'],
        description: 'mine = solo los míos; all = míos y compartidos conmigo',
      },
      docTypes: { type: 'array', items: { type: 'string', enum: [...DOC_TYPES] } },
      statuses: { type: 'array', items: { type: 'string', enum: [...DOCUMENT_STATUSES] } },
      templateName: { type: 'string' },
      recipient: { type: 'string', description: 'Persona a la que va dirigido' },
      text: { type: 'string', description: 'Texto libre a buscar' },
      from: { type: 'string', description: 'Fecha inicial AAAA-MM-DD' },
      to: { type: 'string', description: 'Fecha final AAAA-MM-DD' },
      dateField: {
        type: 'string',
        enum: ['created', 'updated'],
        description: 'created = cuándo se creó; updated = cuándo se tocó por última vez',
      },
      approvedByMe: { type: 'boolean', description: 'Solo lo que aprobé yo' },
      limit: { type: 'integer' },
    },
    required: ['intent'],
  };
}

function buildPrompt(question: string, templateNames: string[]): string {
  const types = DOC_TYPES.map((type) => `${type} (${DOC_TYPE_LABELS[type]})`).join(', ');
  const statuses = DOCUMENT_STATUSES.map(
    (status) => `${status} (${STATUS_LABELS[status]})`,
  ).join(', ');

  return [
    'Traduce la pregunta a filtros de búsqueda de documentos. No respondas la pregunta: solo devuelve el JSON.',
    'Si un filtro no se menciona, déjalo vacío o en su valor por defecto. No inventes datos.',
    '',
    `Fecha de hoy: ${todayIso()}`,
    `Tipos de documento: ${types}`,
    `Estados: ${statuses}`,
    `Plantillas disponibles: ${templateNames.length > 0 ? templateNames.join(', ') : '(ninguna)'}`,
    '',
    'Cómo interpretar:',
    '- «cuántos», «cuántas» → intent = count.',
    '- «cuántos tipos», «de cada tipo», «por tipo» → intent = count y groupBy = docType.',
    '- «por estado» → intent = count y groupBy = status.',
    '- «firmé», «envié», «cerré» → intent = count con statuses ["final","sent","approved"] y scope "mine".',
    '- «aprobé», «revisé» → approvedByMe = true.',
    '- «este mes», «la semana pasada», «en noviembre» → rellena from y to con fechas ISO.',
    '- «hice», «creé», «subí» → scope = "mine" y dateField = "created".',
    '- «toqué», «modifiqué», «actualicé» → dateField = "updated". Por defecto "created".',
    '- «los últimos N», «mis 5 más recientes» → intent = list y limit = N.',
    '- «dirigidos a», «para», «a nombre de» → recipient.',
    '- Nombre de una persona o un asunto → text si no es un destinatario claro.',
    '- «míos», «mis documentos» → scope = "mine". Por defecto "all" (míos y compartidos).',
    '- Un seguimiento («¿y el mes pasado?», «solo los míos») completa los filtros de la conversación anterior; no repitas los que ya estaban.',
    '',
    `Pregunta: ${question}`,
  ].join('\n');
}

/** Filtros de reserva: buscan la pregunta como texto. */
export function fallbackFilters(question: string): AiAskFilters {
  return {
    intent: 'find',
    groupBy: 'none',
    scope: 'all',
    docTypes: [],
    statuses: [],
    templateName: '',
    recipient: '',
    text: question,
    from: '',
    to: '',
    dateField: 'created',
    approvedByMe: false,
    limit: 8,
  };
}

/**
 * Valida la interpretación del modelo.
 *
 * Devuelve `null` si no hay un objeto JSON utilizable. Cada campo inválido cae
 * a su valor por defecto: un modelo pequeño se equivoca a menudo en los bordes
 * y es mejor conservar el resto de filtros que perder la consulta entera.
 */
export function parseFilters(raw: string): AiAskFilters | null {
  try {
    const parsed = extractJsonObject(raw, 'AI_INVALID_JSON');
    const filters = filtersSchema.parse(parsed);
    if (filters.from && !isIsoDate(filters.from)) filters.from = '';
    if (filters.to && !isIsoDate(filters.to)) filters.to = '';
    return filters;
  } catch {
    return null;
  }
}

/** Palabras que, aunque el modelo dude, significan «solo lo mío». */
const POSSESSIVE = /\b(mis|mios|mias|mi|hice|hize|elabore|redacte|cree|subi)\b/;

function isoDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Primer y último día de un mes. */
function monthRange(year: number, month: number): { from: string; to: string } {
  return {
    from: isoDay(new Date(year, month, 1)),
    to: isoDay(new Date(year, month + 1, 0)),
  };
}

/**
 * Corrige con hechos de la pregunta lo que el modelo deja mal.
 *
 * Los modelos pequeños confunden «este mes» con el mes anterior y olvidan el
 * alcance con «mis últimos 5». Las expresiones de calendario y los posesivos
 * son señales fiables: se aplican aquí, sin depender de la interpretación.
 */
export function applyQuestionHints(
  filters: AiAskFilters,
  question: string,
  now: Date = new Date(),
): AiAskFilters {
  const text = normalizeText(question);

  if (POSSESSIVE.test(text) && filters.scope === 'all') filters.scope = 'mine';

  if (/\beste mes\b|\bmes actual\b|\bmes en curso\b/.test(text)) {
    const range = monthRange(now.getFullYear(), now.getMonth());
    filters.from = range.from;
    filters.to = range.to;
  } else if (/\bmes pasado\b|\bmes anterior\b|\bultimo mes\b/.test(text)) {
    const range = monthRange(now.getFullYear(), now.getMonth() - 1);
    filters.from = range.from;
    filters.to = range.to;
  } else if (/\beste ano\b|\bano actual\b/.test(text)) {
    filters.from = isoDay(new Date(now.getFullYear(), 0, 1));
    filters.to = isoDay(now);
  } else if (/\bano pasado\b|\bultimo ano\b/.test(text)) {
    filters.from = isoDay(new Date(now.getFullYear() - 1, 0, 1));
    filters.to = isoDay(new Date(now.getFullYear() - 1, 11, 31));
  } else if (/\besta semana\b|\bsemana actual\b/.test(text)) {
    const day = (now.getDay() + 6) % 7;
    filters.from = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - day));
    filters.to = isoDay(now);
  } else if (/\bsemana pasada\b|\bultima semana\b/.test(text)) {
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - 7);
    filters.from = isoDay(monday);
    filters.to = isoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
  } else if (/\bhoy\b/.test(text)) {
    filters.from = isoDay(now);
    filters.to = isoDay(now);
  } else if (/\bayer\b/.test(text)) {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    filters.from = isoDay(yesterday);
    filters.to = isoDay(yesterday);
  }

  return filters;
}

/** Pide al modelo la interpretación y la valida; si falla, busca por texto. */
async function interpret(
  config: AiConfig,
  question: string,
  templateNames: string[],
  history: AiAskHistoryMessage[] = [],
): Promise<AiAskFilters> {
  let raw: string;
  try {
    raw = await chat(
      { ...config, temperature: 0.1, maxTokens: 600 },
      [
        { role: 'system', content: buildPrompt(question, templateNames) },
        // Solo los últimos turnos: resuelven «¿y el mes pasado?» sin arrastrar
        // toda la conversación ni gastar contexto.
        ...history.slice(-4).map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: question },
      ],
      true,
      { jsonSchema: filtersJsonSchema() },
    );
  } catch {
    // Sin proveedor o respuesta rota: la búsqueda por texto sigue sirviendo.
    return fallbackFilters(question);
  }

  const parsed = parseFilters(raw);
  return parsed ? applyQuestionHints(parsed, question) : fallbackFilters(question);
}

/** Traduce los filtros del chat al contrato del motor de estadísticas. */
function toStatsFilter(
  filters: AiAskFilters,
  templateRows: { id: string; name: string }[],
): StatsDocumentFilter {
  return {
    scope: filters.scope,
    docTypes: filters.docTypes,
    statuses: filters.statuses,
    templateIds: filters.templateName
      ? templateMatches(templateRows, filters.templateName)
      : [],
    text: filters.text,
    recipient: filters.recipient,
    approvedByMe: filters.approvedByMe,
    from: filters.from,
    to: filters.to,
    dateField: filters.dateField,
  };
}

interface Executed {
  total: number;
  groups: AiAskGroup[];
  results: AiAskRow[];
  filters: string;
}

/** Ejecuta la consulta con los filtros ya validados. */
async function execute(
  filters: AiAskFilters,
  ctx: AskContext,
  templateRows: { id: string; name: string; schema: unknown }[],
): Promise<Executed> {
  const where = await documentWhere(ctx.userId, toStatsFilter(filters, templateRows));

  const [countRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(documents)
    .where(where);
  const total = countRow?.value ?? 0;

  const groups: AiAskGroup[] = [];
  if (filters.groupBy !== 'none' && total > 0) {
    if (filters.groupBy === 'docType') {
      const rows = await db
        .select({ key: documents.docType, value: sql<number>`count(*)::int` })
        .from(documents)
        .where(where)
        .groupBy(documents.docType)
        .orderBy(sql`count(*) desc`);
      for (const row of rows) {
        groups.push({
          key: row.key,
          label: DOC_TYPE_LABELS[row.key as DocType] ?? row.key,
          count: row.value,
        });
      }
    } else {
      const rows = await db
        .select({ key: documents.status, value: sql<number>`count(*)::int` })
        .from(documents)
        .where(where)
        .groupBy(documents.status)
        .orderBy(sql`count(*) desc`);
      for (const row of rows) {
        groups.push({
          key: row.key,
          label: STATUS_LABELS[row.key] ?? row.key,
          count: row.value,
        });
      }
    }
  }

  const results: AiAskRow[] = [];
  if (filters.intent !== 'count' && total > 0) {
    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        docType: documents.docType,
        status: documents.status,
        docNumber: documents.docNumber,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(where)
      .orderBy(desc(documents.updatedAt))
      .limit(filters.limit);

    for (const row of rows) {
      results.push({
        id: row.id,
        title: row.title,
        docType: row.docType,
        status: row.status,
        docNumber: row.docNumber,
        updatedAt: row.updatedAt.toISOString(),
      });
    }
  }

  return { total, groups, results, filters: describeFilters(filters) };
}

/** Texto legible con los filtros aplicados (para que el usuario los vea). */
function describeFilters(filters: AiAskFilters): string {
  const parts: string[] = [];

  if (filters.docTypes.length > 0) {
    parts.push(filters.docTypes.map((type) => DOC_TYPE_LABELS[type]).join(' / '));
  }
  if (filters.statuses.length > 0) {
    parts.push(filters.statuses.map((status) => STATUS_LABELS[status]).join(' / '));
  }
  if (filters.templateName) parts.push(`plantilla «${filters.templateName}»`);
  if (filters.recipient) parts.push(`dirigidos a ${filters.recipient}`);
  if (filters.text) parts.push(`texto «${filters.text}»`);
  if (filters.from || filters.to) {
    const from = filters.from || 'el inicio';
    const to = filters.to || 'hoy';
    parts.push(`del ${from} al ${to}`);
  }
  if (filters.approvedByMe) parts.push('aprobados por ti');
  parts.push(filters.scope === 'mine' ? 'solo míos' : 'míos y compartidos');

  return parts.join(' · ');
}

/** Respuesta en español a partir del resultado real. */
function buildAnswer(filters: AiAskFilters, executed: Executed): string {
  const { total, groups, results, filters: description } = executed;

  if (total === 0) {
    return `No encontré documentos con esos criterios (${description}). Prueba a quitar algún filtro o a cambiar el texto.`;
  }

  const noun = total === 1 ? 'documento' : 'documentos';
  const verb = total === 1 ? 'coincide' : 'coinciden';

  if (filters.intent === 'count') {
    if (groups.length > 0) {
      const list = groups.map((group) => `${group.count} de ${group.label}`).join(', ');
      return `Hay ${total} ${noun} (${description}). Por ${filters.groupBy === 'docType' ? 'tipo' : 'estado'}: ${list}.`;
    }
    return `Hay ${total} ${noun} que ${verb} (${description}).`;
  }

  if (results.length < total) {
    return `Encontré ${total} ${noun} (${description}). Te muestro los ${results.length} más recientes.`;
  }
  return `Encontré ${total} ${noun} (${description}).`;
}

/** Chips para continuar la conversación, siempre en lenguaje natural. */
function buildSuggestions(filters: AiAskFilters, view: 'list' | 'dashboard', total: number): string[] {
  if (total === 0) {
    return ['Quitar los filtros', '¿Cuáles son mis últimos documentos?'];
  }

  const suggestions: string[] = [];
  if (view === 'dashboard') suggestions.push('¿Cuáles son mis últimos documentos?');
  else suggestions.push('¿Cuántos son por tipo?');
  if (filters.scope === 'all') suggestions.push('Solo los míos');
  if (!filters.from && !filters.to) suggestions.push('Este mes');
  if (filters.groupBy === 'none') suggestions.push('Agrupar por estado');

  return suggestions.slice(0, 4);
}

/** Opciones del modo consulta: filtros ya resueltos e historial. */
export interface AskOptions {
  /** Camino determinista: se ejecuta sin llamar al modelo. */
  filters?: AiAskFilters;
  history?: AiAskHistoryMessage[];
}

/**
 * Responde una pregunta sobre los documentos del usuario.
 *
 * Solo se consultan documentos que el usuario ya puede ver: propios o
 * compartidos con él.
 */
export async function askDocuments(
  config: AiConfig,
  question: string,
  ctx: AskContext,
  options: AskOptions = {},
): Promise<AiAskResult> {
  // Aplicar filtros ya resueltos no necesita proveedor: el cliente los envía
  // al pulsar una barra o un chip y el servidor solo consulta la base.
  if (!options.filters && (config.provider === 'none' || (config.provider !== 'ollama' && !config.apiKey))) {
    throw new AppError(
      400,
      'AI_NOT_CONFIGURED',
      'No hay proveedor de IA configurado. Elige uno en Ajustes para usar el modo consulta.',
    );
  }

  const templateRows = await db
    .select({ id: templates.id, name: templates.name, schema: templates.schema })
    .from(templates)
    .where(
      and(
        isNull(templates.deletedAt),
        eq(templates.isActive, true),
        or(eq(templates.ownerId, ctx.userId), eq(templates.isShared, true)),
      ),
    );

  const filters =
    options.filters ??
    (await interpret(
      config,
      question,
      templateRows.map((row) => `«${row.name}»`),
      options.history ?? [],
    ));

  const executed = await execute(filters, ctx, templateRows);
  const view: 'list' | 'dashboard' = filters.intent === 'count' ? 'dashboard' : 'list';

  // El panel de cifras sale del mismo motor que la vista de Estadísticas.
  const dashboard =
    view === 'dashboard' || filters.groupBy !== 'none'
      ? await statsFor(ctx.userId, toStatsFilter(filters, templateRows))
      : null;

  return {
    answer: buildAnswer(filters, executed),
    filters: executed.filters,
    applied: filters,
    view,
    total: executed.total,
    groups: executed.groups,
    results: executed.results,
    dashboard,
    suggestions: buildSuggestions(filters, view, executed.total),
  };
}
