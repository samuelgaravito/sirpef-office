import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import {
  autoNumberingPrefix,
  DOC_TYPES_WITHOUT_NUMBER,
  formatDocumentNumber,
  minimumStartValue,
  nextNumberValue,
  normalizeNumberingPrefix,
  numberingPeriodYear,
  NUMBERING_AUTO_PREFIX_LENGTH,
  NUMBERING_MAX_PADDING,
  NUMBERING_MAX_PREFIX_LENGTH,
  NUMBERING_MAX_START,
  NUMBERING_MIN_PREFIX_LENGTH,
  NUMBERING_PREFIX_PATTERN,
  type DocType,
  type NumberingSeriesConfig,
  type NumberingSeriesState,
  type VariableValues,
} from '@sirpefoffice/shared';

import { db, type Database } from '../db/index.js';
import {
  documentCounters,
  documents,
  numberingSeries,
  templates,
} from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';

/**
 * Ejecutor de consultas: la conexión normal o una transacción. Permite que la
 * reserva del número y la actualización del documento ocurran juntas.
 */
export type DbExecutor = Pick<Database, 'insert' | 'update' | 'select'>;

export type NumberingSeriesRow = typeof numberingSeries.$inferSelect;

export interface NumberingSeriesInput extends NumberingSeriesConfig {
  createdBy?: string | null;
}

export interface NumberingSeriesPatch {
  startValue?: number;
  padding?: number;
  includeYear?: boolean;
}

/** Usuario que pide una operación de numeración. */
export interface NumberingUser {
  sub: string;
  role: 'admin' | 'member';
}

/** Plantilla viva que usa una serie. */
export interface SeriesOwner {
  id: string;
  name: string;
  ownerId: string;
  isShared: boolean;
  isActive: boolean;
}

/**
 * Valida y normaliza un prefijo de serie.
 *
 * El prefijo identifica la serie y es único entre las plantillas vivas: dos
 * plantillas que compartieran prefijo compartirían contador y sus números se
 * intercalaría.
 */
export function parseNumberingPrefix(raw: string): string {
  const prefix = normalizeNumberingPrefix(raw);
  if (prefix === '') {
    throw badRequest('El prefijo no puede estar vacío');
  }
  if (!NUMBERING_PREFIX_PATTERN.test(prefix)) {
    throw badRequest(
      `El prefijo debe tener entre ${NUMBERING_MIN_PREFIX_LENGTH} y ${NUMBERING_MAX_PREFIX_LENGTH} letras o números, sin espacios ni guiones`,
    );
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

/** ¿Existe ya una serie con ese prefijo? */
export async function seriesExists(prefix: string): Promise<boolean> {
  const [row] = await db
    .select({ prefix: numberingSeries.prefix })
    .from(numberingSeries)
    .where(eq(numberingSeries.prefix, prefix))
    .limit(1);
  return Boolean(row);
}

/**
 * Plantilla viva que usa la serie de este prefijo.
 *
 * Como el prefijo es único entre las plantillas vivas, solo puede haber una.
 */
export async function findSeriesOwner(
  prefix: string,
  excludeTemplateId?: string,
): Promise<SeriesOwner | null> {
  const [row] = await db
    .select({
      id: templates.id,
      name: templates.name,
      ownerId: templates.ownerId,
      isShared: templates.isShared,
      isActive: templates.isActive,
    })
    .from(templates)
    .where(
      and(
        eq(templates.numberingPrefix, prefix),
        isNull(templates.deletedAt),
        excludeTemplateId ? ne(templates.id, excludeTemplateId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** El usuario puede ver los datos de una plantilla ajena si está compartida. */
function canSeeOwner(owner: SeriesOwner, user: NumberingUser): boolean {
  if (owner.ownerId === user.sub) return true;
  if (!owner.isShared) return false;
  return user.role === 'admin' || owner.isActive;
}

/**
 * Código corto y único para una plantilla sin prefijo propio.
 *
 * Se deriva del identificador de la plantilla (estable aunque se renombre) y
 * se alarga si el resultado ya está ocupado por otra serie.
 *
 * Si la plantilla ya tiene un código automático propio, se conserva: es el
 * que identificaba su serie y cambiarlo rompería su enumeración.
 */
export async function generateAutoPrefix(
  templateId: string,
  currentPrefix?: string | null,
): Promise<string> {
  if (currentPrefix) {
    const owner = await findSeriesOwner(currentPrefix, templateId);
    // La serie es suya (o está libre): se mantiene el código.
    if (!owner || owner.id === templateId) return currentPrefix;
  }

  for (let length = NUMBERING_AUTO_PREFIX_LENGTH; length <= NUMBERING_MAX_PREFIX_LENGTH; length += 1) {
    const candidate = autoNumberingPrefix(templateId, length);
    if (!(await seriesExists(candidate))) return candidate;
  }
  throw badRequest('No se pudo asignar un prefijo automático. Escribe un prefijo propio.');
}

/** Crea la serie si no existe; si ya existe, respeta su configuración. */
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
    // Otra petición simultánea pudo crearla: se reutiliza la existente.
    .onConflictDoNothing({ target: numberingSeries.prefix })
    .returning();

  if (created) return created;

  const raced = await getNumberingSeries(prefix);
  if (!raced) throw new Error('No se pudo crear la serie de numeración');
  return raced;
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
  owner: SeriesOwner | null,
  user: NumberingUser | null,
): NumberingSeriesState {
  const nextValue = nextNumberValue(series, lastIssued);
  const visible = owner && user ? canSeeOwner(owner, user) : Boolean(owner);
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
    taken: Boolean(owner),
    templateId: visible ? (owner?.id ?? null) : null,
    templateName: visible ? (owner?.name ?? null) : null,
  };
}

/** Estado de una serie concreta (incluye el próximo número). */
export async function getNumberingState(
  prefix: string,
  user?: NumberingUser,
): Promise<NumberingSeriesState | null> {
  const series = await getNumberingSeries(prefix);
  if (!series) return null;

  const lastIssued = await lastIssuedNumber(series.prefix, series.includeYear);
  const owner = await findSeriesOwner(series.prefix);
  return toState(series, lastIssued, owner, user ?? null);
}

/** Todas las series ordenadas por prefijo. */
export async function listNumberingStates(user?: NumberingUser): Promise<NumberingSeriesState[]> {
  const series = await db.select().from(numberingSeries).orderBy(asc(numberingSeries.prefix));
  if (series.length === 0) return [];

  const counters = await db.select().from(documentCounters);
  const counterByKey = new Map<string, number>();
  for (const row of counters) counterByKey.set(`${row.scope}:${row.year}`, row.counter);

  // Una sola consulta para saber qué plantilla usa cada serie.
  const owners = await db
    .select({
      id: templates.id,
      name: templates.name,
      ownerId: templates.ownerId,
      isShared: templates.isShared,
      isActive: templates.isActive,
      prefix: templates.numberingPrefix,
    })
    .from(templates)
    .where(and(isNull(templates.deletedAt), ne(templates.numberingPrefix, '')));
  const ownerByPrefix = new Map<string, SeriesOwner>();
  for (const row of owners) {
    if (!row.prefix) continue;
    if (ownerByPrefix.has(row.prefix)) continue;
    ownerByPrefix.set(row.prefix, {
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      isShared: row.isShared,
      isActive: row.isActive,
    });
  }

  return series.map((row) => {
    const year = numberingPeriodYear(row.includeYear);
    const lastIssued = counterByKey.get(`${row.prefix}:${year}`) ?? 0;
    return toState(row, lastIssued, ownerByPrefix.get(row.prefix) ?? null, user ?? null);
  });
}

/**
 * Actualiza la configuración de una serie. El número inicial no puede
 * retroceder por debajo de lo ya emitido; si se sube, el próximo documento
 * usará exactamente ese valor.
 */
export async function updateNumberingSeries(
  rawPrefix: string,
  patch: NumberingSeriesPatch,
  userId: string,
): Promise<NumberingSeriesRow> {
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
  return updated;
}

/**
 * Suelo real de cada serie: el mayor correlativo que ocupan los documentos
 * vivos de ese prefijo y año.
 *
 * Evita previsualizar un número ya ocupado aunque el contador esté
 * desfasado (por ejemplo tras una restauración de la base de datos).
 */
export async function liveNumberingFloors(
  prefixes: string[],
): Promise<Map<string, number>> {
  const floors = new Map<string, number>();
  if (prefixes.length === 0) return floors;

  const rows = await db
    .select({
      prefix: documents.numberingPrefix,
      year: documents.numberingYear,
      value: documents.numberingValue,
    })
    .from(documents)
    .where(
      and(
        inArray(documents.numberingPrefix, prefixes),
        isNull(documents.deletedAt),
        isNotNull(documents.numberingValue),
      ),
    );

  for (const row of rows) {
    if (!row.prefix || row.value === null || row.year === null) continue;
    const key = `${row.prefix}:${row.year}`;
    const current = floors.get(key) ?? 0;
    if (row.value > current) floors.set(key, row.value);
  }

  return floors;
}

/** Número reservado de una serie, con sus componentes desglosados. */
export interface ReservedNumber {
  prefix: string;
  year: number;
  value: number;
  /** Número formateado, p. ej. `MEM-0007-2026`. */
  number: string;
}

/**
 * Reserva el siguiente número de forma atómica. El UPSERT con RETURNING
 * garantiza que dos peticiones simultáneas nunca obtengan el mismo número.
 *
 * `exec` permite operar dentro de una transacción (`tx`) para que la reserva
 * y la actualización del documento sean atómicas entre sí.
 */
export async function reserveDocumentNumber(
  series: NumberingSeriesRow,
  exec: DbExecutor = db,
): Promise<ReservedNumber> {
  const year = numberingPeriodYear(series.includeYear);

  // Suelo real: el mayor correlativo que ocupan los documentos vivos. Si el
  // contador quedó desfasado (por una restauración o un ajuste manual), el
  // número reservado nunca pisa uno ya emitido.
  const floor = await liveNumberingFloors([series.prefix]);
  const realFloor = floor.get(`${series.prefix}:${year}`) ?? 0;

  const [row] = await exec
    .insert(documentCounters)
    .values({ scope: series.prefix, year, counter: series.startValue })
    .onConflictDoUpdate({
      target: [documentCounters.scope, documentCounters.year],
      // `GREATEST` evita que subir el número inicial retroceda la secuencia y
      // que el suelo real se pise.
      set: {
        counter: sql`GREATEST(${documentCounters.counter}, ${series.startValue - 1}, ${realFloor}) + 1`,
      },
    })
    .returning({ counter: documentCounters.counter });

  const value = row?.counter ?? series.startValue;
  return {
    prefix: series.prefix,
    year,
    value,
    number: formatDocumentNumber({
      prefix: series.prefix,
      value,
      year,
      padding: series.padding,
      includeYear: series.includeYear,
    }),
  };
}

/**
 * Asigna el número a un documento que se está oficializando. Debe llamarse
 * dentro de una transacción y con la fila del documento bloqueada
 * (`SELECT … FOR UPDATE`), para que dos aprobaciones simultáneas no gasten
 * dos números.
 *
 * Es idempotente: si el documento ya tiene número, no toca el contador.
 */
export async function assignDocumentNumber(
  exec: DbExecutor,
  document: { id: string; docNumber: string | null; data: VariableValues },
  series: NumberingSeriesRow,
): Promise<string> {
  if (document.docNumber) return document.docNumber;

  const reserved = await reserveDocumentNumber(series, exec);

  const nextData: VariableValues = { ...(document.data ?? {}) };
  // Compatibilidad: las plantillas antiguas usan {{numero}} como campo manual.
  if (!nextData.numero) nextData.numero = reserved.number;

  await exec
    .update(documents)
    .set({
      docNumber: reserved.number,
      numberingPrefix: reserved.prefix,
      numberingYear: reserved.year,
      numberingValue: reserved.value,
      data: nextData,
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, document.id), isNull(documents.docNumber)));

  return reserved.number;
}

/* ───────────────────────── Configuración por plantilla ───────────────────── */

/** Datos de numeración que envía el cliente al guardar una plantilla. */
export interface TemplateNumberingInput {
  enabled?: boolean;
  prefix?: string | null;
  startValue?: number;
  padding?: number;
  includeYear?: boolean;
}

/** Configuración de numeración vigente de una plantilla. */
export interface TemplateNumberingCurrent {
  numberingEnabled: boolean;
  numberingPrefix: string | null;
  numberingPrefixAuto: boolean;
}

/** Resultado de resolver la numeración de una plantilla. */
export interface TemplateNumberingResult {
  enabled: boolean;
  prefix: string | null;
  auto: boolean;
  series: NumberingSeriesRow | null;
}

/**
 * Resuelve la numeración de una plantilla y deja su serie lista.
 *
 * - Con un prefijo explícito se valida y no puede estar en uso por otra
 *   plantilla viva: dos series con el mismo prefijo compartirían contador y sus
 *   números se intercalaría.
 * - Sin prefijo se asigna un código corto único derivado del identificador.
 * - Con la numeración apagada la plantilla no lleva número, pero conserva el
 *   prefijo para recuperarlo al volver a encenderla.
 */
export async function resolveTemplateNumbering(options: {
  templateId: string;
  docType: DocType;
  user: NumberingUser;
  input?: TemplateNumberingInput | undefined;
  current?: TemplateNumberingCurrent | null;
}): Promise<TemplateNumberingResult> {
  const { templateId, docType, user, input, current } = options;

  const enabled =
    input?.enabled ??
    current?.numberingEnabled ??
    !DOC_TYPES_WITHOUT_NUMBER.includes(docType);

  // `undefined` = conservar el prefijo actual; `''` = quiero uno automático.
  const requested =
    input?.prefix === undefined ? (current?.numberingPrefix ?? '') : input.prefix;
  const normalized = normalizeNumberingPrefix(requested ?? '');

  if (normalized === '') {
    // Prefijo vacío: se conserva el código automático que ya tuviera la
    // plantilla o, si no tiene, se le asigna uno.
    const prefix = await generateAutoPrefix(
      templateId,
      current?.numberingPrefixAuto ? current?.numberingPrefix : null,
    );
    const series = await ensureNumberingSeries({
      prefix,
      startValue: input?.startValue ?? 1,
      padding: input?.padding ?? 4,
      includeYear: input?.includeYear ?? true,
      createdBy: user.sub,
    });
    return { enabled: true, prefix: series.prefix, auto: true, series };
  }

  const prefix = parseNumberingPrefix(normalized);
  const owner = await findSeriesOwner(prefix, templateId);
  if (owner) {
    const visible = canSeeOwner(owner, user);
    throw conflict(
      visible
        ? `El prefijo ${prefix} ya lo usa la plantilla «${owner.name}». Cada plantilla necesita su propio prefijo.`
        : `El prefijo ${prefix} ya lo usa otra plantilla. Cada plantilla necesita su propio prefijo.`,
      { prefix },
    );
  }

  const existing = await getNumberingSeries(prefix);
  if (!existing) {
    const series = await ensureNumberingSeries({
      prefix,
      startValue: input?.startValue ?? 1,
      padding: input?.padding ?? 4,
      includeYear: input?.includeYear ?? true,
      createdBy: user.sub,
    });
    return { enabled: true, prefix: series.prefix, auto: false, series };
  }

  if (
    input &&
    ((input.startValue !== undefined && input.startValue !== existing.startValue) ||
      (input.padding !== undefined && input.padding !== existing.padding) ||
      (input.includeYear !== undefined && input.includeYear !== existing.includeYear))
  ) {
    const updated = await updateNumberingSeries(
      prefix,
      {
        startValue: input.startValue,
        padding: input.padding,
        includeYear: input.includeYear,
      },
      user.sub,
    );
    return { enabled: true, prefix: updated.prefix, auto: false, series: updated };
  }

  return { enabled: true, prefix: existing.prefix, auto: false, series: existing };
}

/**
 * Comprueba que el usuario pueda ajustar la configuración de una serie.
 *
 * Cada serie pertenece a una plantilla: solo su propietario (o un
 * administrador) puede tocar sus ajustes.
 */
export async function assertCanEditSeries(
  prefix: string,
  user: NumberingUser,
): Promise<void> {
  const owner = await findSeriesOwner(prefix);
  if (!owner) return;
  if (owner.ownerId === user.sub || user.role === 'admin') return;
  throw forbidden('Esta numeración pertenece a otra plantilla');
}
