import { ref } from 'vue';

import { api } from '@/api/client';
import { errorMessage } from '@/lib/error-message';
import type { StatsDetailItem, StatsDetailPage } from '@sirpefoffice/shared';

/** Página de la lista de detalle que se abre al pulsar una cifra. */
export function useStatsDetail() {
  const items = ref<StatsDetailItem[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = 10;
  const loading = ref(false);
  const error = ref<string | null>(null);

  let controller: AbortController | null = null;
  let lastQuery: Record<string, string | number | undefined> = {};

  async function load(query: Record<string, string | number | undefined>): Promise<void> {
    lastQuery = query;
    controller?.abort();
    const current = new AbortController();
    controller = current;

    loading.value = true;
    error.value = null;

    try {
      const data = await api.raw<StatsDetailPage>('/stats/detail', {
        query: { ...query, page: page.value, pageSize },
        signal: current.signal,
      });
      if (current.signal.aborted) return;
      items.value = data.items;
      total.value = data.total;
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      error.value = errorMessage(caught, 'No se pudo cargar el detalle');
    } finally {
      if (!current.signal.aborted) loading.value = false;
    }
  }

  /** Primera página de una consulta nueva. */
  async function open(query: Record<string, string | number | undefined>): Promise<void> {
    page.value = 1;
    items.value = [];
    total.value = 0;
    await load(query);
  }

  async function goTo(next: number): Promise<void> {
    page.value = next;
    await load(lastQuery);
  }

  function cancel(): void {
    controller?.abort();
    controller = null;
    loading.value = false;
  }

  return { items, total, page, pageSize, loading, error, open, goTo, cancel };
}
