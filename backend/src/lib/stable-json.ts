import { createHash } from 'node:crypto';

/**
 * Serialización JSON determinista: ordena las claves de los objetos para que
 * dos valores equivalentes produzcan exactamente el mismo texto. La firma se
 * calcula sobre este texto, no sobre el JSON que devuelva la base de datos.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
