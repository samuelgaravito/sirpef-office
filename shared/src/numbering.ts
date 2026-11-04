import type { DocType, VariableDef, VariableValues } from './types.js';

/**
 * Prefijo predeterminado de cada tipo de documento. Es solo el valor sugerido:
 * cada plantilla puede elegir otro prefijo y su propia serie de numeración.
 */
export const DOC_TYPE_PREFIX: Record<DocType, string> = {
  memorandum: 'MEM',
  delivery_note: 'NDE',
  report: 'INF',
  meeting_minutes: 'ACT',
  evaluation_plan: 'PLE',
  resume: 'CV',
  letter: 'OFI',
  certificate: 'CRT',
  blank: 'DOC',
};

/** Tipos que, por convención, no llevan número correlativo. */
export const DOC_TYPES_WITHOUT_NUMBER: readonly DocType[] = ['resume', 'blank'];

export const NUMBERING_PREFIX_PATTERN = /^[A-Z0-9]{2,10}$/;
export const NUMBERING_MAX_START = 999_999;
export const NUMBERING_MAX_PADDING = 8;

/** Clave reservada de la variable que muestra el número del documento. */
export const DOCUMENT_NUMBER_VARIABLE = 'numero_documento';

/** Variable de sistema disponible en el cuerpo, la cabecera y el pie. */
export const DOCUMENT_NUMBER_VARIABLE_DEF: VariableDef = {
  key: DOCUMENT_NUMBER_VARIABLE,
  label: 'Número de documento',
  type: 'text',
  required: false,
  description: 'Correlativo asignado automáticamente al crear el documento.',
};

export const SYSTEM_VARIABLES: readonly VariableDef[] = [DOCUMENT_NUMBER_VARIABLE_DEF];

/** Devuelve una copia de los valores con el número de documento inyectado. */
export function withDocumentNumber(
  values: VariableValues,
  docNumber: string | null | undefined,
): VariableValues {
  return { ...values, [DOCUMENT_NUMBER_VARIABLE]: docNumber ?? '' };
}

/** Configuración de una serie de numeración (identificada por su prefijo). */
export interface NumberingSeriesConfig {
  prefix: string;
  /** Primer número de la serie y de cada año nuevo. */
  startValue: number;
  /** Cantidad de dígitos del correlativo (relleno con ceros). */
  padding: number;
  /** Si el número incluye el año y se reinicia cada año. */
  includeYear: boolean;
}

/** Estado calculado de una serie para mostrarlo en la interfaz. */
export interface NumberingSeriesState extends NumberingSeriesConfig {
  /** Último número emitido en el período vigente (0 si aún no hay). */
  lastIssued: number;
  /** Valor que tendrá el próximo documento. */
  nextValue: number;
  /** Número formateado que verá el próximo documento. */
  nextNumber: string;
  /** Plantillas que comparten esta serie. */
  templateCount: number;
}

/** Normaliza el prefijo: mayúsculas, sin espacios y sin guiones. */
export function normalizeNumberingPrefix(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

/** Año que usa el contador; 0 cuando la serie es continua y no muestra año. */
export function numberingPeriodYear(includeYear: boolean, now = new Date()): number {
  return includeYear ? now.getFullYear() : 0;
}

/** Formatea el número correlativo, p. ej. `MEM-2026-0007`. */
export function formatDocumentNumber(options: {
  prefix: string;
  value: number;
  year: number;
  padding: number;
  includeYear: boolean;
}): string {
  const padded = String(Math.max(0, Math.trunc(options.value))).padStart(options.padding, '0');
  const core = options.includeYear ? `${options.year}-${padded}` : padded;
  return options.prefix ? `${options.prefix}-${core}` : core;
}

/** Valor que tendrá el próximo documento de la serie. */
export function nextNumberValue(
  series: Pick<NumberingSeriesConfig, 'startValue'>,
  lastIssued: number,
): number {
  return lastIssued > 0 ? lastIssued + 1 : series.startValue;
}

/** Mínimo valor inicial permitido: nunca por debajo de lo ya emitido. */
export function minimumStartValue(lastIssued: number): number {
  return lastIssued > 0 ? lastIssued + 1 : 1;
}
