<script setup lang="ts">
import { AlertCircle, ArrowRight, Loader2, RefreshCw } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';

import BaseModal from '@/components/ui/BaseModal.vue';
import { useStatsDetail, type StatsDetailRequest } from '@/composables/useStatsDetail';
import { docTypeLabel, formatDate, STATUS_LABELS, STATUS_STYLES } from '@/lib/labels';
import type { StatsDetailItem, StatsDetailKind } from '@sirpefoffice/shared';

const props = defineProps<{
  open: boolean;
  kind: StatsDetailKind;
  /** uuid de la plantilla o `none`; solo para el detalle por plantilla. */
  templateId?: string | null;
  title: string;
  description: string;
  /** Límites ISO del filtro activo del panel. */
  dateFrom?: string;
  dateTo?: string;
}>();

const emit = defineEmits<{
  close: [];
  openDocument: [id: string];
  openMessage: [id: string];
}>();

const { items, total, page, pageSize, loading, error, load, cancel } = useStatsDetail();

const request = computed<StatsDetailRequest>(() => ({
  kind: props.kind,
  templateId: props.templateId ?? null,
  dateFrom: props.dateFrom ?? '',
  dateTo: props.dateTo ?? '',
}));

const EMPTY_TEXT: Record<StatsDetailKind, string> = {
  template: 'No hay documentos de esta plantilla en el periodo.',
  approved: 'No hay envíos aprobados en el periodo.',
  rejected: 'No hay envíos rechazados en el periodo.',
  pending: 'No hay envíos esperando aprobación.',
};

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

const heading = computed(() => {
  if (loading.value && items.value.length === 0) return props.title;
  const suffix = total.value === 1 ? 'resultado' : 'resultados';
  return `${props.title} · ${total.value} ${suffix}`;
});

function loadFirstPage(): void {
  void load(request.value, 1);
}

function goTo(nextPage: number): void {
  if (nextPage < 1 || nextPage > totalPages.value) return;
  void load(request.value, nextPage);
}

function openMessage(item: StatsDetailItem): void {
  if (item.messageId) emit('openMessage', item.messageId);
}

onMounted(() => {
  if (props.open) loadFirstPage();
});

watch(
  () => props.open,
  (open) => {
    if (open) loadFirstPage();
    else cancel();
  },
);

watch(
  () => [props.kind, props.templateId, props.dateFrom, props.dateTo],
  () => {
    if (props.open) loadFirstPage();
  },
);

onBeforeUnmount(cancel);
</script>

<template>
  <BaseModal
    :open="open"
    size="lg"
    :title="heading"
    :description="description"
    auto-focus-close
    @close="emit('close')"
  >
    <!-- Cargando la primera página -->
    <div v-if="loading && items.length === 0" class="space-y-2" aria-busy="true">
      <div v-for="n in 5" :key="n" class="h-16 animate-pulse rounded-lg bg-surface-muted" />
      <span class="sr-only">Cargando documentos…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="py-8 text-center">
      <AlertCircle class="mx-auto size-8 text-danger" />
      <p class="mt-3 text-[14px] font-semibold">No se pudo cargar el detalle</p>
      <p class="text-description mx-auto mt-1 max-w-sm">{{ error }}</p>
      <button type="button" class="btn btn-outline btn-sm mt-4" @click="loadFirstPage()">
        <RefreshCw class="size-3.5" />
        Reintentar
      </button>
    </div>

    <!-- Filas -->
    <ul v-else-if="items.length > 0" class="divide-y divide-hairline">
      <li v-for="item in items" :key="item.messageId ?? item.documentId" class="py-2.5 first:pt-0 last:pb-0">
        <div class="flex items-start gap-2">
          <button
            type="button"
            class="group min-w-0 flex-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-muted/70"
            :aria-label="`Abrir ${item.title}`"
            @click="emit('openDocument', item.documentId)"
          >
            <span class="flex flex-wrap items-center gap-1.5">
              <span class="min-w-0 truncate text-[14px] font-medium text-ink group-hover:text-accent">
                {{ item.title }}
              </span>
              <span v-if="item.docNumber" class="chip">{{ item.docNumber }}</span>
              <span class="chip" :class="STATUS_STYLES[item.status]">
                {{ STATUS_LABELS[item.status] }}
              </span>
            </span>

            <span class="text-meta mt-1 block truncate">
              {{ docTypeLabel(item.docType) }}
              <template v-if="item.templateName && item.templateName !== item.title">
                · {{ item.templateName }}
              </template>
              · {{ item.ownerName }}
              · {{ formatDate(item.date) }}
            </span>

            <span v-if="item.subject" class="text-meta mt-0.5 block truncate">
              «{{ item.subject }}»
            </span>
            <span v-if="item.resolvedByName" class="text-meta mt-0.5 block">
              {{ item.status === 'rejected' ? 'Rechazado' : 'Aprobado' }} por
              {{ item.resolvedByName }}
            </span>
          </button>

          <button
            v-if="item.messageId"
            type="button"
            class="btn btn-outline btn-sm shrink-0"
            @click="openMessage(item)"
          >
            Ver envío
            <ArrowRight class="size-3.5" />
          </button>
        </div>
      </li>
    </ul>

    <!-- Vacío -->
    <p v-else class="text-description py-10 text-center">{{ EMPTY_TEXT[kind] }}</p>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <span class="mr-auto whitespace-nowrap text-meta">
          <Loader2 v-if="loading" class="mr-1 inline size-3.5 animate-spin" />
          {{ total }} {{ total === 1 ? 'resultado' : 'resultados' }}
        </span>
        <template v-if="totalPages > 1">
          <span class="whitespace-nowrap text-[12.5px] text-ink-muted">
            Página {{ page }} de {{ totalPages }}
          </span>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="page <= 1 || loading"
            @click="goTo(page - 1)"
          >
            Anterior
          </button>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="page >= totalPages || loading"
            @click="goTo(page + 1)"
          >
            Siguiente
          </button>
        </template>
        <button type="button" class="btn btn-primary btn-sm" @click="emit('close')">Cerrar</button>
      </div>
    </template>
  </BaseModal>
</template>
