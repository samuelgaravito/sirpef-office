import { ref } from 'vue';

import { api } from '@/api/client';
import { errorMessage } from '@/lib/error-message';
import type { StatsDetailItem, StatsDetailKind, StatsDetailPage } from '@sirpefoffice/shared';

export interface StatsDetailRequest {
  kind: StatsDetailKind;
  /** uuid de la plantilla o `none`; solo para `kind = 'template'`. */
  templateId?: string | null;
  /** Límites ISO del filtro de fechas del panel. */
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Lista paginada del detalle de un valor del panel estadístico.
 *
 * La página se pide de 10 en 10 y se cancela la petición anterior si el
 * usuario cambia de página o cierra el modal antes de que responda.
 */
export function useStatsDetail() {
  const items = ref<StatsDetailItem[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = 10;
  const loading = ref(false);
  const error = ref<string | null>(null);

  let controller: AbortController | null = null;

  async function load(request: StatsDetailRequest, nextPage = 1): Promise<void> {
    controller?.abort();
    const current = new AbortController();
    controller = current;

    page.value = nextPage;
    loading.value = true;
    error.value = null;

    try {
      const data = await api.raw<StatsDetailPage>('/stats/detail', {
        query: {
          kind: request.kind,
          templateId: request.templateId ?? undefined,
          dateFrom: request.dateFrom || undefined,
          dateTo: request.dateTo || undefined,
          page: nextPage,
          pageSize,
        },
        signal: current.signal,
      });
      if (current.signal.aborted) return;
      items.value = data.items;
      total.value = data.total;
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      error.value = errorMessage(caught, 'No se pudo cargar el detalle');
      items.value = [];
      total.value = 0;
    } finally {
      if (!current.signal.aborted) loading.value = false;
    }
  }

  function cancel(): void {
    controller?.abort();
    controller = null;
    loading.value = false;
  }

  return { items, total, page, pageSize, loading, error, load, cancel };
}
