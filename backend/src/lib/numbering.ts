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
import { badRequest, forbidden, internal, notFound } from './errors.js';

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

/** Plantilla que usa una serie. */
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
 * El prefijo es solo la etiqueta visible del número: **no tiene que ser
 * único**. Cada plantilla tiene su propia enumeración, así que dos plantillas
 * pueden usar el mismo prefijo sin compartir contador.
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

/** Devuelve la serie con ese identificador o null si no existe. */
export async function getNumberingSeries(id: string): Promise<NumberingSeriesRow | null> {
  const [row] = await db
    .select()
    .from(numberingSeries)
    .where(eq(numberingSeries.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Serie de una plantilla.
 *
 * Cada plantilla tiene **su propia** enumeración: la serie que enlaza con
 * `templates.numbering_series_id`. Nunca se comparte con otra plantilla.
 */
export async function getTemplateSeries(templateId: string): Promise<NumberingSeriesRow | null> {
  const [row] = await db
    .select({ series: numberingSeries })
    .from(templates)
    .innerJoin(numberingSeries, eq(templates.numberingSeriesId, numberingSeries.id))
    .where(eq(templates.id, templateId))
    .limit(1);
  return row?.series ?? null;
}

/** Plantilla que usa la serie (si la hay). */
export async function findSeriesOwner(seriesId: string): Promise<SeriesOwner | null> {
  const [row] = await db
    .select({
      id: templates.id,
      name: templates.name,
      ownerId: templates.ownerId,
      isShared: templates.isShared,
      isActive: templates.isActive,
    })
    .from(templates)
    .where(eq(templates.numberingSeriesId, seriesId))
    .limit(1);
  return row ?? null;
}

/**
 * Plantillas vivas que usan un prefijo.
 *
 * No es un conflicto: cada una lleva su propia enumeración. Solo se usa para
 * avisar en la interfaz de que la etiqueta está repetida.
 */
export async function templatesUsingPrefix(
  prefix: string,
  excludeTemplateId?: string,
): Promise<Array<{ id: string; name: string }>> {
  if (prefix === '') return [];
  return db
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(
      and(
        eq(templates.numberingPrefix, prefix),
        isNull(templates.deletedAt),
        excludeTemplateId ? ne(templates.id, excludeTemplateId) : undefined,
      ),
    );
}

/** ¿Alguna plantilla viva usa ya ese prefijo? */
export async function prefixInUse(prefix: string, excludeTemplateId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.numberingPrefix, prefix),
        isNull(templates.deletedAt),
        excludeTemplateId ? ne(templates.id, excludeTemplateId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Código corto y único para una plantilla sin prefijo propio.
 *
 * Se deriva del identificador de la plantilla (estable aunque se renombre) y
 * se alarga si el resultado ya lo usa otra plantilla.
 */
export async function generateAutoPrefix(templateId: string): Promise<string> {
  for (let length = NUMBERING_AUTO_PREFIX_LENGTH; length <= NUMBERING_MAX_PREFIX_LENGTH; length += 1) {
    const candidate = autoNumberingPrefix(templateId, length);
    if (!(await prefixInUse(candidate, templateId))) return candidate;
  }
  throw badRequest('No se pudo asignar un prefijo automático. Escribe un prefijo propio.');
}

/**
 * Crea la serie de una plantilla si no tiene una y la enlaza con ella.
 *
 * Si la plantilla ya tiene serie, se respeta su configuración: solo se
 * actualiza el prefijo (que es la etiqueta) y los ajustes que se hayan
 * pedido. El contador **no** se reinicia: la enumeración sigue donde estaba.
 */
export async function ensureTemplateSeries(
  options: {
    templateId: string;
    prefix: string;
    startValue?: number | undefined;
    padding?: number | undefined;
    includeYear?: boolean | undefined;
    createdBy?: string | null | undefined;
  },
): Promise<NumberingSeriesRow> {
  const prefix = parseNumberingPrefix(options.prefix);
  const existing = await getTemplateSeries(options.templateId);

  if (existing) {
    const startValue = options.startValue ?? existing.startValue;
    const padding = options.padding ?? existing.padding;
    const includeYear = options.includeYear ?? existing.includeYear;

    const configChanged =
      startValue !== existing.startValue ||
      padding !== existing.padding ||
      includeYear !== existing.includeYear;

    if (configChanged) {
      // Los ajustes del contador se validan aparte (el número inicial no
      // puede bajar del último emitido).
      return updateNumberingSeries(
        existing.id,
        { startValue, padding, includeYear },
        options.createdBy ?? existing.updatedBy,
      );
    }

    if (prefix !== existing.prefix) {
      // Solo cambia la etiqueta: la enumeración sigue intacta.
      const [renamed] = await db
        .update(numberingSeries)
        .set({
          prefix,
          updatedBy: options.createdBy ?? existing.updatedBy,
          updatedAt: new Date(),
        })
        .where(eq(numberingSeries.id, existing.id))
        .returning();
      if (!renamed) {
        throw internal('NUMBERING_SERIES_UPDATE_FAILED', 'No se pudo actualizar la serie de numeración');
      }
      return renamed;
    }

    return existing;
  }

  assertRange('El número inicial', options.startValue ?? 1, 1, NUMBERING_MAX_START);
  assertRange('El relleno', options.padding ?? 4, 1, NUMBERING_MAX_PADDING);

  const [created] = await db
    .insert(numberingSeries)
    .values({
      prefix,
      startValue: options.startValue ?? 1,
      padding: options.padding ?? 4,
      includeYear: options.includeYear ?? true,
      createdBy: options.createdBy ?? null,
      updatedBy: options.createdBy ?? null,
    })
    .returning();

  if (!created) {
    throw internal('NUMBERING_SERIES_CREATE_FAILED', 'No se pudo crear la serie de numeración');
  }

  // La serie se enlaza con la plantilla solo si sigue sin serie: dos
  // peticiones simultáneas no pueden dejarle dos enumeraciones.
  const [linked] = await db
    .update(templates)
    .set({ numberingSeriesId: created.id, updatedAt: new Date() })
    .where(and(eq(templates.id, options.templateId), isNull(templates.numberingSeriesId)))
    .returning({ id: templates.id });

  if (!linked) {
    // La plantilla puede todavía no existir (una plantilla nueva resuelve su
    // serie antes de insertarse: el enlace se hace al insertarla).
    const [template] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, options.templateId))
      .limit(1);
    if (!template) return created;

    // Otra petición enlazó antes su propia serie: se usa esa y se retira la
    // que se acaba de crear, para no dejar series huérfanas.
    await db.delete(numberingSeries).where(eq(numberingSeries.id, created.id));
    const current = await getTemplateSeries(options.templateId);
    if (current) return current;
    throw internal('NUMBERING_SERIES_CREATE_FAILED', 'No se pudo crear la serie de numeración');
  }

  return created;
}

/** Último número emitido por la serie en el período vigente (0 si aún no hay). */
export async function lastIssuedNumber(seriesId: string, includeYear: boolean): Promise<number> {
  const year = numberingPeriodYear(includeYear);
  const [row] = await db
    .select({ counter: documentCounters.counter })
    .from(documentCounters)
    .where(and(eq(documentCounters.seriesId, seriesId), eq(documentCounters.year, year)))
    .limit(1);
  return row?.counter ?? 0;
}

/** El usuario puede ver los datos de una plantilla ajena si está compartida. */
function canSeeOwner(owner: SeriesOwner, user: NumberingUser): boolean {
  if (owner.ownerId === user.sub) return true;
  if (!owner.isShared) return false;
  return user.role === 'admin' || owner.isActive;
}

function toState(
  series: NumberingSeriesRow,
  lastIssued: number,
  owner: SeriesOwner | null,
  user: NumberingUser | null,
  prefixShared: boolean,
): NumberingSeriesState {
  const nextValue = nextNumberValue(series, lastIssued);
  const visible = owner && user ? canSeeOwner(owner, user) : Boolean(owner);
  return {
    id: series.id,
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
    templateId: visible ? (owner?.id ?? null) : null,
    templateName: visible ? (owner?.name ?? null) : null,
    prefixShared,
  };
}

/** Estado de una serie concreta (incluye el próximo número). */
export async function getNumberingState(
  seriesId: string,
  user?: NumberingUser,
): Promise<NumberingSeriesState | null> {
  const series = await getNumberingSeries(seriesId);
  if (!series) return null;

  const lastIssued = await lastIssuedNumber(series.id, series.includeYear);
  const owner = await findSeriesOwner(series.id);
  const shared = await prefixInUse(series.prefix, owner?.id);
  return toState(series, lastIssued, owner, user ?? null, shared);
}

/** Todas las series ordenadas por prefijo. */
export async function listNumberingStates(user?: NumberingUser): Promise<NumberingSeriesState[]> {
  const series = await db.select().from(numberingSeries).orderBy(asc(numberingSeries.prefix));
  if (series.length === 0) return [];

  const counters = await db.select().from(documentCounters);
  const counterByKey = new Map<string, number>();
  for (const row of counters) counterByKey.set(`${row.seriesId}:${row.year}`, row.counter);

  // Una sola consulta para saber qué plantilla usa cada serie.
  const owners = await db
    .select({
      id: templates.id,
      name: templates.name,
      ownerId: templates.ownerId,
      isShared: templates.isShared,
      isActive: templates.isActive,
      seriesId: templates.numberingSeriesId,
    })
    .from(templates)
    .where(and(isNull(templates.deletedAt), isNotNull(templates.numberingSeriesId)));
  const ownerBySeries = new Map<string, SeriesOwner>();
  for (const row of owners) {
    if (!row.seriesId) continue;
    ownerBySeries.set(row.seriesId, {
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      isShared: row.isShared,
      isActive: row.isActive,
    });
  }

  // Prefijos repetidos: cada serie conserva su enumeración.
  const prefixCount = new Map<string, number>();
  for (const row of series) {
    prefixCount.set(row.prefix, (prefixCount.get(row.prefix) ?? 0) + 1);
  }

  return series.map((row) => {
    const year = numberingPeriodYear(row.includeYear);
    const lastIssued = counterByKey.get(`${row.id}:${year}`) ?? 0;
    const owner = ownerBySeries.get(row.id) ?? null;
    return toState(row, lastIssued, owner, user ?? null, (prefixCount.get(row.prefix) ?? 0) > 1);
  });
}

/**
 * Actualiza la configuración de una serie. El número inicial no puede
 * retroceder por debajo de lo ya emitido; si se sube, el próximo documento
 * usará exactamente ese valor.
 */
export async function updateNumberingSeries(
  seriesId: string,
  patch: NumberingSeriesPatch,
  userId: string | null,
): Promise<NumberingSeriesRow> {
  const series = await getNumberingSeries(seriesId);
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
      .where(eq(documentCounters.seriesId, seriesId))
      .orderBy(sql`${documentCounters.counter} desc`)
      .limit(1);
    if ((anyCounter?.counter ?? 0) > 0) {
      throw badRequest(
        'No se puede cambiar el uso del año: la serie ya tiene documentos emitidos. Crea un prefijo nuevo para empezar otra numeración.',
      );
    }
  }

  if (startValue !== series.startValue) {
    const lastIssued = await lastIssuedNumber(seriesId, includeYear);
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
      .values({ seriesId, year, counter: startValue - 1 })
      .onConflictDoUpdate({
        target: [documentCounters.seriesId, documentCounters.year],
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
    .where(eq(numberingSeries.id, seriesId))
    .returning();

  if (!updated) {
    throw internal('NUMBERING_SERIES_UPDATE_FAILED', 'No se pudo actualizar la serie de numeración');
  }
  return updated;
}

/**
 * Suelo real de cada serie: el mayor correlativo que ocupan los documentos
 * vivos de esa serie y año.
 *
 * Evita previsualizar un número ya ocupado aunque el contador esté
 * desfasado (por ejemplo tras una restauración de la base de datos). Cada
 * serie cuenta solo con sus propios documentos: dos series que compartan
 * prefijo no se pisan.
 */
export async function liveNumberingFloors(seriesIds: string[]): Promise<Map<string, number>> {
  const floors = new Map<string, number>();
  if (seriesIds.length === 0) return floors;

  const rows = await db
    .select({
      seriesId: documents.numberingSeriesId,
      year: documents.numberingYear,
      value: documents.numberingValue,
    })
    .from(documents)
    .where(
      and(
        inArray(documents.numberingSeriesId, seriesIds),
        isNull(documents.deletedAt),
        isNotNull(documents.numberingValue),
      ),
    );

  for (const row of rows) {
    if (!row.seriesId || row.value === null || row.year === null) continue;
    const key = `${row.seriesId}:${row.year}`;
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

  // Suelo real: el mayor correlativo que ocupan los documentos vivos de esta
  // serie. Si el contador quedó desfasado (por una restauración o un ajuste
  // manual), el número reservado nunca pisa uno ya emitido.
  const floor = await liveNumberingFloors([series.id]);
  const realFloor = floor.get(`${series.id}:${year}`) ?? 0;

  const [row] = await exec
    .insert(documentCounters)
    .values({ seriesId: series.id, year, counter: series.startValue })
    .onConflictDoUpdate({
      target: [documentCounters.seriesId, documentCounters.year],
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
      numberingSeriesId: series.id,
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
 * - Con un prefijo explícito se valida el formato. El prefijo **puede
 *   repetirse**: cada plantilla lleva su propia serie, así que sus números no
 *   se intercalan con los de otra aunque compartan etiqueta.
 * - Sin prefijo se asigna un código corto único derivado del identificador.
 * - Con la numeración apagada la plantilla no lleva número, pero conserva su
 *   serie (y su contador) para recuperarlo al volver a encenderla.
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

  const existing = await getTemplateSeries(templateId);

  // `undefined` = conservar el prefijo actual; `''` = quiero uno automático.
  const requested = input?.prefix;
  const normalized =
    requested === undefined
      ? normalizeNumberingPrefix(current?.numberingPrefix ?? '')
      : normalizeNumberingPrefix(requested ?? '');

  let prefix: string;
  let auto: boolean;

  if (normalized === '') {
    // Se conserva el código automático propio si ya lo tenía; si no, se le
    // asigna uno.
    const keepAuto = Boolean(existing) && Boolean(current?.numberingPrefixAuto);
    prefix = keepAuto && existing ? existing.prefix : await generateAutoPrefix(templateId);
    auto = true;
  } else {
    prefix = normalized;
    // Si el cliente no toca el prefijo, se conserva su carácter automático.
    auto = requested === undefined ? (current?.numberingPrefixAuto ?? false) : false;
  }

  if (!enabled) {
    // La numeración está apagada: la plantilla no lleva número, pero su serie
    // se conserva para recuperar la enumeración al volver a encenderla.
    if (existing) {
      const series =
        existing.prefix === prefix
          ? existing
          : await ensureTemplateSeries({ templateId, prefix, createdBy: user.sub });
      return { enabled: false, prefix: series.prefix, auto, series };
    }
    return { enabled: false, prefix: prefix === '' ? null : prefix, auto, series: null };
  }

  const series = await ensureTemplateSeries({
    templateId,
    prefix,
    startValue: input?.startValue,
    padding: input?.padding,
    includeYear: input?.includeYear,
    createdBy: user.sub,
  });

  return { enabled: true, prefix: series.prefix, auto, series };
}

/**
 * Comprueba que el usuario pueda ajustar la configuración de una serie.
 *
 * Cada serie pertenece a una plantilla: solo su propietario (o un
 * administrador) puede tocar sus ajustes.
 */
export async function assertCanEditSeries(
  seriesId: string,
  user: NumberingUser,
): Promise<void> {
  const owner = await findSeriesOwner(seriesId);
  if (!owner) return;
  if (owner.ownerId === user.sub || user.role === 'admin') return;
  throw forbidden('Esta numeración pertenece a otra plantilla');
}
