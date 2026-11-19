/**
 * Búsqueda de texto insensible a tildes.
 *
 * Postgres distingue «Jesús» de «Jesus» (ILIKE solo ignora mayúsculas), así que
 * las dos partes de la comparación se normalizan con `translate`. Lo comparten
 * el listado de documentos, el panel estadístico y el modo consulta para que
 * los tres encuentren lo mismo.
 */
import { sql } from 'drizzle-orm';
import type { SQLWrapper } from 'drizzle-orm';

/** Minúsculas y sin tildes, para comparar «Jesús» con «Jesus». */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Minúsculas, sin tildes y sin espacios sobrantes. */
export function normalizeText(value: string): string {
  return stripAccents(value).toLowerCase().trim();
}

/** Expresión SQL comparable sin tildes. */
export function accentless(expression: SQLWrapper): ReturnType<typeof sql> {
  return sql`translate(${expression}, ${'áéíóúüñÁÉÍÓÚÜÑ'}, ${'aeiouunAEIOUUN'})`;
}
