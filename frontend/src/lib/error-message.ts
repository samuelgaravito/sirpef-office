import { ApiError } from '@/api/client';

/**
 * Traducción de errores a avisos comprensibles.
 *
 * Distingue dos familias muy distintas:
 *
 * - **4xx**: el usuario puede corregirlo (validación, conflicto, permiso).
 *   Se muestra como aviso, no como error, para no alarmar por algo que se
 *   resuelve solo reintentando con otros datos.
 * - **5xx y fallos de red**: el problema es del servidor. Se muestra como
 *   error y, si el servidor envió una referencia, se añade para que soporte
 *   pueda rastrearlo en los logs.
 */

/** Severidad con la que se presenta un aviso. */
export type ErrorTone = 'error' | 'warning';

/** Aviso listo para mostrar. */
export interface ErrorNotice {
  tone: ErrorTone;
  message: string;
  /** Referencia de rastreo, si el servidor la envió (solo 5xx). */
  reference?: string;
}

/** Errores que el usuario puede corregir sin ayuda del soporte. */
const RECOVERABLE_CODES = new Set([
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'CONFLICT',
  'DOCUMENT_LOCKED',
  'VERSION_CONFLICT',
  'DOC_NUMBER_CONFLICT',
  'EMAIL_TAKEN',
  'SVA_USER_TAKEN',
  'DESIGN_ALREADY_CURRENT',
  'SEND_ALREADY_PENDING',
  'DUPLICATE_RECORD',
  'REFERENCED_RECORD_MISSING',
  'INVALID_IDENTIFIER',
  'CONSTRAINT_VIOLATION',
  'MISSING_REQUIRED_FIELD',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'AI_NOT_CONFIGURED',
  'AI_NO_SCHEMA',
  'EXPORT_FORBIDDEN',
]);

/** Detalle de los fallos de validación que devuelve el servidor. */
interface ValidationDetail {
  path?: string;
  message?: string;
}

/**
 * Explica un error de validación: el mensaje del servidor ya nombra los
 * campos, pero algunos endpoints devuelven el detalle estructurado y
 * conviene aprovecharlo.
 */
function describeValidation(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const fields = details
    .map((detail) => {
      const item = detail as ValidationDetail;
      if (!item?.message) return null;
      return item.path ? `${item.path} (${item.message})` : item.message;
    })
    .filter((value): value is string => Boolean(value));
  if (fields.length === 0) return null;
  return `Datos inválidos: ${fields.slice(0, 3).join(', ')}.`;
}

/**
 * Convierte cualquier error en un aviso con su tono y su mensaje.
 *
 * @param error Lo que se capturó en el `catch`.
 * @param fallback Mensaje propio del sitio, usado si nada mejor se sabe.
 */
export function describeError(error: unknown, fallback: string): ErrorNotice {
  if (error instanceof ApiError) {
    // Fallo de red o respuesta no JSON: siempre es un error del servidor.
    if (error.status === 0 || error.status >= 500) {
      return {
        tone: 'error',
        message: error.message,
        ...(error.reference ? { reference: error.reference } : {}),
      };
    }

    const validation = describeValidation(error.details);
    if (validation) return { tone: 'warning', message: validation };

    return {
      tone: RECOVERABLE_CODES.has(error.code) ? 'warning' : 'error',
      message: error.message,
    };
  }

  if (error instanceof Error && error.message) {
    return { tone: 'error', message: error.message };
  }

  return { tone: 'error', message: fallback };
}

/** Mensaje del aviso, listo para enseñar. */
export function errorMessage(error: unknown, fallback: string): string {
  return describeError(error, fallback).message;
}
