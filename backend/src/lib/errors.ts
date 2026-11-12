import { randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { compactZodIssues, summarizeZodIssues } from './validation.js';

/** Error de aplicación con código HTTP y código interno estable. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'No autenticado') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'No tienes permiso para esta acción') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Recurso no encontrado') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

/** El documento ya fue aprobado/enviado y su contenido es inmutable. */
export const locked = (message = 'Este documento fue aprobado y enviado; ya no se puede editar') =>
  new AppError(409, 'DOCUMENT_LOCKED', message);

/**
 * Error interno con explicación útil.
 *
 * Los fallos internos (`throw new Error(...)` en las rutas) antes llegaban al
 * usuario como un 500 "Error interno del servidor", que no explicaba nada.
 * Este envoltorio conserva el mensaje real y le añade el código estable.
 */
export const internal = (code: string, message: string, details?: unknown) =>
  new AppError(500, code, message, details);

/** Error de una dependencia externa (SVA, proveedor de IA, Chrome). */
export const unavailable = (code: string, message: string, details?: unknown) =>
  new AppError(503, code, message, details);

/* ────────────────────── Errores conocidos → mensajes ────────────────────── */

/** Un error de PostgreSQL: lleva el código SQLSTATE y el nombre de la regla. */
interface PgError extends Error {
  code?: string;
  constraint_name?: string;
  table_name?: string;
  detail?: string;
}

/**
 * Saca el error real de PostgreSQL del envoltorio de Drizzle.
 *
 * Drizzle envuelve el fallo de la consulta en un `DrizzleQueryError` y deja
 * el error original (con su código SQLSTATE) en `cause`. Sin desenvolverlo,
 * la violación de unicidad llegaría al handler como un error genérico.
 */
function unwrapPostgres(error: Error): PgError {
  const cause = (error as { cause?: PgError }).cause;
  if (cause && typeof cause === 'object' && 'code' in cause) return cause;
  return error as PgError;
}

/**
 * Conflicto de unicidad en PostgreSQL (`23505`).
 *
 * La base de datos declara único el correlativo `documents.doc_number`, así
 * que un choque significa que ese número ya lo ocupa otro documento. Se
 * traduce a un 409 con un mensaje accionable en lugar de dejar que estalle
 * como un 500 genérico.
 */
function fromUniqueViolation(error: PgError): AppError | null {
  const constraint = error.constraint_name ?? '';

  switch (constraint) {
    case 'documents_doc_number_idx':
    case 'documents_doc_number_series_idx':
      return new AppError(
        409,
        'DOC_NUMBER_CONFLICT',
        'Ese número de documento ya está en uso por otro documento de la misma serie. Vuelve a intentarlo: se asignará el siguiente correlativo libre.',
      );
    case 'users_email_lower_idx':
      return new AppError(409, 'EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.');
    case 'users_sva_uuid_idx':
      return new AppError(
        409,
        'SVA_USER_TAKEN',
        'Ese usuario de SVA ya está registrado en el sistema.',
      );
    case 'designs_current_unique_idx':
      return new AppError(
        409,
        'DESIGN_ALREADY_CURRENT',
        'Ya tienes otro diseño marcado como «en uso». Quita ese distintivo antes de activar este.',
      );
    case 'document_messages_pending_unique_idx':
      return new AppError(
        409,
        'SEND_ALREADY_PENDING',
        'Este documento ya tiene una solicitud de aprobación pendiente.',
      );
    case 'template_versions_unique_idx':
    case 'document_versions_unique_idx':
      return new AppError(
        409,
        'VERSION_CONFLICT',
        'Esa versión ya existe. Vuelve a cargar para ver el historial actualizado.',
      );
    default:
      return new AppError(
        409,
        'DUPLICATE_RECORD',
        'Ya existe un registro con esos datos.',
      );
  }
}

/**
 * Traduce los errores de PostgreSQL a mensajes que el usuario entiende.
 *
 * Devuelve `null` cuando el error no es de la base de datos o su código no
 * tiene traducción propia: en ese caso sigue el curso normal.
 */
function fromPostgres(error: PgError): AppError | null {
  switch (error.code) {
    case '23505':
      return fromUniqueViolation(error);
    case '23503':
      return new AppError(
        409,
        'REFERENCED_RECORD_MISSING',
        'La operación apunta a un registro que ya no existe. Recarga la página e inténtalo de nuevo.',
      );
    case '23502':
      return new AppError(
        400,
        'MISSING_REQUIRED_FIELD',
        'Falta un dato obligatorio en la base de datos. Inténtalo de nuevo; si persiste, avisa al soporte.',
      );
    case '23514':
      return new AppError(
        400,
        'CONSTRAINT_VIOLATION',
        'Los datos no cumplen una regla del sistema. Revisa los valores e inténtalo de nuevo.',
      );
    case '22P02':
      return new AppError(
        400,
        'INVALID_IDENTIFIER',
        'Alguno de los identificadores enviados no tiene un formato válido.',
      );
    case '40001':
    case '40P01':
      return new AppError(
        409,
        'CONCURRENT_WRITE',
        'Dos operaciones se cruzaron en la base de datos. Vuelve a intentarlo.',
      );
    case '08000':
    case '08003':
    case '08006':
    case '08001':
    case '08004':
    case '57P01':
      return unavailable(
        'DATABASE_UNAVAILABLE',
        'No se pudo conectar con la base de datos. Espera unos segundos e inténtalo de nuevo.',
      );
    default:
      return null;
  }
}

/** Traduce los errores de Fastify (límites, content-type, validación). */
function fromFastify(error: Error & { statusCode?: number; code?: string }): AppError | null {
  switch (error.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new AppError(
        413,
        'PAYLOAD_TOO_LARGE',
        'El contenido enviado supera el límite de 25 MB. Reduce el tamaño de las imágenes e inténtalo de nuevo.',
      );
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'La petición debe enviarse con contenido JSON.',
      );
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return new AppError(400, 'EMPTY_BODY', 'La petición llegó vacía. Inténtalo de nuevo.');
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return new AppError(
        400,
        'INVALID_JSON',
        'La petición tiene un formato JSON inválido. Inténtalo de nuevo.',
      );
    case 'FST_ERR_VALIDATION':
      return new AppError(400, 'VALIDATION_ERROR', 'Datos inválidos.');
    case 'FST_ERR_RATE_LIMIT':
      return new AppError(
        429,
        'RATE_LIMITED',
        'Has hecho demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.',
      );
    default:
      return null;
  }
}

/**
 * Traduce el error del *rate limit* de `@fastify/rate-limit`.
 *
 * El plugin lanza un `Error` normal con estado 429 y un mensaje en inglés
 * ("Rate limit exceeded, retry in 60") que no tiene código propio, así que
 * hay que reconocerlo por su texto.
 */
function fromRateLimit(error: Error & { statusCode?: number }): AppError | null {
  if (error.statusCode !== 429) return null;
  const seconds = /retry in (\d+)/.exec(error.message)?.[1];
  return new AppError(
    429,
    'RATE_LIMITED',
    seconds
      ? `Has hecho demasiadas peticiones seguidas. Espera ${seconds} segundos e inténtalo de nuevo.`
      : 'Has hecho demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.',
  );
}

/** Traduce un fallo de red al hablar con un servicio externo. */
function fromNetwork(error: Error): AppError | null {
  const cause = (error as { cause?: { code?: string } }).cause?.code;
  if (cause === 'ECONNREFUSED' || cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') {
    return unavailable(
      'SERVICE_UNREACHABLE',
      'No se pudo contactar con un servicio externo. Comprueba tu conexión e inténtalo de nuevo.',
    );
  }
  if (cause === 'ECONNRESET' || cause === 'EPIPE') {
    return unavailable(
      'SERVICE_INTERRUPTED',
      'La conexión con un servicio externo se interrumpió. Inténtalo de nuevo.',
    );
  }
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return unavailable(
      'SERVICE_TIMEOUT',
      'Un servicio externo tardó demasiado en responder. Inténtalo de nuevo.',
    );
  }
  return null;
}

/* ────────────────────────────── Respuestas ─────────────────────────────── */

interface ErrorBody {
  error: string;
  message: string;
  details?: unknown;
  /** Referencia corta para rastrear el fallo en los logs del servidor. */
  reference?: string;
}

/**
 * Referencia corta y única por fallo del servidor.
 *
 * Aparece en la respuesta 5xx y en el log correspondiente, así que soporte
 * puede encontrar la traza exacta sin exponer detalles internos.
 */
function newReference(): string {
  return randomBytes(4).toString('hex');
}

function send(reply: FastifyReply, statusCode: number, body: ErrorBody): void {
  reply.status(statusCode).send(body);
}

/** Handler global de errores para Fastify. */
export function errorHandler(
  error: Error & { statusCode?: number; code?: string; constraint_name?: string },
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    send(reply, error.statusCode, {
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof ZodError) {
    send(reply, 400, {
      error: 'VALIDATION_ERROR',
      message: summarizeZodIssues(error),
      details: compactZodIssues(error),
    });
    return;
  }

  // Violación de unicidad y demás errores de PostgreSQL. Drizzle los envuelve
  // en un error con `cause`, así que se desenvuelve antes de traducirlos.
  const fromDb = fromPostgres(unwrapPostgres(error));
  if (fromDb) {
    send(reply, fromDb.statusCode, {
      error: fromDb.code,
      message: fromDb.message,
      ...(fromDb.details ? { details: fromDb.details } : {}),
    });
    return;
  }

  // Errores de Fastify: límites de cuerpo, content-type, validación de esquema.
  const fromFramework = fromFastify(error);
  if (fromFramework) {
    send(reply, fromFramework.statusCode, {
      error: fromFramework.code,
      message: fromFramework.message,
      ...(fromFramework.details ? { details: fromFramework.details } : {}),
    });
    return;
  }

  // Errores de Fastify con estado 4xx que no tienen código propio.
  if (error.statusCode && error.statusCode < 500) {
    const limited = fromRateLimit(error);
    if (limited) {
      send(reply, limited.statusCode, { error: limited.code, message: limited.message });
      return;
    }
    send(reply, error.statusCode, {
      error: error.code ?? 'REQUEST_ERROR',
      message: error.message,
    });
    return;
  }

  // Fallos de red al hablar con SVA, el proveedor de IA o el navegador.
  const fromNet = fromNetwork(error);
  if (fromNet) {
    request.log.warn({ err: error }, 'Fallo de comunicación con un servicio externo');
    send(reply, fromNet.statusCode, {
      error: fromNet.code,
      message: fromNet.message,
      ...(fromNet.details ? { details: fromNet.details } : {}),
    });
    return;
  }

  // Cualquier otra cosa es un fallo real del servidor. El detalle técnico se
  // queda en el log; la respuesta explica qué pasó y da una referencia.
  const reference = newReference();
  request.log.error({ err: error, reference }, 'Error no controlado');
  send(reply, 500, {
    error: 'INTERNAL_ERROR',
    message: `Ocurrió un fallo al procesar la solicitud. Si el problema continúa, communícalo con la referencia ${reference}.`,
    reference,
  });
}
