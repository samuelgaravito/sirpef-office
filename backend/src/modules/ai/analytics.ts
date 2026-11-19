/**
 * Motor analítico del modo consulta.
 *
 * El modelo elige **qué** medir y **cómo** agrupar; aquí se construye la
 * consulta con Drizzle y se rellena el gráfico. Nunca se ejecuta SQL generado
 * por el modelo: las métricas y dimensiones son una lista cerrada.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import {
  DOC_TYPE_LABELS,
  type AiAskDimension,
  type AiAskGroup,
  type AiAskMetric,
  type AiAskPlan,
  type AiChart,
  type DocumentStatus,
  type StatsDocumentFilter,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { documentMessages, documents, templates, users } from '../../db/schema.js';
import {
  documentWhere,
  filterBounds,
  monthWindow,
  recipientKeys,
  statsFilterFromAsk,
  STATUS_LABELS,
} from '../stats/query.js';

const DAY_MS = 86_400_000;

const METRIC_LABELS: Record<AiAskMetric, string> = {
  count: 'Documentos',
  approval_hours: 'Tiempo medio de aprobación (h)',
  approval_rate: 'Tasa de aprobación (%)',
};

const DIMENSION_LABELS: Record<AiAskDimension, string> = {
  docType: 'por tipo',
  status: 'por estado',
  template: 'por plantilla',
  recipient: 'por destinatario',
  month: 'por mes',
  week: 'por semana',
  owner: 'por responsable',
};

interface GroupRow {
  key: string;
  label: string;
  value: number;
}

export interface AnalyticsResult {
  chart: AiChart | null;
  insights: string[];
  groups: AiAskGroup[];
}

/** Expresión SQL de la dimensión elegida. */
async function dimensionExpression(
  dimension: AiAskDimension,
  filter: StatsDocumentFilter,
  userId: string,
): Promise<SQL> {
  const dateColumn = filter.dateField === 'updated' ? documents.updatedAt : documents.createdAt;

  switch (dimension) {
    case 'docType':
      return sql<string>`${documents.docType}`;
    case 'status':
      return sql<string>`${documents.status}`;
    case 'template':
      return sql<string>`coalesce(${templates.name}, 'Sin plantilla')`;
    case 'owner':
      return sql<string>`coalesce(${users.name}, 'Sin responsable')`;
    case 'month':
      return sql<string>`to_char(date_trunc('month', ${dateColumn}), 'YYYY-MM')`;
    case 'week':
      return sql<string>`to_char(date_trunc('week', ${dateColumn}), 'IYYY-"W"IW')`;
    case 'recipient': {
      const keys = await recipientKeys(userId);
      const parts = keys.map((key) => sql`nullif(trim(${documents.data}->>${key}), '')`);
      return sql<string>`coalesce(${sql.join(parts, sql`, `)}, 'Sin destinatario')`;
    }
  }
}

/** Etiqueta legible de un valor agrupado. */
function dimensionValueLabel(dimension: AiAskDimension, value: string): string {
  if (dimension === 'docType') return DOC_TYPE_LABELS[value as keyof typeof DOC_TYPE_LABELS] ?? value;
  if (dimension === 'status') {
    return STATUS_LABELS[value as DocumentStatus] ?? value;
  }
  return value || 'Sin datos';
}

/** Expresión de la métrica; cuenta documentos o agrega sus aprobaciones. */
function metricExpression(metric: AiAskMetric): SQL<number> {
  if (metric === 'approval_hours') {
    return sql<number>`coalesce((avg(extract(epoch from (${documentMessages.approvedAt} - ${documents.createdAt})) / 3600))::float8, 0)`;
  }
  if (metric === 'approval_rate') {
    return sql<number>`coalesce(round((100.0 * count(*) filter (where ${documentMessages.status} = 'sent')) / nullif(count(*) filter (where ${documentMessages.status} in ('sent', 'rejected')), 0), 1), 0)::float8`;
  }
  return sql<number>`count(*)::int`;
}

/** Condición de los mensajes que participan en una métrica de aprobación. */
function messageWhere(where: SQL | undefined, metric: AiAskMetric): SQL | undefined {
  const statuses = metric === 'approval_rate' ? (['sent', 'rejected'] as const) : (['sent'] as const);
  return and(
    where,
    inArray(documentMessages.status, [...statuses]),
    metric === 'approval_hours' ? isNotNull(documentMessages.approvedAt) : undefined,
  );
}

/** Agrupa documentos (o sus aprobaciones) por la dimensión elegida. */
async function groupedRows(
  userId: string,
  filter: StatsDocumentFilter,
  dimension: AiAskDimension,
  metric: AiAskMetric,
  limit: number,
): Promise<GroupRow[]> {
  const where = await documentWhere(userId, filter);
  const label = await dimensionExpression(dimension, filter, userId);
  const value = metricExpression(metric);

  const rows =
    metric === 'count'
      ? await db
          .select({ label, value })
          .from(documents)
          .leftJoin(templates, eq(templates.id, documents.templateId))
          .leftJoin(users, eq(users.id, documents.ownerId))
          .where(where)
          .groupBy(label)
          .orderBy(desc(value))
          .limit(limit)
      : await db
          .select({ label, value })
          .from(documentMessages)
          .innerJoin(documents, eq(documents.id, documentMessages.documentId))
          .leftJoin(templates, eq(templates.id, documents.templateId))
          .leftJoin(users, eq(users.id, documents.ownerId))
          .where(messageWhere(where, metric))
          .groupBy(label)
          .orderBy(desc(value))
          .limit(limit);

  return rows.map((row) => ({
    key: String(row.label),
    label: dimensionValueLabel(dimension, String(row.label)),
    value: Number(row.value),
  }));
}

/** Número de documentos del conjunto filtrado. */
async function countDocuments(userId: string, filter: StatsDocumentFilter): Promise<number> {
  const where = await documentWhere(userId, filter);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(where);
  return Number(row?.count ?? 0);
}

/** Serie temporal por mes o semana. */
async function timeSeries(
  userId: string,
  filter: StatsDocumentFilter,
  metric: AiAskMetric,
  bucket: 'month' | 'week',
): Promise<GroupRow[]> {
  const where = await documentWhere(userId, filter);
  const dateColumn = filter.dateField === 'updated' ? documents.updatedAt : documents.createdAt;
  const { from, to } = filterBounds(filter);
  const now = new Date();
  const { months, start } = monthWindow(from, to, now);
  const value = metricExpression(metric);

  const label =
    bucket === 'month'
      ? sql<string>`to_char(date_trunc('month', ${dateColumn}), 'YYYY-MM')`
      : sql<string>`to_char(date_trunc('week', ${dateColumn}), 'IYYY-"W"IW')`;

  const rows =
    metric === 'count'
      ? await db
          .select({ label, value })
          .from(documents)
          .where(and(where, bucket === 'month' ? gte(dateColumn, start) : undefined))
          .groupBy(label)
          .orderBy(asc(label))
      : await db
          .select({ label, value })
          .from(documentMessages)
          .innerJoin(documents, eq(documents.id, documentMessages.documentId))
          .where(
            and(
              messageWhere(where, metric),
              bucket === 'month' ? gte(dateColumn, start) : undefined,
            ),
          )
          .groupBy(label)
          .orderBy(asc(label));

  const found = new Map(rows.map((row) => [String(row.label), Number(row.value)]));

  if (bucket === 'month') {
    return months.map((month) => ({ key: month, label: month, value: found.get(month) ?? 0 }));
  }

  // Semanas: no se rellenan huecos; se muestran las últimas 16 con datos.
  return rows.slice(-16).map((row) => ({
    key: String(row.label),
    label: String(row.label),
    value: Number(row.value),
  }));
}

/** Tipo de gráfico final, corrigiendo combinaciones sin sentido. */
function resolveChartKind(plan: AiAskPlan, dimension: AiAskDimension | null): AiChart['kind'] {
  if (plan.mode === 'compare') return 'comparison';
  if (plan.chart === 'table') return 'table';
  if (!dimension) return 'kpi';
  if (plan.chart === 'line') return 'line';
  if (plan.chart === 'donut') return plan.metrics[0] === 'count' ? 'donut' : 'bar';
  return 'bar';
}

function unitFor(metric: AiAskMetric): AiChart['unit'] {
  if (metric === 'approval_hours') return 'hours';
  if (metric === 'approval_rate') return 'percent';
  return 'documents';
}

function chartTitle(metric: AiAskMetric, dimension: AiAskDimension | null): string {
  return dimension
    ? `${METRIC_LABELS[metric]} ${DIMENSION_LABELS[dimension]}`
    : METRIC_LABELS[metric];
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return {
    from: day(new Date(year, month, 1)),
    to: day(new Date(year, month + 1, 0)),
  };
}

/** Periodo anterior con el que se compara. */
function previousRange(
  filters: AiAskPlan['filters'],
  preset: AiAskPlan['compare'],
  now: Date,
): { from: string; to: string; label: string } {
  if (preset === 'previous_year' && filters.from && filters.to) {
    const shift = (value: string): string => {
      const [year, month, day] = value.split('-').map(Number);
      return `${(year ?? 0) - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    return { from: shift(filters.from), to: shift(filters.to), label: 'el año anterior' };
  }

  if (preset === 'previous_period' && filters.from && filters.to) {
    const from = new Date(`${filters.from}T00:00:00`);
    const to = new Date(`${filters.to}T00:00:00`);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1);
    const previousTo = new Date(from.getTime() - DAY_MS);
    const previousFrom = new Date(previousTo.getTime() - (days - 1) * DAY_MS);
    const iso = (date: Date): string =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { from: iso(previousFrom), to: iso(previousTo), label: 'el periodo anterior' };
  }

  // Por defecto, el mes anterior al periodo actual (o al mes en curso).
  const base = filters.from ? new Date(`${filters.from}T00:00:00`) : now;
  const range = monthRange(base.getFullYear(), base.getMonth() - 1);
  return { ...range, label: 'el mes anterior' };
}

/** Compara el periodo actual con el anterior. */
async function comparePeriods(
  userId: string,
  plan: AiAskPlan,
  filter: StatsDocumentFilter,
  dimension: AiAskDimension | null,
  metric: AiAskMetric,
): Promise<{ chart: AiChart; insights: string[]; groups: AiAskGroup[] }> {
  const now = new Date();
  const previous = previousRange(plan.filters, plan.compare, now);

  // Sin fechas, se compara el mes en curso con el anterior.
  let current = { from: plan.filters.from, to: plan.filters.to };
  if (!current.from || !current.to) {
    const range = monthRange(now.getFullYear(), now.getMonth());
    current = { from: range.from, to: range.to };
  }

  const currentFilter: StatsDocumentFilter = { ...filter, from: current.from, to: current.to };
  const previousFilter: StatsDocumentFilter = { ...filter, from: previous.from, to: previous.to };

  const currentTotal = await countDocuments(userId, currentFilter);
  const previousTotal = await countDocuments(userId, previousFilter);

  const currentLabel = current.from === current.to ? current.from : `${current.from} → ${current.to}`;
  const previousLabel = `${previous.from} → ${previous.to}`;

  const categories = dimension
    ? await (async () => {
        const [a, b] = await Promise.all([
          groupedRows(userId, currentFilter, dimension, metric, plan.limit),
          groupedRows(userId, previousFilter, dimension, metric, plan.limit),
        ]);
        const labels: string[] = [];
        const currentValues: number[] = [];
        const previousValues: number[] = [];
        for (const row of a) {
          labels.push(row.label);
          currentValues.push(row.value);
          previousValues.push(b.find((item) => item.label === row.label)?.value ?? 0);
        }
        for (const row of b) {
          if (labels.includes(row.label)) continue;
          labels.push(row.label);
          currentValues.push(0);
          previousValues.push(row.value);
        }
        return { labels, currentValues, previousValues };
      })()
    : null;

  const delta = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null;
  const deltaText =
    delta === null
      ? `${previousTotal} → ${currentTotal}`
      : `${delta >= 0 ? '+' : ''}${Math.round(delta)} %`;

  const chart: AiChart = categories
    ? {
        kind: 'comparison',
        title: chartTitle(metric, dimension),
        unit: unitFor(metric),
        categories: categories.labels,
        keys: categories.labels,
        series: [
          { label: 'Periodo actual', values: categories.currentValues },
          { label: 'Periodo anterior', values: categories.previousValues },
        ],
      }
    : {
        kind: 'comparison',
        title: chartTitle(metric, null),
        unit: unitFor(metric),
        categories: ['Actual', 'Anterior'],
        keys: ['current', 'previous'],
        series: [{ label: METRIC_LABELS[metric], values: [currentTotal, previousTotal] }],
      };

  return {
    chart,
    insights: [
      `${currentTotal} documento${currentTotal === 1 ? '' : 's'} en el periodo actual frente a ${previousTotal} en ${previous.label} (${deltaText}).`,
    ],
    groups: categories
      ? categories.labels.map((label, index) => ({
          key: label,
          label,
          count: categories.currentValues[index] ?? 0,
        }))
      : [],
  };
}

/** Construye el gráfico y los insights del plan. */
export async function runAnalytics(
  userId: string,
  plan: AiAskPlan,
  templateRows: { id: string; name: string }[],
): Promise<AnalyticsResult> {
  if (plan.mode === 'clarify' || plan.mode === 'list' || plan.mode === 'search') {
    return { chart: null, insights: [], groups: [] };
  }

  const filter = statsFilterFromAsk(plan.filters, templateRows);
  const metric = plan.metrics[0] ?? 'count';
  const dimension = plan.dimensions[0] ?? null;

  if (plan.mode === 'compare') {
    return comparePeriods(userId, plan, filter, dimension, metric);
  }

  const total = await countDocuments(userId, filter);

  if (!dimension) {
    const chart: AiChart = {
      kind: 'kpi',
      title: chartTitle(metric, null),
      unit: unitFor(metric),
      categories: [METRIC_LABELS[metric]],
      keys: ['total'],
      series: [{ label: METRIC_LABELS[metric], values: [total] }],
    };
    return {
      chart,
      insights: total > 0 ? [] : ['No hay documentos con esos criterios.'],
      groups: [],
    };
  }

  const rows =
    dimension === 'month' || dimension === 'week'
      ? await timeSeries(userId, filter, metric, dimension === 'week' ? 'week' : 'month')
      : await groupedRows(userId, filter, dimension, metric, plan.limit);

  const categories = rows.map((row) => row.label);
  const values = rows.map((row) => row.value);

  const chart: AiChart = {
    kind: resolveChartKind(plan, dimension),
    title: chartTitle(metric, dimension),
    unit: unitFor(metric),
    categories,
    keys: rows.map((row) => row.key),
    series: [{ label: METRIC_LABELS[metric], values }],
  };

  const insights: string[] = [];
  if (metric === 'count' && rows.length > 0 && total > 0) {
    const top = rows[0];
    if (top && top.value > 0) {
      const share = Math.round((top.value / total) * 100);
      insights.push(`«${top.label}» concentra el ${share} % (${top.value} de ${total}).`);
    }
  }

  return {
    chart,
    insights,
    groups:
      metric === 'count' && (dimension === 'docType' || dimension === 'status')
        ? rows.map((row) => ({ key: row.key, label: row.label, count: row.value }))
        : [],
  };
}
