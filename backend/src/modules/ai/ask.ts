/**
 * Modo consulta: preguntas en lenguaje natural sobre los documentos.
 *
 * El modelo **no escribe SQL ni ve la base**. Solo traduce la pregunta a un
 * objeto de filtros; el servidor valida esos filtros, ejecuta la consulta con
 * las mismas reglas de visibilidad que el listado y construye la respuesta a
 * partir del resultado real. Por eso las cifras no pueden inventarse.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';

import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DOCUMENT_STATUSES,
  type AiAskFilters,
  type AiAskGroup,
  type AiAskResult,
  type AiAskRow,
  type DocType,
  type DocumentStatus,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import {
  documentMessages,
  documentShares,
  documents,
  templates,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { chat, type AiConfig } from './providers.js';
import { extractJsonObject } from './values.js';

/** Etiquetas de estado para la respuesta y para el prompt. */
const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'borrador',
  in_review: 'en revisión',
  final: 'final',
  archived: 'archivado',
  sent: 'enviado',
  approved: 'aprobado',
  rejected: 'rechazado',
  cancelled: 'cancelado',
};

/**
 * Claves del esquema que identifican a la persona a la que va el documento.
 *
 * Cada plantilla la llama distinto (`destinatario`, `receptor`, `nombre`…),
 * así que «dirigidos a X» busca en todas las que aparecen en las plantillas
 * del usuario.
 */
const RECIPIENT_KEY = /^(receptor|destinatario|recibe|nombre|contacto)$/i;

const FALLBACK_RECIPIENT_KEYS = ['receptor', 'destinatario', 'nombre'];

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

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Minúsculas y sin tildes, para comparar «Jesús» con «Jesus». */
function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Expresión SQL comparable sin tildes.
 *
 * Postgres distingue «Jesús» de «Jesus» (ILIKE solo ignora mayúsculas), así
 * que las dos partes de la comparación se normalizan con `translate`.
 */
function accentless(expression: SQLWrapper): ReturnType<typeof sql> {
  return sql`translate(${expression}, ${'áéíóúüñÁÉÍÓÚÜÑ'}, ${'aeiouunAEIOUUN'})`;
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
    '- «dirigidos a», «para», «a nombre de» → recipient.',
    '- Nombre de una persona o un asunto → text si no es un destinatario claro.',
    '- «míos», «mis documentos» → scope = "mine". Por defecto "all" (míos y compartidos).',
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

/** Pide al modelo la interpretación y la valida; si falla, busca por texto. */
async function interpret(
  config: AiConfig,
  question: string,
  templateNames: string[],
): Promise<AiAskFilters> {
  let raw: string;
  try {
    raw = await chat(
      { ...config, temperature: 0.1, maxTokens: 600 },
      [
        { role: 'system', content: buildPrompt(question, templateNames) },
        { role: 'user', content: question },
      ],
      true,
      { jsonSchema: filtersJsonSchema() },
    );
  } catch {
    // Sin proveedor o respuesta rota: la búsqueda por texto sigue sirviendo.
    return fallbackFilters(question);
  }

  return parseFilters(raw) ?? fallbackFilters(question);
}

/** Condición de visibilidad: propias o compartidas con el usuario. */
function visibility(userId: string, scope: 'mine' | 'all') {
  if (scope === 'mine') return eq(documents.ownerId, userId);

  return or(
    eq(documents.ownerId, userId),
    sql`exists (select 1 from ${documentShares} where ${documentShares.documentId} = ${documents.id} and ${documentShares.userId} = ${userId})`,
  );
}

/** Personas posibles en los esquemas de las plantillas del usuario. */
function recipientKeys(schemas: { key: string }[][]): string[] {
  const keys = new Set<string>();
  for (const schema of schemas) {
    for (const variable of schema) {
      if (RECIPIENT_KEY.test(variable.key)) keys.add(variable.key);
    }
  }
  if (keys.size === 0) FALLBACK_RECIPIENT_KEYS.forEach((key) => keys.add(key));
  return [...keys];
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
  const conditions = [isNull(documents.deletedAt), visibility(ctx.userId, filters.scope)];

  if (filters.docTypes.length > 0) conditions.push(inArray(documents.docType, filters.docTypes));
  if (filters.statuses.length > 0) conditions.push(inArray(documents.status, filters.statuses));

  if (filters.templateName) {
    const wanted = normalize(filters.templateName);
    const matches = templateRows.filter((row) => {
      const name = normalize(row.name);
      return name === wanted || name.includes(wanted) || wanted.includes(name);
    });
    if (matches.length > 0) {
      conditions.push(inArray(documents.templateId, matches.map((row) => row.id)));
    }
  }

  if (filters.recipient) {
    const keys = recipientKeys(
      templateRows.map((row) => (Array.isArray(row.schema) ? (row.schema as { key: string }[]) : [])),
    );
    const pattern = `%${stripAccents(filters.recipient)}%`;
    const matches = keys.map(
      (key) => sql`${accentless(sql`${documents.data}->>${key}`)} ilike ${pattern}`,
    );
    const combined = or(...matches);
    if (combined) conditions.push(combined);
  }

  if (filters.text) {
    const pattern = `%${stripAccents(filters.text)}%`;
    const combined = or(
      sql`${accentless(documents.title)} ilike ${pattern}`,
      sql`${accentless(documents.description)} ilike ${pattern}`,
      sql`${accentless(sql`${documents.data}::text`)} ilike ${pattern}`,
    );
    if (combined) conditions.push(combined);
  }

  if (filters.from && isIsoDate(filters.from)) {
    conditions.push(gte(documents.updatedAt, new Date(`${filters.from}T00:00:00`)));
  }
  if (filters.to && isIsoDate(filters.to)) {
    conditions.push(lte(documents.updatedAt, new Date(`${filters.to}T23:59:59.999`)));
  }

  if (filters.approvedByMe) {
    conditions.push(
      sql`exists (select 1 from ${documentMessages} where ${documentMessages.documentId} = ${documents.id} and ${documentMessages.approvedById} = ${ctx.userId})`,
    );
  }

  const where = and(...conditions);

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
): Promise<AiAskResult> {
  if (config.provider === 'none' || (config.provider !== 'ollama' && !config.apiKey)) {
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

  const filters = await interpret(
    config,
    question,
    templateRows.map((row) => `«${row.name}»`),
  );

  const executed = await execute(filters, ctx, templateRows);

  return {
    answer: buildAnswer(filters, executed),
    filters: executed.filters,
    total: executed.total,
    groups: executed.groups,
    results: executed.results,
  };
}
