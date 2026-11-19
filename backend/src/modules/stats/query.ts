/**
 * Motor de estadísticas sobre documentos.
 *
 * Lo comparten el panel de Estadísticas y el modo consulta de la IA: el mismo
 * predicado de visibilidad, los mismos filtros y los mismos números. Si los
 * dos caminos construyeran sus consultas por separado, el chat y el módulo
 * podrían mostrar cifras distintas para la misma pregunta.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import {
  DOC_TYPE_LABELS,
  type DocType,
  type DocumentStatus,
  type StatsBreakdownItem,
  type StatsDetailItem,
  type StatsDetailPage,
  type StatsDocumentFilter,
  type StatsMonthPoint,
  type StatsPanel,
  type StatsTemplateUsage,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { documentMessages, documentShares, documents, templates, users } from '../../db/schema.js';
import { accentless, normalizeText, stripAccents } from '../../lib/text-search.js';

const DAY_MS = 86_400_000;
/** Un borrador pasa a «viejo» cuando nadie lo toca durante este plazo. */
export const STALE_DRAFT_DAYS = 30;
/** Meses máximos del gráfico de actividad, para que siga siendo legible. */
const MAX_MONTHS = 24;

/** Etiquetas de estado para respuestas y desgloses. */
export const STATUS_LABELS: Record<DocumentStatus, string> = {
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

/** Propios o compartidos, nunca en papelera. */
export function visibleDocuments(userId: string, scope: 'mine' | 'all' = 'all'): SQL {
  const owner = eq(documents.ownerId, userId);
  const visible =
    scope === 'mine'
      ? owner
      : (or(
          owner,
          sql`exists (select 1 from ${documentShares} where ${documentShares.documentId} = ${documents.id} and ${documentShares.userId} = ${userId})`,
        ) as SQL);

  return and(isNull(documents.deletedAt), visible) as SQL;
}

/** Clave `YYYY-MM` de una fecha. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Meses que dibuja el gráfico de actividad.
 *
 * Sin filtro son los últimos 12; con filtro, los que abarca el periodo. Se
 * recortan a 24 meses para que las barras no se vuelvan hilos.
 */
export function monthWindow(
  from: Date | null,
  to: Date | null,
  now: Date,
): { months: string[]; start: Date } {
  const last = to ?? now;
  const endMonth = new Date(last.getFullYear(), last.getMonth(), 1);
  const naturalStart = from
    ? new Date(from.getFullYear(), from.getMonth(), 1)
    : new Date(endMonth.getFullYear(), endMonth.getMonth() - 11, 1);

  const limitStart = new Date(endMonth.getFullYear(), endMonth.getMonth() - (MAX_MONTHS - 1), 1);
  const startMonth = naturalStart.getTime() < limitStart.getTime() ? limitStart : naturalStart;

  const months: string[] = [];
  const count =
    (endMonth.getFullYear() - startMonth.getFullYear()) * 12 +
    (endMonth.getMonth() - startMonth.getMonth()) +
    1;

  for (let index = 0; index < count; index += 1) {
    months.push(monthKey(new Date(startMonth.getFullYear(), startMonth.getMonth() + index, 1)));
  }
  return { months, start: startMonth };
}

/** Un día ISO (`AAAA-MM-DD`) cubre el día completo en hora local. */
function parseFrom(value: string | undefined): Date | null {
  if (!value) return null;
  return new Date(value.length === 10 ? `${value}T00:00:00` : value);
}

function parseTo(value: string | undefined): Date | null {
  if (!value) return null;
  return new Date(value.length === 10 ? `${value}T23:59:59.999` : value);
}

/** Fechas del periodo, ya como objetos. */
export function filterBounds(filter: StatsDocumentFilter): { from: Date | null; to: Date | null } {
  return { from: parseFrom(filter.from), to: parseTo(filter.to) };
}

/** Claves de persona que usan las plantillas visibles para el usuario. */
export async function recipientKeys(userId: string): Promise<string[]> {
  const rows = await db
    .select({ schema: templates.schema })
    .from(templates)
    .where(
      and(
        isNull(templates.deletedAt),
        eq(templates.isActive, true),
        or(eq(templates.ownerId, userId), eq(templates.isShared, true)),
      ),
    );

  const keys = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.schema)) continue;
    for (const variable of row.schema as { key?: unknown }[]) {
      if (typeof variable.key === 'string' && RECIPIENT_KEY.test(variable.key)) {
        keys.add(variable.key);
      }
    }
  }
  if (keys.size === 0) FALLBACK_RECIPIENT_KEYS.forEach((key) => keys.add(key));
  return [...keys];
}

/**
 * Condición `WHERE` de un conjunto de documentos.
 *
 * Es el único sitio donde se decide qué documentos cuentan: visibilidad,
 * borradores, papelera, tipo, estado, plantilla, texto, destinatario,
 * aprobaciones y rango de fechas.
 */
export async function documentWhere(
  userId: string,
  filter: StatsDocumentFilter = {},
): Promise<SQL | undefined> {
  const conditions: SQL[] = [];

  if (filter.trashed) {
    conditions.push(isNotNull(documents.deletedAt), eq(documents.ownerId, userId));
  } else {
    conditions.push(visibleDocuments(userId, filter.scope ?? 'all'));
  }

  if (filter.docTypes && filter.docTypes.length > 0) {
    conditions.push(inArray(documents.docType, filter.docTypes));
  }
  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(inArray(documents.status, filter.statuses));
  }

  if (filter.templateIds && filter.templateIds.length > 0) {
    conditions.push(inArray(documents.templateId, filter.templateIds));
  } else if (filter.templateId === 'none') {
    conditions.push(isNull(documents.templateId));
  } else if (filter.templateId) {
    conditions.push(eq(documents.templateId, filter.templateId));
  }

  if (filter.text) {
    const pattern = `%${stripAccents(filter.text)}%`;
    const combined = or(
      sql`${accentless(documents.title)} ilike ${pattern}`,
      sql`${accentless(documents.description)} ilike ${pattern}`,
      sql`${accentless(sql`${documents.data}::text`)} ilike ${pattern}`,
    );
    if (combined) conditions.push(combined);
  }

  if (filter.recipient) {
    const keys = await recipientKeys(userId);
    const pattern = `%${stripAccents(filter.recipient)}%`;
    const matches = keys.map(
      (key) => sql`${accentless(sql`${documents.data}->>${key}`)} ilike ${pattern}`,
    );
    const combined = or(...matches);
    if (combined) conditions.push(combined);
  }

  if (filter.approvedByMe) {
    conditions.push(
      sql`exists (select 1 from ${documentMessages} where ${documentMessages.documentId} = ${documents.id} and ${documentMessages.approvedById} = ${userId})`,
    );
  }

  if (filter.stale) {
    conditions.push(
      eq(documents.status, 'draft'),
      lt(documents.updatedAt, new Date(Date.now() - STALE_DRAFT_DAYS * DAY_MS)),
    );
  }

  const dateColumn = filter.dateField === 'updated' ? documents.updatedAt : documents.createdAt;
  const { from, to } = filterBounds(filter);
  if (from) conditions.push(gte(dateColumn, from));
  if (to) conditions.push(lte(dateColumn, to));

  return and(...conditions);
}

/** Desglose por tipo o por estado, ordenado de mayor a menor. */
async function breakdown(
  where: SQL | undefined,
  column: typeof documents.docType | typeof documents.status,
  labels: Record<string, string>,
): Promise<StatsBreakdownItem[]> {
  const rows = await db
    .select({ key: column, count: sql<number>`count(*)::int` })
    .from(documents)
    .where(where)
    .groupBy(column)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({
    key: row.key,
    label: labels[row.key] ?? row.key,
    count: Number(row.count),
  }));
}

/**
 * Panel estadístico del conjunto filtrado.
 *
 * `total` y los desgloses salen de la misma condición: si el panel dice 12,
 * la lista de detrás tendrá exactamente 12 filas.
 */
export async function statsFor(
  userId: string,
  filter: StatsDocumentFilter = {},
  now: Date = new Date(),
): Promise<StatsPanel> {
  const where = await documentWhere(userId, filter);

  const [totalsRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
      drafts: sql<number>`(count(*) filter (where ${documents.status} = 'draft'))::int`,
      official: sql<number>`(count(*) filter (where ${documents.status} in ('sent', 'approved', 'final', 'archived')))::int`,
    })
    .from(documents)
    .where(where);

  const total = Number(totalsRow?.count ?? 0);
  const drafts = Number(totalsRow?.drafts ?? 0);
  const official = Number(totalsRow?.official ?? 0);

  const byType = await breakdown(
    where,
    documents.docType,
    DOC_TYPE_LABELS as Record<string, string>,
  );
  const byStatus = await breakdown(where, documents.status, STATUS_LABELS);

  const templateRows = await db
    .select({
      id: documents.templateId,
      name: templates.name,
      isShared: templates.isShared,
      count: sql<number>`count(*)::int`,
    })
    .from(documents)
    .leftJoin(templates, eq(templates.id, documents.templateId))
    .where(where)
    .groupBy(documents.templateId, templates.name, templates.isShared)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  const topTemplates: StatsTemplateUsage[] = templateRows.map((row) => ({
    id: row.id,
    name: row.name ?? 'Sin plantilla',
    count: Number(row.count),
    isShared: Boolean(row.isShared),
  }));

  /* ── Tendencia del periodo ─────────────────────────────────────── */

  const { from, to } = filterBounds(filter);
  const { months, start } = monthWindow(from, to, now);
  const dateColumn = filter.dateField === 'updated' ? documents.updatedAt : documents.createdAt;

  const createdRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${dateColumn}), 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    })
    .from(documents)
    .where(and(where, gte(dateColumn, start)))
    .groupBy(sql`date_trunc('month', ${dateColumn})`);

  const approvedRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${documentMessages.approvedAt}), 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .where(
      and(
        where,
        eq(documentMessages.status, 'sent'),
        isNotNull(documentMessages.approvedAt),
        gte(documentMessages.approvedAt, start),
        to ? lte(documentMessages.approvedAt, to) : undefined,
      ),
    )
    .groupBy(sql`date_trunc('month', ${documentMessages.approvedAt})`);

  const createdByMonth = new Map(createdRows.map((row) => [row.month, Number(row.count)]));
  const approvedByMonth = new Map(approvedRows.map((row) => [row.month, Number(row.count)]));

  const monthly: StatsMonthPoint[] = months.map((month) => ({
    month,
    created: createdByMonth.get(month) ?? 0,
    approved: approvedByMonth.get(month) ?? 0,
  }));

  return {
    generatedAt: now.toISOString(),
    totals: { documents: total, drafts, official },
    byType,
    byStatus,
    monthly,
    topTemplates,
  };
}

/**
 * Documentos reales detrás de una cifra, paginados.
 *
 * Devuelve la misma forma que las listas de detalle de la bandeja para que la
 * interfaz use una sola tabla.
 */
export async function listDocuments(
  userId: string,
  filter: StatsDocumentFilter,
  paging: { page: number; pageSize: number },
): Promise<StatsDetailPage> {
  const where = await documentWhere(userId, filter);
  const dateColumn = filter.dateField === 'updated' ? documents.updatedAt : documents.createdAt;

  const rows = await db
    .select({
      documentId: documents.id,
      title: documents.title,
      docNumber: documents.docNumber,
      docType: documents.docType,
      status: documents.status,
      ownerName: users.name,
      templateName: templates.name,
      date: dateColumn,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .leftJoin(templates, eq(templates.id, documents.templateId))
    .where(where)
    .orderBy(desc(dateColumn))
    .limit(paging.pageSize)
    .offset((paging.page - 1) * paging.pageSize);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(where);

  const items: StatsDetailItem[] = rows.map((row) => ({
    documentId: row.documentId,
    messageId: null,
    title: row.title,
    docNumber: row.docNumber,
    docType: row.docType,
    status: row.status,
    ownerName: row.ownerName,
    templateName: row.templateName ?? null,
    date: row.date.toISOString(),
    subject: null,
    resolvedByName: null,
  }));

  return {
    items,
    total: Number(countRow?.count ?? 0),
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

/** Normaliza un nombre para comparar plantillas sin tildes ni mayúsculas. */
export function templateMatches(
  rows: { id: string; name: string }[],
  wanted: string,
): string[] {
  const target = normalizeText(wanted);
  return rows
    .filter((row) => {
      const name = normalizeText(row.name);
      return name === target || name.includes(target) || target.includes(name);
    })
    .map((row) => row.id);
}
