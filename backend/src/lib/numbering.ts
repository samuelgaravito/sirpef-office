import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import {
  formatDocumentNumber,
  minimumStartValue,
  nextNumberValue,
  normalizeNumberingPrefix,
  numberingPeriodYear,
  NUMBERING_MAX_PADDING,
  NUMBERING_MAX_START,
  NUMBERING_PREFIX_PATTERN,
  type NumberingSeriesConfig,
  type NumberingSeriesState,
} from '@sirpefoffice/shared';

import { db } from '../db/index.js';
import { documentCounters, numberingSeries, templates } from '../db/schema.js';
import { badRequest, notFound } from './errors.js';

export type NumberingSeriesRow = typeof numberingSeries.$inferSelect;

export interface NumberingSeriesInput extends NumberingSeriesConfig {
  createdBy?: string | null;
}

export interface NumberingSeriesPatch {
  startValue?: number;
  padding?: number;
  includeYear?: boolean;
}

/** Valida y normaliza un prefijo de serie. `''` representa “sin prefijo”. */
export function parseNumberingPrefix(raw: string): string {
  const prefix = normalizeNumberingPrefix(raw);
  if (prefix === '') return '';
  if (!NUMBERING_PREFIX_PATTERN.test(prefix)) {
    throw badRequest('El prefijo debe tener entre 2 y 10 letras o números, sin espacios ni guiones');
  }
  return prefix;
}

function assertRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${name} debe ser un entero entre ${min} y ${max}`);
  }
}

/** Devuelve la serie de un prefijo o null si todavía no existe. */
export async function getNumberingSeries(prefix: string): Promise<NumberingSeriesRow | null> {
  const normalized = normalizeNumberingPrefix(prefix);
  const [row] = await db
    .select()
    .from(numberingSeries)
    .where(eq(numberingSeries.prefix, normalized))
    .limit(1);
  return row ?? null;
}

/** Crea la serie si no existe; si ya existe respeta su configuración. */
export async function ensureNumberingSeries(
  input: NumberingSeriesInput,
): Promise<NumberingSeriesRow> {
  const prefix = parseNumberingPrefix(input.prefix);
  const existing = await getNumberingSeries(prefix);
  if (existing) return existing;

  assertRange('El número inicial', input.startValue, 1, NUMBERING_MAX_START);
  assertRange('El relleno', input.padding, 1, NUMBERING_MAX_PADDING);

  const [created] = await db
    .insert(numberingSeries)
    .values({
      prefix,
      startValue: input.startValue,
      padding: input.padding,
      includeYear: input.includeYear,
      createdBy: input.createdBy ?? null,
      updatedBy: input.createdBy ?? null,
    })
    .returning();

  if (!created) throw new Error('No se pudo crear la serie de numeración');
  return created;
}

/** Último número emitido en el período vigente (0 si aún no hay). */
export async function lastIssuedNumber(
  prefix: string,
  includeYear: boolean,
): Promise<number> {
  const year = numberingPeriodYear(includeYear);
  const [row] = await db
    .select({ counter: documentCounters.counter })
    .from(documentCounters)
    .where(and(eq(documentCounters.scope, prefix), eq(documentCounters.year, year)))
    .limit(1);
  return row?.counter ?? 0;
}

function toState(
  series: NumberingSeriesRow,
  lastIssued: number,
  templateCount: number,
): NumberingSeriesState {
  const nextValue = nextNumberValue(series, lastIssued);
  return {
    prefix: series.prefix,
    startValue: series.startValue,
    padding: series.padding,
    includeYear: series.includeYear,
    lastIssued,
    nextValue,
    nextNumber: formatDocumentNumber({
      prefix: series.prefix,
      value: nextValue,
      year: numberingPeriodYear(series.includeYear),
      padding: series.padding,
      includeYear: series.includeYear,
    }),
    templateCount,
  };
}

/** Estado de una serie concreta (incluye el próximo número). */
export async function getNumberingState(prefix: string): Promise<NumberingSeriesState | null> {
  const series = await getNumberingSeries(prefix);
  if (!series) return null;

  const lastIssued = await lastIssuedNumber(series.prefix, series.includeYear);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(eq(templates.numberingPrefix, series.prefix), isNull(templates.deletedAt)));

  return toState(series, lastIssued, countRow?.count ?? 0);
}

/** Todas las series ordenadas por prefijo. */
export async function listNumberingStates(): Promise<NumberingSeriesState[]> {
  const series = await db.select().from(numberingSeries).orderBy(asc(numberingSeries.prefix));
  if (series.length === 0) return [];

  const counters = await db.select().from(documentCounters);
  const counterByKey = new Map<string, number>();
  for (const row of counters) counterByKey.set(`${row.scope}:${row.year}`, row.counter);

  const countRows = await db
    .select({ prefix: templates.numberingPrefix, count: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(isNotNull(templates.numberingPrefix), isNull(templates.deletedAt)))
    .groupBy(templates.numberingPrefix);
  const countByPrefix = new Map<string, number>();
  for (const row of countRows) {
    if (row.prefix !== null) countByPrefix.set(row.prefix, row.count);
  }

  return series.map((row) => {
    const year = numberingPeriodYear(row.includeYear);
    const lastIssued = counterByKey.get(`${row.prefix}:${year}`) ?? 0;
    return toState(row, lastIssued, countByPrefix.get(row.prefix) ?? 0);
  });
}

/**
 * Actualiza la configuración de una serie. El número inicial no puede
 * retroceder por debajo de lo ya emitido; si avanza, el próximo documento
 * usará exactamente ese valor.
 */
export async function updateNumberingSeries(
  rawPrefix: string,
  patch: NumberingSeriesPatch,
  userId: string,
): Promise<NumberingSeriesState> {
  const prefix = parseNumberingPrefix(rawPrefix);
  const series = await getNumberingSeries(prefix);
  if (!series) throw notFound('Serie de numeración no encontrada');

  const startValue = patch.startValue ?? series.startValue;
  const padding = patch.padding ?? series.padding;
  const includeYear = patch.includeYear ?? series.includeYear;

  assertRange('El número inicial', startValue, 1, NUMBERING_MAX_START);
  assertRange('El relleno', padding, 1, NUMBERING_MAX_PADDING);

  if (includeYear !== series.includeYear) {
    const [anyCounter] = await db
      .select({ counter: documentCounters.counter })
      .from(documentCounters)
      .where(eq(documentCounters.scope, prefix))
      .orderBy(sql`${documentCounters.counter} desc`)
      .limit(1);
    if ((anyCounter?.counter ?? 0) > 0) {
      throw badRequest(
        'No se puede cambiar el uso del año: la serie ya tiene documentos emitidos. Crea un prefijo nuevo para empezar otra numeración.',
      );
    }
  }

  if (startValue !== series.startValue) {
    const lastIssued = await lastIssuedNumber(prefix, includeYear);
    const minimum = minimumStartValue(lastIssued);
    if (startValue < minimum) {
      throw badRequest(
        `El número inicial no puede ser ${startValue}: el último emitido es ${lastIssued}. El mínimo permitido es ${minimum}.`,
        { minimum, lastIssued },
      );
    }

    const year = numberingPeriodYear(includeYear);
    await db
      .insert(documentCounters)
      .values({ scope: prefix, year, counter: startValue - 1 })
      .onConflictDoUpdate({
        target: [documentCounters.scope, documentCounters.year],
        set: { counter: startValue - 1 },
      });
  }

  const [updated] = await db
    .update(numberingSeries)
    .set({
      startValue,
      padding,
      includeYear,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(numberingSeries.prefix, prefix))
    .returning();

  if (!updated) throw new Error('No se pudo actualizar la serie de numeración');
  return (await getNumberingState(prefix)) ?? toState(updated, 0, 0);
}

/**
 * Reserva el siguiente número de forma atómica. El UPSERT con RETURNING
 * garantiza que dos peticiones simultáneas nunca obtengan el mismo número.
 */
export async function reserveDocumentNumber(series: NumberingSeriesRow): Promise<string> {
  const year = numberingPeriodYear(series.includeYear);

  const [row] = await db
    .insert(documentCounters)
    .values({ scope: series.prefix, year, counter: series.startValue })
    .onConflictDoUpdate({
      target: [documentCounters.scope, documentCounters.year],
      set: { counter: sql`${documentCounters.counter} + 1` },
    })
    .returning({ counter: documentCounters.counter });

  const value = row?.counter ?? series.startValue;
  return formatDocumentNumber({
    prefix: series.prefix,
    value,
    year,
    padding: series.padding,
    includeYear: series.includeYear,
  });
}
