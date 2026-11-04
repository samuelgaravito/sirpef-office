import {
  DOC_TYPE_PREFIX,
  DOC_TYPES_WITHOUT_NUMBER,
  type DocType,
} from '@sirpefoffice/shared';

import {
  ensureNumberingSeries,
  getNumberingSeries,
  reserveDocumentNumber,
  type NumberingSeriesRow,
} from './numbering.js';

interface TemplateNumbering {
  numberingEnabled: boolean;
  numberingPrefix: string | null;
}

async function seriesForPrefix(prefix: string): Promise<NumberingSeriesRow> {
  const existing = await getNumberingSeries(prefix);
  if (existing) return existing;
  return ensureNumberingSeries({ prefix, startValue: 1, padding: 4, includeYear: true });
}

/**
 * Resuelve el número de un documento nuevo.
 *
 * - Con plantilla: usa la serie y el interruptor configurados en ella.
 * - Sin plantilla: conserva el comportamiento histórico por tipo de documento.
 * - Currículum y documento en blanco no llevan número.
 */
export async function documentNumberFor(options: {
  docType: DocType;
  template?: TemplateNumbering | null;
}): Promise<string | null> {
  const { docType, template } = options;

  if (template) {
    if (!template.numberingEnabled) return null;
    const prefix = template.numberingPrefix ?? DOC_TYPE_PREFIX[docType];
    // `''` es una serie válida: números sin prefijo (2026-0001).
    if (prefix === null || prefix === undefined) return null;
    return reserveDocumentNumber(await seriesForPrefix(prefix));
  }

  if (DOC_TYPES_WITHOUT_NUMBER.includes(docType)) return null;
  const prefix = DOC_TYPE_PREFIX[docType];
  if (!prefix) return null;
  return reserveDocumentNumber(await seriesForPrefix(prefix));
}
