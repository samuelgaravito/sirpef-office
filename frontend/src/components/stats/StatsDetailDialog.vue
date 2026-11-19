<script setup lang="ts">
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-vue-next';
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';

import BaseModal from '@/components/ui/BaseModal.vue';
import { useStatsDetail } from '@/composables/useStatsDetail';
import { docTypeLabel, formatDate, STATUS_LABELS } from '@/lib/labels';

const props = defineProps<{
  open: boolean;
  title: string;
  query: Record<string, string | number | undefined> | null;
}>();

const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const { items, total, page, pageSize, loading, error, open: openDetail, goTo, cancel } = useStatsDetail();

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

watch(
  () => [props.open, props.query] as const,
  ([isOpen, query]) => {
    if (isOpen && query) void openDetail(query);
    else cancel();
  },
  { immediate: true, deep: true },
);

function select(documentId: string): void {
  emit('close');
  void router.push({ name: 'document', params: { id: documentId } });
}

function go(next: number): void {
  if (next < 1 || next > totalPages.value) return;
  void goTo(next);
}

/** Los envíos muestran asunto y quién resolvió; los documentos, plantilla. */
const showsMessages = computed(() =>
  items.value.some((item) => item.messageId !== null),
);
</script>

<template>
  <BaseModal :open="open" :title="title" size="xl" @close="emit('close')">
    <div class="min-h-[220px]">
      <div v-if="loading" class="flex items-center justify-center gap-2 py-12 text-ink-muted">
        <Loader2 class="size-4 animate-spin" />
        Cargando documentos…
      </div>

      <p v-else-if="error" class="rounded-card bg-danger-soft px-3 py-2 text-[13px] text-danger">
        {{ error }}
      </p>

      <p v-else-if="items.length === 0" class="py-12 text-center text-[13px] text-ink-muted">
        No hay documentos para este valor con los filtros actuales.
      </p>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-left text-[12.5px]">
          <thead>
            <tr class="border-b border-hairline text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
              <th class="px-2 py-2 font-semibold">Documento</th>
              <th class="px-2 py-2 font-semibold">Tipo</th>
              <th class="px-2 py-2 font-semibold">Estado</th>
              <th class="px-2 py-2 font-semibold">{{ showsMessages ? 'Resuelto por' : 'Responsable' }}</th>
              <th class="px-2 py-2 font-semibold">{{ showsMessages ? 'Asunto' : 'Plantilla' }}</th>
              <th class="px-2 py-2 font-semibold">Fecha</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in items"
              :key="item.messageId ?? item.documentId"
              class="cursor-pointer border-b border-hairline/70 transition-colors hover:bg-surface-hover"
              tabindex="0"
              @click="select(item.documentId)"
              @keydown.enter="select(item.documentId)"
            >
              <td class="max-w-[260px] px-2 py-2.5">
                <p class="truncate font-medium text-ink">{{ item.title }}</p>
                <p v-if="item.docNumber" class="truncate text-[11px] text-ink-subtle">
                  {{ item.docNumber }}
                </p>
              </td>
              <td class="px-2 py-2.5 text-ink-muted">{{ docTypeLabel(item.docType) }}</td>
              <td class="px-2 py-2.5 text-ink-muted">{{ STATUS_LABELS[item.status] }}</td>
              <td class="max-w-[160px] truncate px-2 py-2.5 text-ink-muted">
                {{ item.resolvedByName ?? item.ownerName }}
              </td>
              <td class="max-w-[200px] truncate px-2 py-2.5 text-ink-muted">
                {{ showsMessages ? (item.subject ?? '—') : (item.templateName ?? 'Sin plantilla') }}
              </td>
              <td class="whitespace-nowrap px-2 py-2.5 text-ink-muted">{{ formatDate(item.date) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <p class="text-[11.5px] text-ink-subtle">
          {{ total }} resultado{{ total === 1 ? '' : 's' }}
        </p>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="loading || page <= 1"
            @click="go(page - 1)"
          >
            <ChevronLeft class="size-3.5" />
            Anterior
          </button>
          <span class="text-[11.5px] text-ink-subtle">{{ page }} / {{ totalPages }}</span>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="loading || page >= totalPages"
            @click="go(page + 1)"
          >
            Siguiente
            <ChevronRight class="size-3.5" />
          </button>
        </div>
      </div>
    </template>
  </BaseModal>
</template>
