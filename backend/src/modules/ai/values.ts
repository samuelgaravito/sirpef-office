import type { VariableDef } from '@sirpefoffice/shared';

import { AppError } from '../../lib/errors.js';

/* ─────────────────────────── Utilidades comunes ─────────────────────────── */

export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Describe una variable para el prompt del modelo. */
export function describeVariable(variable: VariableDef): string {
  const parts = [`"${variable.key}"`, `(${variable.type}${variable.required ? ', obligatorio' : ''})`];
  parts.push(`Etiqueta: ${variable.label}.`);
  if (variable.description) parts.push(`Descripción: ${variable.description}.`);
  if (variable.aiHint) parts.push(`Indicación: ${variable.aiHint}.`);
  if (variable.options?.length) {
    parts.push(`Valores permitidos: ${variable.options.map((option) => option.value).join(', ')}.`);
  }
  if (variable.type === 'table') {
    const columns = (variable.columns ?? []).map((column) => `${column.key} (${column.label})`).join(', ');
    parts.push(
      `Devuelve un array de objetos; cada objeto debe tener exactamente estas claves: ${columns}.`,
    );
  }
  return `- ${parts.join(' ')}`;
}

/**
 * Extrae el objeto JSON de una respuesta del modelo.
 *
 * Algunos proveedores añaden vallas de Markdown o texto alrededor aunque se
 * pida `json_mode`; se recorta desde la primera `{` hasta la última `}`.
 */
export function extractJsonObject(raw: string, failCode = 'AI_INVALID_JSON'): Record<string, unknown> {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AppError(502, failCode, 'La IA no devolvió un objeto JSON válido');
  }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('no es un objeto');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AppError(502, failCode, 'La IA devolvió un JSON que no se pudo interpretar');
  }
}

/** Convierte el valor que devuelve el modelo al tipo declarado por la variable. */
export function coerce(variable: VariableDef, value: unknown): unknown {
  switch (variable.type) {
    case 'number':
    case 'money': {
      const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
      return Number.isFinite(numeric) ? numeric : 0;
    }
    case 'checkbox':
      return (
        value === true ||
        value === 1 ||
        value === '1' ||
        value === 'true' ||
        value === 'sí' ||
        value === 'si'
      );
    case 'multiselect':
      return Array.isArray(value) ? value.map(String) : String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    case 'table': {
      if (!Array.isArray(value)) return [];
      const keys = (variable.columns ?? []).map((column) => column.key);
      return value
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map((row) => {
          const clean: Record<string, unknown> = {};
          for (const key of keys) clean[key] = row[key] ?? '';
          return clean;
        });
    }
    case 'date': {
      const text = String(value ?? '').trim();
      const iso = /^\d{4}-\d{2}-\d{2}/.exec(text);
      return iso ? iso[0] : text;
    }
    default:
      return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  }
}
