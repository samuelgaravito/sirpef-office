import { computed, ref } from 'vue';

import { api } from '@/api/client';

export interface InboxLatestResult {
  status: 'sent' | 'rejected';
  subject: string;
  approverName: string;
}

export interface InboxSectionCounts {
  received: number;
  sent: number;
  approved: number;
  rejected: number;
}

interface InboxCounts {
  count: number;
  pending?: number;
  results?: number;
  latestResult?: InboxLatestResult | null;
  sections?: Partial<InboxSectionCounts>;
}

const emptySections = (): InboxSectionCounts => ({
  received: 0,
  sent: 0,
  approved: 0,
  rejected: 0,
});

/** Contadores compartidos de la bandeja para el badge del menú y las pestañas. */
const unreadCount = ref(0);
const pendingCount = ref(0);
const resultCount = ref(0);
const sections = ref<InboxSectionCounts>(emptySections());
const latestResult = ref<InboxLatestResult | null>(null);
const totalCount = computed(
  () => unreadCount.value + pendingCount.value + resultCount.value,
);

export function useInboxBadge() {
  async function refresh(): Promise<InboxCounts | null> {
    try {
      const data = await api.get<InboxCounts>('/inbox/unread-count');
      unreadCount.value = data.count ?? 0;
      pendingCount.value = data.pending ?? 0;
      resultCount.value = data.results ?? 0;
      latestResult.value = data.latestResult ?? null;
      sections.value = {
        received: data.sections?.received ?? 0,
        sent: data.sections?.sent ?? 0,
        approved: data.sections?.approved ?? 0,
        rejected: data.sections?.rejected ?? 0,
      };
      return data;
    } catch {
      // El badge es accesorio: si falla no debe romper la navegación.
      return null;
    }
  }

  function clear(): void {
    unreadCount.value = 0;
    pendingCount.value = 0;
    resultCount.value = 0;
    sections.value = emptySections();
    latestResult.value = null;
  }

  return {
    unreadCount,
    pendingCount,
    resultCount,
    sections,
    latestResult,
    totalCount,
    refresh,
    clear,
  };
}
