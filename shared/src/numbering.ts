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

/**
 * Prefijo de una serie: de 1 a 20 letras o números en mayúsculas.
 *
 * El prefijo es la etiqueta visible del número. **No es único**: cada
 * plantilla tiene su propia serie y puede repetir prefijo, porque su
 * enumeración (su contador) es propia.
 */
export const NUMBERING_PREFIX_PATTERN = /^[A-Z0-9]{1,20}$/;
export const NUMBERING_MIN_PREFIX_LENGTH = 1;
export const NUMBERING_MAX_PREFIX_LENGTH = 20;
export const NUMBERING_MAX_START = 999_999;
export const NUMBERING_MAX_PADDING = 8;

/** Longitud del código corto que recibe la plantilla sin prefijo propio. */
export const NUMBERING_AUTO_PREFIX_LENGTH = 4;

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

/**
 * Devuelve una copia de los valores con el número de documento inyectado.
 *
 * Si el documento todavía no se ha numerado pero se conoce el previsto, se
 * muestra con la marca `(previsto)` para que el PDF de un borrador no quede
 * con el hueco vacío.
 */
export function withDocumentNumber(
  values: VariableValues,
  docNumber: string | null | undefined,
  pendingNumber?: string | null,
): VariableValues {
  const value = docNumber || (pendingNumber ? pendingNumberText(pendingNumber) : '');
  return { ...values, [DOCUMENT_NUMBER_VARIABLE]: value };
}

/** Configuración de una serie de numeración (identificada por su `id`). */
export interface NumberingSeriesConfig {
  /** Etiqueta visible del número. Puede repetirse entre series. */
  prefix: string;
  /** Primer número de la serie y de cada año nuevo. */
  startValue: number;
  /** Cantidad de dígitos del correlativo (relleno con ceros). */
  padding: number;
  /** Si el número incluye el año y se reinicia cada año. */
  includeYear: boolean;
}

/**
 * Número que le tocaría a un documento si se oficializara ahora. Es
 * orientativo: no reserva el correlativo.
 */
export interface NumberingPreview {
  /** Número formateado, p. ej. `MEM-0008-2026`. */
  number: string;
  /** Prefijo de la serie (`''` = serie sin prefijo). */
  prefix: string;
  /** Etiqueta legible de la serie, p. ej. `Serie MEM`. */
  seriesLabel: string;
  /** Serie a la que pertenece el número (la de la plantilla). */
  seriesId: string;
  /** Valor correlativo que se usará. */
  nextValue: number;
  includeYear: boolean;
  /** Año del período (`0` = serie continua). */
  year: number;
}

/** Textos de la numeración, compartidos por todas las pantallas. */
export const NUMBERING_MESSAGES = {
  pendingSuffix: '(previsto)',
  calculating: 'Calculando…',
  assigned: 'Número asignado',
  pendingChip: 'se asigna al aprobar',
  pendingTitle: 'Número previsto',
  pendingHint: 'El número que tendrá el documento cuando se apruebe y envíe.',
  pendingWarning: 'Puede cambiar si otro documento de esta plantilla se aprueba antes.',
  pendingWarningShort: 'puede cambiar si otro documento de esta plantilla se aprueba antes',
  disabled: 'Sin numeración',
  variableLabel: 'Número de documento',
  variablePendingTitle: 'Número previsto: se confirmará al aprobar',
  assignOnApprove: (number: string) =>
    `Al aprobarse, este documento quedará numerado como ${number}.`,
  assignOnApproveShort: (number: string) => `Se asigna al aprobar como ${number}`,
  approvedAs: (number: string) => `Aprobado y enviado como ${number}`,
  changedFrom: (number: string, previous: string) =>
    `Se asignó ${number} (el previsto era ${previous})`,
} as const;

/** Etiqueta legible de una serie a partir de su prefijo. */
export function numberingSeriesLabel(prefix: string): string {
  return prefix ? `Serie ${prefix}` : 'Serie sin prefijo';
}

/** Cómo se muestra un número previsto dentro del documento. */
export function pendingNumberText(number: string): string {
  return `${number} ${NUMBERING_MESSAGES.pendingSuffix}`;
}

/** Estado calculado de una serie para mostrarlo en la interfaz. */
export interface NumberingSeriesState extends NumberingSeriesConfig {
  /** Identificador de la serie: es lo que la identifica, no el prefijo. */
  id: string;
  /** Último número emitido en el período vigente (0 si aún no hay). */
  lastIssued: number;
  /** Valor que tendrá el próximo documento. */
  nextValue: number;
  /** Número formateado que verá el próximo documento. */
  nextNumber: string;
  /** Plantilla que usa esta serie, si el usuario puede verla. */
  templateId: string | null;
  /** Nombre de esa plantilla, si el usuario puede verla. */
  templateName: string | null;
  /** Otra serie usa el mismo prefijo (cada una con su enumeración). */
  prefixShared: boolean;
}

/** Normaliza el prefijo: mayúsculas, sin espacios y sin guiones. */
export function normalizeNumberingPrefix(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

/**
 * Código corto que recibe una plantilla sin prefijo propio.
 *
 * Se deriva del identificador de la plantilla, así que es estable aunque se
 * renombre la plantilla y es único porque el UUID lo es. El servidor alarga el
 * código si encuentra otro que ya esté en uso.
 */
export function autoNumberingPrefix(templateId: string, length = NUMBERING_AUTO_PREFIX_LENGTH): string {
  return templateId.replace(/-/g, '').toUpperCase().slice(0, length);
}

/** Año que usa el contador; 0 cuando la serie es continua y no muestra año. */
export function numberingPeriodYear(includeYear: boolean, now = new Date()): number {
  return includeYear ? now.getFullYear() : 0;
}

/**
 * Formatea el número correlativo, p. ej. `MEM-0007-2026`.
 *
 * El orden es prefijo, correlativo y año. Sin año queda `MEM-0007`.
 */
export function formatDocumentNumber(options: {
  prefix: string;
  value: number;
  year: number;
  padding: number;
  includeYear: boolean;
}): string {
  const padded = String(Math.max(0, Math.trunc(options.value))).padStart(options.padding, '0');
  const core = options.includeYear ? `${padded}-${options.year}` : padded;
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
