/** Valores que nunca pueden representar un ID de recurso válido. */
const INVALID_ROUTE_IDS = new Set(['', 'undefined', 'null', 'nan']);

/**
 * Devuelve un ID limpio o `null` si el parámetro de ruta no es utilizable.
 * Los IDs reales son UUID, así que los marcadores de texto se descartan.
 */
export function normalizeRouteId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && !INVALID_ROUTE_IDS.has(id.toLowerCase()) ? id : null;
}

/**
 * Canoniza una ruta: colapsa barras repetidas y elimina la barra final,
 * salvo en la raíz. Se usa antes de resolver la navegación para que
 * `/documents/`, `/documents//`, etc. terminen en la misma ruta.
 */
export function canonicalRoutePath(path: string): string {
  if (path === '/') return path;
  const collapsed = path.replace(/\/{2,}/g, '/');
  return collapsed.replace(/\/+$/, '') || '/';
}
