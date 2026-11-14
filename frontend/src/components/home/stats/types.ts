/** Fila de una lista de barras del panel estadístico. */
export interface StatsBarItem {
  key: string;
  label: string;
  count: number;
  color: string;
  /** Etiqueta corta opcional a la derecha del nombre (p. ej. «Compartida»). */
  badge?: string;
}
