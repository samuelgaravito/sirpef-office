import { ref } from 'vue';

import { api } from '@/api/client';
import { endOfDayIso, startOfDayIso } from '@/lib/date-presets';
import { errorMessage } from '@/lib/error-message';
import type { WorkspaceStats } from '@sirpefoffice/shared';

/**
 * Datos del panel estadístico del espacio.
 *
 * La carga es perezosa: solo se pide al abrir el modal. El filtro de fechas
 * viaja como día local convertido a ISO, igual que en el listado de documentos
 * (el servidor no adivina zonas horarias). Al cerrar se cancela la petición en
 * curso para no pintar datos de un panel que ya no se ve.
 */
export function useWorkspaceStats() {
  const stats = ref<WorkspaceStats | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const dateFrom = ref('');
  const dateTo = ref('');

  /** Filtro con el que se cargaron los datos actuales (para no repetir). */
  let loadedKey: string | null = null;
  let controller: AbortController | null = null;

  async function load(force = false): Promise<void> {
    // Un rango invertido no se consulta: el panel ya explica qué corregir.
    if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) return;

    const key = `${dateFrom.value}|${dateTo.value}`;
    if (!force && loadedKey === key && stats.value) return;

    controller?.abort();
    const current = new AbortController();
    controller = current;

    loading.value = true;
    error.value = null;

    try {
      const data = await api.raw<WorkspaceStats>('/stats/overview', {
        query: {
          dateFrom: dateFrom.value ? startOfDayIso(dateFrom.value) : undefined,
          dateTo: dateTo.value ? endOfDayIso(dateTo.value) : undefined,
        },
        signal: current.signal,
      });
      if (current.signal.aborted) return;
      stats.value = data;
      loadedKey = key;
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      error.value = errorMessage(caught, 'No se pudieron cargar las estadísticas del espacio');
    } finally {
      if (!current.signal.aborted) loading.value = false;
    }
  }

  function clearDates(): void {
    dateFrom.value = '';
    dateTo.value = '';
    void load();
  }

  /** Cancela la petición en curso al cerrar el panel. */
  function cancel(): void {
    controller?.abort();
    controller = null;
    loading.value = false;
  }

  return { stats, loading, error, dateFrom, dateTo, load, clearDates, cancel };
}
