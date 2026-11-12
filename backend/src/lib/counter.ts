import { eq } from 'drizzle-orm';

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
import { documentCounters, documents, templates } from '../db/schema.js';
import {
  assignDocumentNumber,
  ensureTemplateSeries,
  getTemplateSeries,
  getTemplateSeriesMap,
  lastIssuedNumber,
  liveNumberingFloors,
  type DbExecutor,
  type NumberingSeriesRow,
} from './numbering.js';

/**
 * Configuración de numeración de la plantilla que originó el documento.
 *
 * El prefijo y los ajustes del contador **no** vienen aquí: viven en la serie
 * de la plantilla, que es la única fuente de verdad.
 */
export interface TemplateNumbering {
  /** Plantilla que la origina; `null` si el documento no tiene ninguna. */
  templateId: string | null;
  numberingEnabled: boolean;
}

/**
 * Convierte la fila de una plantilla en su configuración de numeración.
 *
 * Evita repetir el mismo mapeo en cada ruta que necesita el número previsto.
 */
export function templateNumberingFrom(row: {
  id: string;
  numberingEnabled: boolean;
}): TemplateNumbering {
  return {
    templateId: row.id,
    numberingEnabled: row.numberingEnabled,
  };
}

/**
 * Prefijo de la serie que corresponde a un documento, o `null` si no lleva
 * número.
 *
 * - Con plantilla: usa la serie de esa plantilla. Cada plantilla tiene su
 *   propio prefijo y su propia enumeración, así que sus números no se
 *   intercalan con los de otra aunque compartan etiqueta.
 * - Sin plantilla: no hay serie. Un documento suelto no puede numerarse sin
 *   una serie propia.
 * - Currículum y documento en blanco no llevan número.
 */
export function numberingPrefixFor(options: {
  docType: DocType;
  template?: TemplateNumbering | null;
}): string | null {
  const { docType, template } = options;

  if (!template) return null;
  if (!template.numberingEnabled) return null;

  // El prefijo vive en la serie; aquí solo el respaldo para una plantilla
  // que todavía no tiene ninguna.
  return DOC_TYPE_PREFIX[docType];
}

/**
 * Serie de numeración que corresponde a un documento. La crea con valores
 * predeterminados si la plantilla todavía no tiene ninguna.
 */
export async function seriesForDocument(options: {
  docType: DocType;
  template?: TemplateNumbering | null;
}): Promise<NumberingSeriesRow | null> {
  const { docType, template } = options;

  if (!template) return null;
  if (!template.numberingEnabled) return null;
  if (!template.templateId) return null;

  const series = await getTemplateSeries(template.templateId);
  if (series) return series;

  // La plantilla todavía no tiene serie (datos antiguos): se le crea la suya
  // con el prefijo que le corresponde.
  const prefix = numberingPrefixFor({ docType, template });
  if (!prefix) return null;
  return ensureTemplateSeries({ templateId: template.templateId, prefix });
}

/**
 * Construye el número previsto a partir de una configuración de serie ya
 * resuelta y del último valor emitido. Función pura: no consulta la base.
 */
function buildPreview(options: {
  id: string;
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
    seriesId: options.id,
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

  const template = options.template;
  const series = template?.templateId
    ? await getTemplateSeries(template.templateId)
    : null;

  const config = series ?? {
    id: '',
    prefix,
    startValue: 1,
    padding: 4,
    includeYear: true,
  };

  const lastIssued = series ? await lastIssuedNumber(series.id, series.includeYear) : 0;

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

  const templateIds = [
    ...new Set(
      items
        .map((item) => item.template?.templateId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  const seriesByTemplate = await getTemplateSeriesMap(templateIds);
  const seriesIds = [...seriesByTemplate.values()].map((row) => row.id);

  const counters = await db.select().from(documentCounters);
  const counterByKey = new Map<string, number>();
  for (const row of counters) counterByKey.set(`${row.seriesId}:${row.year}`, row.counter);

  // Suelo real: el mayor correlativo que ocupan los documentos vivos. Evita
  // previsualizar un número que ya está ocupado aunque el contador esté
  // desfasado. Cada serie cuenta solo con sus propios documentos.
  const floors = await liveNumberingFloors(seriesIds);

  return items.map((item) => {
    const prefix = numberingPrefixFor(item);
    if (prefix === null) return null;

    const template = item.template;
    const series = template?.templateId ? seriesByTemplate.get(template.templateId) : undefined;

    const config = series ?? {
      id: '',
      prefix,
      startValue: 1,
      padding: 4,
      includeYear: true,
    };

    const year = numberingPeriodYear(config.includeYear);
    const key = `${config.id}:${year}`;
    const lastIssued =
      config.id === ''
        ? 0
        : Math.max(counterByKey.get(key) ?? 0, floors.get(key) ?? 0);
    return buildPreview({ ...config, lastIssued });
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
        id: templates.id,
        numberingEnabled: templates.numberingEnabled,
      })
      .from(templates)
      .where(eq(templates.id, document.templateId))
      .limit(1);
    template = row ? templateNumberingFrom(row) : null;
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
        id: templates.id,
        numberingEnabled: templates.numberingEnabled,
      })
      .from(templates)
      .where(eq(templates.id, locked.templateId))
      .limit(1);
    template = row ? templateNumberingFrom(row) : null;
  }

  const series = await seriesForDocument({ docType: locked.docType, template });
  if (!series) return null;

  return assignDocumentNumber(tx, locked, series);
}
