/**
 * Descripción breve generada a partir de los valores de las variables.
 *
 * Se usa como respaldo cuando el documento no tiene una descripción manual.
 * Es código puro para poder calcularla tanto en el servidor (listados) como en
 * la web (editor, mientras se editan los datos).
 */

import { DOC_TYPE_LABELS } from './types.js';
import type { DocType, VariableDef, VariableValues } from './types.js';

/** Variables que mejor identifican cada tipo de documento. */
const PRIORITY_KEYS: Record<DocType, string[]> = {
  memorandum: ['asunto', 'destinatario', 'remitente'],
  delivery_note: ['receptor', 'area', 'entregado_por'],
  report: ['titulo', 'area', 'autor'],
  meeting_minutes: ['lugar', 'responsable', 'hora'],
  evaluation_plan: ['titulo', 'curso', 'periodo'],
  resume: ['nombre', 'titulo', 'ciudad'],
  letter: ['asunto', 'destinatario', 'institucion'],
  certificate: ['evento', 'nombre', 'titulo'],
  blank: [],
};

/** Prioridad genérica para plantillas con claves propias. */
const GENERIC_PRIORITY = [
  'asunto',
  'titulo',
  'nombre',
  'evento',
  'curso',
  'receptor',
  'destinatario',
  'area',
  'lugar',
  'cargo',
  'concepto',
  'motivo',
];

/** Variables que no aportan a una descripción identificativa. */
const EXCLUDED_KEYS = new Set([
  'numero',
  'email',
  'correo',
  'telefono',
  'firma',
  'firmante',
  'cargo_firmante',
  'cargo_destinatario',
  'cargo_remitente',
  'cargo_receptor',
]);

const EXCLUDED_TYPES = new Set(['image', 'checkbox', 'table', 'longtext']);

const MAX_LENGTH = 160;

function normalizedKey(key: string): string {
  return key.toLowerCase();
}

function isExcludedKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (EXCLUDED_KEYS.has(normalized)) return true;
  return (
    normalized.startsWith('numero') ||
    normalized.includes('cedula') ||
    normalized.includes('dni') ||
    normalized.includes('pasaporte') ||
    normalized === 'ruc' ||
    normalized === 'nit' ||
    normalized.endsWith('_id')
  );
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function formatDate(value: unknown): string {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function formatValue(variable: VariableDef, value: unknown): string {
  const text = variable.type === 'date' ? formatDate(value) : textValue(value);
  if (!text) return '';
  return text.length > 50 ? `${text.slice(0, 47).trimEnd()}…` : text;
}

function truncate(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 3).trimEnd()}…` : text;
}

export interface AutoDescriptionInput {
  docType: DocType;
  schema: VariableDef[];
  data: VariableValues;
}

export function buildAutoDescription({ docType, schema, data }: AutoDescriptionInput): string {
  if (!data || typeof data !== 'object') return '';

  const byKey = new Map(schema.map((variable) => [normalizedKey(variable.key), variable]));
  const used = new Set<string>();
  const parts: string[] = [];

  function add(variable: VariableDef | undefined): void {
    if (!variable || used.has(variable.key)) return;
    if (EXCLUDED_TYPES.has(variable.type) || isExcludedKey(variable.key)) return;
    const text = formatValue(variable, data[variable.key]);
    if (!text) return;
    used.add(variable.key);
    parts.push(`${variable.label}: ${text}`);
  }

  // Primero las variables más representativas del tipo de documento.
  const priority = [...(PRIORITY_KEYS[docType] ?? []), ...GENERIC_PRIORITY];
  for (const key of priority) add(byKey.get(key));

  // Luego se completa con las siguientes variables cortas no vacías.
  for (const variable of schema) {
    if (parts.length >= 3) break;
    if (variable.type === 'date') continue;
    add(variable);
  }

  // Si no hay esquema (plantilla eliminada), se usan los primeros valores.
  if (parts.length === 0 && schema.length === 0) {
    for (const [key, value] of Object.entries(data)) {
      if (parts.length >= 3) break;
      if (isExcludedKey(key)) continue;
      if (Array.isArray(value) || (value !== null && typeof value === 'object')) continue;
      const text = textValue(value);
      if (text) parts.push(text);
    }
  }

  if (parts.length === 0) return '';

  const dateVariable = byKey.get('fecha');
  const date = dateVariable ? formatDate(data[dateVariable.key]) : '';
  const prefix = docType === 'blank' ? '' : (DOC_TYPE_LABELS[docType] ?? '');
  const body = prefix
    ? `${prefix} — ${parts.join(' · ')}`
    : parts.join(' · ');

  return truncate(date ? `${body} (${date})` : body);
}
