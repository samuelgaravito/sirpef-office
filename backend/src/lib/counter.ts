import { eq, inArray } from 'drizzle-orm';

import {
  DOC_TYPE_PREFIX,
  DOC_TYPES_WITHOUT_NUMBER,
  formatDocumentNumber,
  nextNumberValue,
  numberingPeriodYear,
  numberingSeriesLabel,
  type DocType,
  type NumberingPreview,
} from '@sirpefoffice/shared';

import { db } from '../db/index.js';
import { documentCounters, documents, numberingSeries, templates } from '../db/schema.js';
import {
  assignDocumentNumber,
  ensureNumberingSeries,
  getNumberingSeries,
  lastIssuedNumber,
  type DbExecutor,
  type NumberingSeriesRow,
} from './numbering.js';

/** Configuración de numeración de la plantilla que originó el documento. */
export interface TemplateNumbering {
  numberingEnabled: boolean;
  numberingPrefix: string | null;
}

/** Crea la serie con los valores predeterminados si todavía no existe. */
async function seriesForPrefix(prefix: string): Promise<NumberingSeriesRow> {
  const existing = await getNumberingSeries(prefix);
  if (existing) return existing;
  return ensureNumberingSeries({ prefix, startValue: 1, padding: 4, includeYear: true });
}

/**
 * Prefijo de la serie que corresponde a un documento, o `null` si no lleva
 * número. `''` es una serie válida: números sin prefijo (`2026-0001`).
 *
 * - Con plantilla: usa la serie y el interruptor configurados en ella.
 * - Sin plantilla: conserva el comportamiento histórico por tipo de documento.
 * - Currículum y documento en blanco no llevan número.
 */
export function numberingPrefixFor(options: {
  docType: DocType;
  template?: TemplateNumbering | null;
}): string | null {
  const { docType, template } = options;

  if (template) {
    if (!template.numberingEnabled) return null;
    const prefix = template.numberingPrefix ?? DOC_TYPE_PREFIX[docType];
    return prefix === undefined ? null : prefix;
  }

  if (DOC_TYPES_WITHOUT_NUMBER.includes(docType)) return null;
  const prefix = DOC_TYPE_PREFIX[docType];
  return prefix === undefined ? null : prefix;
}

/**
 * Serie de numeración que corresponde a un documento. La crea con valores
 * predeterminados si todavía no existe.
 */
export async function seriesForDocument(options: {
  docType: DocType;
  template?: TemplateNumbering | null;
}): Promise<NumberingSeriesRow | null> {
  const prefix = numberingPrefixFor(options);
  if (prefix === null) return null;
  return seriesForPrefix(prefix);
}

/**
 * Construye el número previsto a partir de una configuración de serie ya
 * resuelta y del último valor emitido. Función pura: no consulta la base.
 */
function buildPreview(options: {
  prefix: string;
  startValue: number;
  padding: number;
  includeYear: boolean;
  lastIssued: number;
}): NumberingPreview {
  const year = numberingPeriodYear(options.includeYear);
  const nextValue = nextNumberValue(options, options.lastIssued);
  return {
    number: formatDocumentNumber({
      prefix: options.prefix,
      value: nextValue,
      year,
      padding: options.padding,
      includeYear: options.includeYear,
    }),
    prefix: options.prefix,
    seriesLabel: numberingSeriesLabel(options.prefix),
    nextValue,
    includeYear: options.includeYear,
    year,
  };
}

/**
 * Número que le tocaría al documento si se oficializara ahora mismo.
 * **No reserva ni consume** el contador: es solo una lectura.
 */
export async function previewDocumentNumber(options: {
  docType: DocType;
  template?: TemplateNumbering | null;
}): Promise<NumberingPreview | null> {
  const prefix = numberingPrefixFor(options);
  if (prefix === null) return null;

  const series = await getNumberingSeries(prefix);
  const config = series ?? {
    prefix,
    startValue: 1,
    padding: 4,
    includeYear: true,
  };

  const lastIssued = series
    ? await lastIssuedNumber(series.prefix, series.includeYear)
    : 0;

  return buildPreview({ ...config, lastIssued });
}

/**
 * Versión por lotes de `previewDocumentNumber`: carga las series y los
 * contadores **una sola vez** para no hacer N+1 consultas en los listados.
 */
export async function numberingPreviewsFor(
  items: Array<{ docType: DocType; template?: TemplateNumbering | null }>,
): Promise<Array<NumberingPreview | null>> {
  if (items.length === 0) return [];

  const prefixes = [
    ...new Set(
      items
        .map((item) => numberingPrefixFor(item))
        .filter((prefix): prefix is string => prefix !== null),
    ),
  ];

  if (prefixes.length === 0) return items.map(() => null);

  const seriesRows = await db
    .select()
    .from(numberingSeries)
    .where(inArray(numberingSeries.prefix, prefixes));
  const seriesByPrefix = new Map(seriesRows.map((row) => [row.prefix, row]));

  const counters = await db.select().from(documentCounters);
  const counterByKey = new Map<string, number>();
  for (const row of counters) counterByKey.set(`${row.scope}:${row.year}`, row.counter);

  return items.map((item) => {
    const prefix = numberingPrefixFor(item);
    if (prefix === null) return null;

    const series = seriesByPrefix.get(prefix) ?? {
      prefix,
      startValue: 1,
      padding: 4,
      includeYear: true,
    };
    const year = numberingPeriodYear(series.includeYear);
    const lastIssued = counterByKey.get(`${prefix}:${year}`) ?? 0;
    return buildPreview({ ...series, lastIssued });
  });
}

/**
 * Número previsto de un documento concreto, para la exportación. Devuelve
 * `null` si el documento ya tiene número asignado.
 */
export async function pendingNumberForDocument(document: {
  docType: DocType;
  templateId: string | null;
  docNumber: string | null;
}): Promise<string | null> {
  if (document.docNumber) return null;

  let template: TemplateNumbering | null = null;
  if (document.templateId) {
    const [row] = await db
      .select({
        numberingEnabled: templates.numberingEnabled,
        numberingPrefix: templates.numberingPrefix,
      })
      .from(templates)
      .where(eq(templates.id, document.templateId))
      .limit(1);
    template = row ?? null;
  }

  const preview = await previewDocumentNumber({ docType: document.docType, template });
  return preview?.number ?? null;
}

/**
 * Asigna el número a un documento que se está oficializando. Debe llamarse
 * dentro de la transacción que sella el documento: bloquea la fila, resuelve
 * la serie y reserva el correlativo de forma atómica.
 *
 * Es idempotente: si el documento ya tiene número, lo devuelve sin tocar el
 * contador.
 */
export async function numberDocumentInTx(
  tx: DbExecutor,
  documentId: string,
): Promise<string | null> {
  const [locked] = await tx
    .select({
      id: documents.id,
      docNumber: documents.docNumber,
      data: documents.data,
      docType: documents.docType,
      templateId: documents.templateId,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .for('update')
    .limit(1);

  if (!locked) return null;
  if (locked.docNumber) return locked.docNumber;

  let template: TemplateNumbering | null = null;
  if (locked.templateId) {
    const [row] = await tx
      .select({
        numberingEnabled: templates.numberingEnabled,
        numberingPrefix: templates.numberingPrefix,
      })
      .from(templates)
      .where(eq(templates.id, locked.templateId))
      .limit(1);
    template = row ?? null;
  }

  const series = await seriesForDocument({ docType: locked.docType, template });
  if (!series) return null;

  return assignDocumentNumber(tx, locked, series);
}
