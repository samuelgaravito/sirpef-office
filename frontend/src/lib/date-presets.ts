/**
 * Atajos y etiquetas del filtro de fechas.
 *
 * Vive en un módulo propio porque lo comparten el listado de documentos y el
 * panel estadístico: así «Este mes» significa exactamente lo mismo en ambos y
 * no se duplica el cálculo del calendario local.
 */

export type DatePreset = 'today' | '7d' | 'month' | 'lastMonth' | 'year';

/** Atajos calculados en el calendario local, no en UTC. */
export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes anterior' },
  { value: 'year', label: 'Este año' },
];

/** Convierte una fecha local a `YYYY-MM-DD` (el valor de un `<input date>`). */
export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Día local → instante UTC de su inicio. */
export function startOfDayIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

/** Día local → instante UTC de su final. */
export function endOfDayIso(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

/** Rango local que cubre cada atajo, sin depender de la zona del servidor. */
export function presetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } {
  let from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let to = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === '7d') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  } else if (preset === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (preset === 'lastMonth') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (preset === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
  }

  return { from: toDateInput(from), to: toDateInput(to) };
}

/** ¿El rango actual coincide exactamente con este atajo? */
export function isPresetActive(
  preset: DatePreset,
  from: string,
  to: string,
  now: Date = new Date(),
): boolean {
  const range = presetRange(preset, now);
  return from === range.from && to === range.to;
}

/** Día local en formato `dd/mm/aaaa`, para las etiquetas del botón. */
export function formatDayLabel(value: string): string {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Texto del botón de filtro: «Fecha», «Fecha: 01/11/2026 – 30/11/2026»… */
export function dateFilterLabel(from: string, to: string, prefix = 'Fecha'): string {
  if (!from && !to) return prefix;
  if (from && to) {
    if (from === to) return `${prefix}: ${formatDayLabel(from)}`;
    return `${prefix}: ${formatDayLabel(from)} – ${formatDayLabel(to)}`;
  }
  return from ? `${prefix}: desde ${formatDayLabel(from)}` : `${prefix}: hasta ${formatDayLabel(to)}`;
}
