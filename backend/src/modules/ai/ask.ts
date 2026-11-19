/**
 * Modo consulta: preguntas en lenguaje natural sobre los documentos.
 *
 * El modelo **no escribe SQL ni ve la base**. Devuelve un *plan* validado
 * (qué medir, cómo agrupar y qué gráfico); el servidor construye la consulta
 * con Drizzle, aplica la visibilidad del usuario y rellena frase, gráfico e
 * insights. Por eso las cifras no pueden inventarse.
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  AI_ASK_DIMENSIONS,
  AI_ASK_METRICS,
  AI_ASK_MODES,
  AI_CHART_KINDS,
  AI_COMPARE_PRESETS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DOCUMENT_STATUSES,
  type AiAskDimension,
  type AiAskFilters,
  type AiAskGroup,
  type AiAskHistoryMessage,
  type AiAskMetric,
  type AiAskPlan,
  type AiAskResult,
  type AiAskRow,
  type DocType,
  type DocumentStatus,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { documents, templates } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { normalizeText } from '../../lib/text-search.js';
import { runAnalytics } from './analytics.js';
import { chat, type AiConfig } from './providers.js';
import { extractJsonObject } from './values.js';
import {
  documentWhere,
  statsFilterFromAsk,
  statsFor,
  STATUS_LABELS,
} from '../stats/query.js';

/** Filtros ya validados, con tolerancia a los errores de los modelos pequeños. */
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

/** Plan tolerante: cada campo inválido cae a un valor razonable. */
const planSchema = filtersSchema.extend({
  mode: z.enum(AI_ASK_MODES).catch('list'),
  metrics: z
    .array(z.string())
    .catch([])
    .transform((list) =>
      list.filter((item): item is AiAskMetric =>
        (AI_ASK_METRICS as readonly string[]).includes(item),
      ),
    ),
  dimensions: z
    .array(z.string())
    .catch([])
    .transform((list) =>
      list.filter((item): item is AiAskDimension =>
        (AI_ASK_DIMENSIONS as readonly string[]).includes(item),
      ),
    ),
  bucket: z.enum(['day', 'week', 'month']).nullable().catch(null),
  compare: z.enum(AI_COMPARE_PRESETS).nullable().catch(null),
  chart: z.enum(AI_CHART_KINDS).catch('bar'),
  sortBy: z.enum(['value', 'label']).catch('value'),
  sortDir: z.enum(['asc', 'desc']).catch('desc'),
  clarificationQuestion: text,
  clarificationOptions: z.array(z.string()).catch([]),
});

/** Plan tal como viaja entre el servidor y el cliente (nested, estricto). */
const askFiltersSchema = z.object({
  intent: z.enum(['count', 'list', 'find']),
  groupBy: z.enum(['none', 'docType', 'status']),
  scope: z.enum(['mine', 'all']),
  docTypes: z.array(z.enum(DOC_TYPES)),
  statuses: z.array(z.enum(DOCUMENT_STATUSES)),
  templateName: z.string().max(200),
  recipient: z.string().max(200),
  text: z.string().max(500),
  from: z.string().max(32),
  to: z.string().max(32),
  dateField: z.enum(['created', 'updated']),
  approvedByMe: z.boolean(),
  limit: z.number().int().min(1).max(20),
});

export const askPlanSchema = z.object({
  mode: z.enum(AI_ASK_MODES),
  filters: askFiltersSchema,
  metrics: z.array(z.enum(AI_ASK_METRICS)).min(1).max(1),
  dimensions: z.array(z.enum(AI_ASK_DIMENSIONS)).max(1),
  bucket: z.enum(['day', 'week', 'month']).nullable(),
  compare: z.enum(AI_COMPARE_PRESETS).nullable(),
  chart: z.enum(AI_CHART_KINDS),
  sort: z.object({
    by: z.enum(['value', 'label']),
    dir: z.enum(['asc', 'desc']),
  }),
  limit: z.number().int().min(1).max(20),
  clarification: z
    .object({ question: z.string().trim().min(3).max(300), options: z.array(z.string()).max(4) })
    .nullable(),
});

const questionSchema = z.object({ question: z.string().trim().min(3).max(500) });

export { questionSchema };

/**
 * Petición del modo consulta.
 *
 * `plan` y `filters` son el camino determinista: la interfaz reenvía lo ya
 * aplicado (chips, barras, gráficos guardados) y el servidor ejecuta sin
 * llamar al modelo. `history` permite seguimientos.
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
  plan: askPlanSchema.optional(),
  conversationId: z.uuid().optional(),
});

export type AskContext = { userId: string };
export type TemplateRow = { id: string; name: string };

function todayIso(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Esquema JSON del plan: ata al modelo a campos y valores cerrados. */
function planJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: [...AI_ASK_MODES],
        description:
          'count = cuántos; list = listar; search = buscar; aggregate = agrupar; compare = comparar periodos; clarify = falta información',
      },
      metrics: {
        type: 'array',
        items: { type: 'string', enum: [...AI_ASK_METRICS] },
        description: 'count = documentos; approval_hours = tiempo medio; approval_rate = tasa',
      },
      dimensions: {
        type: 'array',
        items: { type: 'string', enum: [...AI_ASK_DIMENSIONS] },
        description: 'Cómo agrupar; como máximo una dimensión',
      },
      bucket: { type: ['string', 'null'], enum: ['day', 'week', 'month', null] },
      compare: { type: ['string', 'null'], enum: [...AI_COMPARE_PRESETS, null] },
      chart: {
        type: 'string',
        enum: [...AI_CHART_KINDS],
        description: 'kpi, bar, line, donut, comparison o table',
      },
      sortBy: { type: 'string', enum: ['value', 'label'] },
      sortDir: { type: 'string', enum: ['asc', 'desc'] },
      limit: { type: 'integer', description: 'Máximo de categorías o filas (1-20)' },
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
      clarificationQuestion: { type: 'string' },
      clarificationOptions: { type: 'array', items: { type: 'string' } },
    },
    required: ['mode'],
  };
}

function buildPrompt(question: string, templateNames: string[]): string {
  const types = DOC_TYPES.map((type) => `${type} (${DOC_TYPE_LABELS[type]})`).join(', ');
  const statuses = DOCUMENT_STATUSES.map(
    (status) => `${status} (${STATUS_LABELS[status]})`,
  ).join(', ');

  return [
    'Eres un planificador de consultas sobre documentos. No respondas la pregunta: devuelve SOLO el JSON del plan.',
    'Si falta un dato imprescindible, usa mode="clarify" con una pregunta corta y 2-3 opciones. No inventes fechas ni cifras.',
    '',
    `Fecha de hoy: ${todayIso()}`,
    `Tipos: ${types}`,
    `Estados: ${statuses}`,
    `Plantillas: ${templateNames.length > 0 ? templateNames.join(', ') : '(ninguna)'}`,
    '',
    'Reglas:',
    '- «cuántos» sin agrupar → mode="count", chart="kpi".',
    '- «por tipo / por estado / por plantilla / por destinatario» → mode="aggregate", dimensions=[...], chart="bar".',
    '- «por mes / evolución mensual / tendencia» → mode="aggregate", dimensions=["month"], bucket="month", chart="line".',
    '- «por semana» → dimensions=["week"], bucket="week", chart="line".',
    '- «compara con el mes pasado / frente al anterior» → mode="compare", compare="previous_month", chart="comparison".',
    '- «tiempo medio de aprobación» → metrics=["approval_hours"].',
    '- «tasa de aprobación» → metrics=["approval_rate"].',
    '- «los últimos N», «búscame» → mode="list" o "search", chart="table".',
    '- «hice», «creé», «mis» → scope="mine" y dateField="created".',
    '- «toqué», «modifiqué» → dateField="updated".',
    '- «este mes», «el mes pasado», «este año», «esta semana» → rellena from y to.',
    '- Una sola dimensión por plan.',
    '- Si piden «gráfico de líneas», usa chart="line"; «de barras», "bar"; «dona/pastel», "donut"; «tabla», "table".',
    '',
    'Ejemplos:',
    'P: ¿cuántos documentos por tipo hice este mes?',
    'R: {"mode":"aggregate","metrics":["count"],"dimensions":["docType"],"chart":"bar","scope":"mine","from":"2026-11-01","to":"2026-11-30"}',
    'P: evolución mensual de certificados',
    'R: {"mode":"aggregate","metrics":["count"],"dimensions":["month"],"bucket":"month","chart":"line","docTypes":["certificate"]}',
    'P: top 5 destinatarios',
    'R: {"mode":"aggregate","metrics":["count"],"dimensions":["recipient"],"chart":"bar","limit":5}',
    'P: tiempo medio de aprobación por plantilla',
    'R: {"mode":"aggregate","metrics":["approval_hours"],"dimensions":["template"],"chart":"bar"}',
    'P: ¿cuántos certificados este mes comparado con el anterior?',
    'R: {"mode":"compare","metrics":["count"],"compare":"previous_month","chart":"comparison","docTypes":["certificate"]}',
    'P: mis últimos 5 documentos',
    'R: {"mode":"list","metrics":["count"],"chart":"table","scope":"mine","limit":5}',
    'P: búscame la nota de Samuel',
    'R: {"mode":"search","metrics":["count"],"chart":"table","text":"Samuel"}',
    'P: ¿cuántos documentos tengo?',
    'R: {"mode":"count","metrics":["count"],"chart":"kpi"}',
    'P: ¿cuántos están pendientes?',
    'R: {"mode":"count","metrics":["count"],"chart":"kpi","statuses":["in_review"]}',
    'P: tasa de aprobación por mes',
    'R: {"mode":"aggregate","metrics":["approval_rate"],"dimensions":["month"],"bucket":"month","chart":"line"}',
    '',
    `P: ${question}`,
  ].join('\n');
}

/** Plan de reserva: busca la pregunta como texto. */
export function fallbackPlan(question: string): AiAskPlan {
  return {
    mode: 'search',
    filters: fallbackFilters(question),
    metrics: ['count'],
    dimensions: [],
    bucket: null,
    compare: null,
    chart: 'table',
    sort: { by: 'value', dir: 'desc' },
    limit: 8,
    clarification: null,
  };
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

/** Palabras que, aunque el modelo dude, significan «solo lo mío». */
const POSSESSIVE = /\b(mis|mios|mias|mi|hice|hize|elabore|redacte|cree|subi)\b/;

/** ¿La pregunta pide una comparación explícita? */
const COMPARE_HINT = /\b(comparad[oa]|comparar|frente a|vs\.?|respecto al?|que el (mes|ano) (pasado|anterior))\b/;

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
 * Corrige con hechos de la pregunta los filtros que el modelo deja mal.
 *
 * Los modelos pequeños confunden «este mes» con el mes anterior y olvidan el
 * alcance con «mis últimos 5». Las expresiones de calendario y los posesivos
 * son señales fiables: se aplican sin depender de la interpretación.
 */
export function applyQuestionHints(
  filters: AiAskFilters,
  question: string,
  now: Date = new Date(),
): AiAskFilters {
  const value = normalizeText(question);

  if (POSSESSIVE.test(value) && filters.scope === 'all') filters.scope = 'mine';

  if (/\beste mes\b|\bmes actual\b|\bmes en curso\b/.test(value)) {
    const range = monthRange(now.getFullYear(), now.getMonth());
    filters.from = range.from;
    filters.to = range.to;
  } else if (/\bmes pasado\b|\bmes anterior\b|\bultimo mes\b/.test(value)) {
    const range = monthRange(now.getFullYear(), now.getMonth() - 1);
    filters.from = range.from;
    filters.to = range.to;
  } else if (/\beste ano\b|\bano actual\b/.test(value)) {
    filters.from = isoDay(new Date(now.getFullYear(), 0, 1));
    filters.to = isoDay(now);
  } else if (/\bano pasado\b|\bultimo ano\b/.test(value)) {
    filters.from = isoDay(new Date(now.getFullYear() - 1, 0, 1));
    filters.to = isoDay(new Date(now.getFullYear() - 1, 11, 31));
  } else if (/\besta semana\b|\bsemana actual\b/.test(value)) {
    const day = (now.getDay() + 6) % 7;
    filters.from = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - day));
    filters.to = isoDay(now);
  } else if (/\bsemana pasada\b|\bultima semana\b/.test(value)) {
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - 7);
    filters.from = isoDay(monday);
    filters.to = isoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
  } else if (/\bhoy\b/.test(value)) {
    filters.from = isoDay(now);
    filters.to = isoDay(now);
  } else if (/\bayer\b/.test(value)) {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    filters.from = isoDay(yesterday);
    filters.to = isoDay(yesterday);
  }

  return filters;
}

/** Aplica las correcciones de la pregunta al plan completo. */
export function applyPlanHints(
  plan: AiAskPlan,
  question: string,
  now: Date = new Date(),
): AiAskPlan {
  const value = normalizeText(question);
  applyQuestionHints(plan.filters, question, now);

  // Dimensiones que el modelo suele olvidar.
  if (plan.dimensions.length === 0) {
    if (/\bpor tipo\b|\bde cada tipo\b|\bpor tipo de documento\b/.test(value)) {
      plan.dimensions = ['docType'];
    } else if (/\bpor estado\b/.test(value)) {
      plan.dimensions = ['status'];
    } else if (/\bpor plantilla\b/.test(value)) {
      plan.dimensions = ['template'];
    } else if (/\bpor mes\b|\bmensual\b|\bevolucion\b|\btendencia\b/.test(value)) {
      plan.dimensions = ['month'];
      plan.bucket = 'month';
    } else if (/\bpor semana\b|\bsemanal\b/.test(value)) {
      plan.dimensions = ['week'];
      plan.bucket = 'week';
    }
  }

  if (plan.dimensions.length > 0 && plan.mode === 'count') plan.mode = 'aggregate';
  if (plan.dimensions.length > 0 && plan.chart === 'kpi') plan.chart = 'bar';
  if (plan.dimensions[0] === 'month' || plan.dimensions[0] === 'week') {
    plan.chart = plan.chart === 'bar' ? 'bar' : 'line';
    plan.bucket ??= plan.dimensions[0];
  }

  if (COMPARE_HINT.test(value)) {
    // «Comparado con el mes pasado» sin decir «este mes»: el periodo actual
    // es el mes en curso, no el pasado.
    if (/mes pasado|mes anterior/.test(value) && !/este mes/.test(value)) {
      const range = monthRange(now.getFullYear(), now.getMonth());
      plan.filters.from = range.from;
      plan.filters.to = range.to;
    } else if (/ano pasado/.test(value) && !/este ano/.test(value)) {
      plan.filters.from = isoDay(new Date(now.getFullYear(), 0, 1));
      plan.filters.to = isoDay(now);
    }

    if (plan.mode === 'count') plan.mode = 'compare';
    plan.compare ??= 'previous_month';
    plan.chart = 'comparison';
  }

  // Petición explícita del tipo de gráfico.
  if (plan.mode !== 'compare') {
    if (/\bdona\b|\btarta\b|\bpastel\b|\bcircular\b/.test(value) && plan.dimensions.length > 0) {
      plan.chart = 'donut';
    } else if (/\blineas?\b|\btendencia\b/.test(value) && plan.dimensions.length > 0) {
      plan.chart = 'line';
    } else if (/\bbarras?\b/.test(value) && plan.dimensions.length > 0) {
      plan.chart = 'bar';
    } else if (/\btabla\b/.test(value)) {
      plan.chart = 'table';
    } else if (/\bkpi\b|\bnumero grande\b/.test(value) && plan.dimensions.length === 0) {
      plan.chart = 'kpi';
    }
  }

  return plan;
}

/** Convierte el JSON del modelo (ya parseado) en un plan limpio. */
export function planFromParsed(parsed: z.infer<typeof planSchema>): AiAskPlan {
  const filters: AiAskFilters = {
    intent: parsed.intent,
    groupBy: parsed.groupBy,
    scope: parsed.scope,
    docTypes: parsed.docTypes,
    statuses: parsed.statuses,
    templateName: parsed.templateName,
    recipient: parsed.recipient,
    text: parsed.text,
    from: isIsoDate(parsed.from) ? parsed.from : '',
    to: isIsoDate(parsed.to) ? parsed.to : '',
    dateField: parsed.dateField,
    approvedByMe: parsed.approvedByMe,
    limit: parsed.limit,
  };

  const mode = parsed.mode;
  const metrics: AiAskMetric[] =
    parsed.metrics.length > 0 ? parsed.metrics : ['count'];
  let dimensions = parsed.dimensions;
  if (dimensions.length === 0 && (filters.groupBy === 'docType' || filters.groupBy === 'status')) {
    dimensions = [filters.groupBy];
  }
  if (dimensions.length > 1) dimensions = dimensions.slice(0, 1);

  let chart = parsed.chart;
  if (mode === 'list' || mode === 'search') chart = 'table';
  else if (mode === 'count' && dimensions.length === 0) chart = 'kpi';
  else if (mode === 'compare') chart = 'comparison';
  else if (dimensions.length > 0 && chart === 'kpi') chart = 'bar';

  const clarification =
    mode === 'clarify' || parsed.clarificationQuestion
      ? {
          question: parsed.clarificationQuestion || '¿Puedes concretar un poco más?',
          options: parsed.clarificationOptions.slice(0, 4),
        }
      : null;

  return {
    mode,
    filters,
    metrics,
    dimensions,
    bucket: parsed.bucket,
    compare: mode === 'compare' ? (parsed.compare ?? 'previous_month') : parsed.compare,
    chart,
    sort: { by: parsed.sortBy, dir: parsed.sortDir },
    limit: parsed.limit,
    clarification,
  };
}

/**
 * Valida la interpretación del modelo.
 *
 * Devuelve `null` si no hay un objeto JSON utilizable. Cada campo inválido cae
 * a su valor por defecto: un modelo pequeño se equivoca a menudo en los bordes.
 */
export function parsePlan(raw: string): AiAskPlan | null {
  try {
    const parsed = planSchema.parse(extractJsonObject(raw, 'AI_INVALID_JSON'));
    return planFromParsed(parsed);
  } catch {
    return null;
  }
}

/** Compatibilidad: interpreta el JSON como los filtros antiguos. */
export function parseFilters(raw: string): AiAskFilters | null {
  try {
    const parsed = filtersSchema.parse(extractJsonObject(raw, 'AI_INVALID_JSON'));
    if (parsed.from && !isIsoDate(parsed.from)) parsed.from = '';
    if (parsed.to && !isIsoDate(parsed.to)) parsed.to = '';
    return parsed;
  } catch {
    return null;
  }
}

/** Plan derivado de filtros ya resueltos (chips y barras). */
export function planFromFilters(filters: AiAskFilters): AiAskPlan {
  const mode = filters.intent === 'count' ? 'count' : filters.intent === 'find' ? 'search' : 'list';
  const dimensions: AiAskDimension[] =
    filters.groupBy === 'none' ? [] : [filters.groupBy];
  return {
    mode,
    filters,
    metrics: ['count'],
    dimensions,
    bucket: null,
    compare: null,
    chart: mode === 'count' ? (dimensions.length > 0 ? 'bar' : 'kpi') : 'table',
    sort: { by: 'value', dir: 'desc' },
    limit: filters.limit,
    clarification: null,
  };
}

/** Pide al modelo el plan y lo valida; si falla, busca por texto. */
async function interpret(
  config: AiConfig,
  question: string,
  templateNames: string[],
  history: AiAskHistoryMessage[] = [],
): Promise<AiAskPlan> {
  let raw: string;
  try {
    raw = await chat(
      { ...config, temperature: 0, maxTokens: 900 },
      [
        { role: 'system', content: buildPrompt(question, templateNames) },
        ...history.slice(-4).map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: question },
      ],
      true,
      { jsonSchema: planJsonSchema() },
    );
  } catch {
    return fallbackPlan(question);
  }

  const plan = parsePlan(raw) ?? fallbackPlan(question);
  return applyPlanHints(plan, question);
}

interface Executed {
  total: number;
  results: AiAskRow[];
  filters: string;
}

async function execute(
  plan: AiAskPlan,
  ctx: AskContext,
  templateRows: TemplateRow[],
): Promise<Executed> {
  const filter = statsFilterFromAsk(plan.filters, templateRows);
  const where = await documentWhere(ctx.userId, filter);

  const [countRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(documents)
    .where(where);
  const total = Number(countRow?.value ?? 0);

  const results: AiAskRow[] = [];
  if ((plan.mode === 'list' || plan.mode === 'search') && total > 0) {
    const dateColumn =
      plan.filters.dateField === 'updated' ? documents.updatedAt : documents.createdAt;
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
      .orderBy(desc(dateColumn))
      .limit(plan.limit);

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

  return { total, results, filters: describeFilters(plan.filters) };
}

/** Texto legible con los filtros aplicados. */
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

function buildAnswer(plan: AiAskPlan, executed: Executed): string {
  const { total, results, filters: description } = executed;

  if (total === 0) {
    return `No encontré documentos con esos criterios (${description}). Prueba a quitar algún filtro o a cambiar el texto.`;
  }

  const noun = total === 1 ? 'documento' : 'documentos';
  const verb = total === 1 ? 'coincide' : 'coinciden';

  if (plan.mode === 'list' || plan.mode === 'search') {
    if (results.length < total) {
      return `Encontré ${total} ${noun} (${description}). Te muestro los ${results.length} más recientes.`;
    }
    return `Encontré ${total} ${noun} (${description}).`;
  }

  if (plan.mode === 'compare') {
    return `Comparación (${description}).`;
  }

  return `Hay ${total} ${noun} que ${verb} (${description}).`;
}

/** Chips para continuar la conversación. */
function buildSuggestions(plan: AiAskPlan, total: number): string[] {
  if (total === 0) {
    return ['Quitar los filtros', '¿Cuáles son mis últimos documentos?'];
  }

  const suggestions: string[] = [];
  if (plan.mode === 'list' || plan.mode === 'search') {
    suggestions.push('¿Cuántos son por tipo?');
  } else {
    suggestions.push('¿Cuáles son mis últimos documentos?');
    suggestions.push('Compara con el mes pasado');
  }
  if (plan.filters.scope === 'all') suggestions.push('Solo los míos');
  if (!plan.filters.from && !plan.filters.to) suggestions.push('Este mes');
  if (plan.dimensions.length === 0) suggestions.push('Agrupar por estado');

  return suggestions.slice(0, 4);
}

/** Plantillas visibles para el usuario (nombre para el prompt y el filtro). */
export async function loadAskTemplates(userId: string): Promise<TemplateRow[]> {
  return db
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(
      and(
        isNull(templates.deletedAt),
        eq(templates.isActive, true),
        or(eq(templates.ownerId, userId), eq(templates.isShared, true)),
      ),
    );
}

/**
 * Ejecuta un plan ya validado. Es el camino sin modelo que usan los chips,
 * las barras, los gráficos guardados y el historial de conversaciones.
 */
export async function runWithPlan(
  ctx: AskContext,
  plan: AiAskPlan,
  templateRows: TemplateRow[],
): Promise<AiAskResult> {
  if (plan.mode === 'clarify' && plan.clarification) {
    return {
      answer: plan.clarification.question,
      filters: describeFilters(plan.filters),
      applied: plan.filters,
      plan,
      view: 'dashboard',
      total: 0,
      groups: [],
      results: [],
      dashboard: null,
      chart: null,
      insights: [],
      clarification: plan.clarification,
      suggestions: plan.clarification.options,
    };
  }

  const executed = await execute(plan, ctx, templateRows);
  const analytics = await runAnalytics(ctx.userId, plan, templateRows);
  const filter = statsFilterFromAsk(plan.filters, templateRows);

  const dashboard =
    plan.mode === 'count' || plan.mode === 'aggregate' || plan.mode === 'compare'
      ? await statsFor(ctx.userId, filter)
      : null;

  return {
    answer: buildAnswer(plan, executed),
    filters: executed.filters,
    applied: plan.filters,
    plan,
    view: plan.mode === 'list' || plan.mode === 'search' ? 'list' : 'dashboard',
    total: executed.total,
    groups: analytics.groups,
    results: executed.results,
    dashboard,
    chart: analytics.chart,
    insights: analytics.insights,
    clarification: null,
    suggestions: buildSuggestions(plan, executed.total),
  };
}

/** Opciones del modo consulta: plan/filtros ya resueltos e historial. */
export interface AskOptions {
  /** Camino determinista: se ejecuta sin llamar al modelo. */
  plan?: AiAskPlan;
  /** Compatibilidad con la interfaz anterior (chips de filtros). */
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
  const templateRows = await loadAskTemplates(ctx.userId);

  let plan = options.plan;
  if (!plan && options.filters) plan = planFromFilters(options.filters);

  // Aplicar un plan ya resuelto no necesita proveedor.
  if (!plan && (config.provider === 'none' || (config.provider !== 'ollama' && !config.apiKey))) {
    throw new AppError(
      400,
      'AI_NOT_CONFIGURED',
      'No hay proveedor de IA configurado. Elige uno en Ajustes para usar el modo consulta.',
    );
  }

  plan ??= await interpret(
    config,
    question,
    templateRows.map((row) => `«${row.name}»`),
    options.history ?? [],
  );

  return runWithPlan(ctx, plan, templateRows);
}
