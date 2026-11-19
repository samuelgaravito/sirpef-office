<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  FileText,
  ListChecks,
  X,
} from 'lucide-vue-next';
import { computed } from 'vue';

import StatsBreakdownBars from '@/components/stats/StatsBreakdownBars.vue';
import StatsMonthTrend from '@/components/stats/StatsMonthTrend.vue';
import { formatDayLabel } from '@/lib/date-presets';
import { docTypeLabel, formatDate, STATUS_LABELS } from '@/lib/labels';
import type { AiAskFilters, AiAskResult } from '@sirpefoffice/shared';

const props = defineProps<{ result: AiAskResult }>();

const emit = defineEmits<{
  refine: [patch: Partial<AiAskFilters>, label: string];
  ask: [question: string];
  open: [id: string];
}>();

interface FilterChip {
  key: string;
  label: string;
  patch: Partial<AiAskFilters>;
  title: string;
}

const applied = computed(() => props.result.applied);

/** Filtros aplicados, cada uno con la operación que lo quita. */
const chips = computed<FilterChip[]>(() => {
  const filters = applied.value;
  const list: FilterChip[] = [];

  if (filters.from || filters.to) {
    const from = filters.from ? formatDayLabel(filters.from) : 'el inicio';
    const to = filters.to ? formatDayLabel(filters.to) : 'hoy';
    list.push({
      key: 'date',
      label: `${from} – ${to}`,
      patch: { from: '', to: '' },
      title: 'Quitar el rango de fechas',
    });
  }

  if (filters.dateField === 'updated') {
    list.push({
      key: 'dateField',
      label: 'Por última edición',
      patch: { dateField: 'created' },
      title: 'Contar por fecha de creación',
    });
  }

  for (const type of filters.docTypes) {
    list.push({
      key: `type-${type}`,
      label: docTypeLabel(type),
      patch: { docTypes: filters.docTypes.filter((item) => item !== type) },
      title: `Quitar el tipo ${docTypeLabel(type)}`,
    });
  }

  for (const status of filters.statuses) {
    list.push({
      key: `status-${status}`,
      label: STATUS_LABELS[status],
      patch: { statuses: filters.statuses.filter((item) => item !== status) },
      title: `Quitar el estado ${STATUS_LABELS[status]}`,
    });
  }

  if (filters.templateName) {
    list.push({
      key: 'template',
      label: `Plantilla «${filters.templateName}»`,
      patch: { templateName: '' },
      title: 'Quitar la plantilla',
    });
  }

  if (filters.recipient) {
    list.push({
      key: 'recipient',
      label: `Para ${filters.recipient}`,
      patch: { recipient: '' },
      title: 'Quitar el destinatario',
    });
  }

  if (filters.text) {
    list.push({
      key: 'text',
      label: `«${filters.text}»`,
      patch: { text: '' },
      title: 'Quitar el texto buscado',
    });
  }

  if (filters.approvedByMe) {
    list.push({
      key: 'approvedByMe',
      label: 'Aprobados por ti',
      patch: { approvedByMe: false },
      title: 'Quitar el filtro de aprobaciones',
    });
  }

  list.push({
    key: 'scope',
    label: filters.scope === 'mine' ? 'Solo míos' : 'Míos y compartidos',
    patch: { scope: filters.scope === 'mine' ? 'all' : 'mine' },
    title: filters.scope === 'mine' ? 'Incluir los compartidos' : 'Ver solo los míos',
  });

  return list;
});

const documentNoun = computed(() =>
  props.result.total === 1 ? 'documento' : 'documentos',
);

/** Los estados del backend vienen en minúsculas para la frase; la UI usa sus etiquetas. */
const statusItems = computed(() =>
  (props.result.dashboard?.byStatus ?? []).map((item) => ({
    ...item,
    label: STATUS_LABELS[item.key as keyof typeof STATUS_LABELS] ?? item.label,
  })),
);

const canShowMore = computed(
  () =>
    props.result.view === 'list' &&
    props.result.results.length < props.result.total &&
    props.result.results.length < props.result.applied.limit,
);

const statsQuery = computed(() => {
  const filters = applied.value;
  return {
    from: filters.from || undefined,
    to: filters.to || undefined,
    docType: filters.docTypes.length > 0 ? filters.docTypes.join(',') : undefined,
    status: filters.statuses.length > 0 ? filters.statuses.join(',') : undefined,
    scope: filters.scope === 'mine' ? 'mine' : undefined,
    q: filters.text || undefined,
    dateField: filters.dateField === 'updated' ? 'updated' : undefined,
  };
});

function removeChip(chip: FilterChip): void {
  emit('refine', chip.patch, chip.title);
}

function selectType(key: string): void {
  emit('refine', { docTypes: [key as AiAskFilters['docTypes'][number]] }, `Solo ${docTypeLabel(key)}`);
}

function selectStatus(key: string): void {
  emit(
    'refine',
    { statuses: [key as AiAskFilters['statuses'][number]] },
    `Solo ${STATUS_LABELS[key as keyof typeof STATUS_LABELS] ?? key}`,
  );
}

/** Pide la lista que hay detrás de la cifra, sin volver a llamar al modelo. */
function showDocuments(): void {
  emit(
    'refine',
    { intent: 'list', limit: 20 },
    `Ver los ${props.result.total} ${documentNoun.value}`,
  );
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-[13.5px] leading-relaxed text-white/95">{{ result.answer }}</p>

    <!-- Filtros aplicados: cada chip se puede quitar y reconsulta al instante -->
    <div v-if="chips.length > 0" class="flex flex-wrap gap-1.5">
      <button
        v-for="chip in chips"
        :key="chip.key"
        type="button"
        class="group inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/75 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
        :title="chip.title"
        @click="removeChip(chip)"
      >
        {{ chip.label }}
        <X class="size-3 text-white/40 group-hover:text-white/80" aria-hidden="true" />
      </button>
    </div>

    <!-- Panel estadístico de la consulta -->
    <div
      v-if="result.dashboard"
      class="rounded-2xl border border-white/12 bg-white/[0.04] p-3.5"
    >
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Documentos
          </p>
          <p class="mt-1 text-[22px] font-semibold leading-none text-white tabular-nums">
            {{ result.dashboard.totals.documents }}
          </p>
        </div>
        <div class="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Borradores
          </p>
          <p class="mt-1 text-[22px] font-semibold leading-none text-[#ffd28a] tabular-nums">
            {{ result.dashboard.totals.drafts }}
          </p>
        </div>
        <div class="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Oficiales
          </p>
          <p class="mt-1 text-[22px] font-semibold leading-none text-[#7df3dd] tabular-nums">
            {{ result.dashboard.totals.official }}
          </p>
        </div>
      </div>

      <div v-if="result.dashboard.byType.length > 0" class="mt-3.5">
        <p class="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/45">
          <BarChart3 class="size-3" aria-hidden="true" />
          Por tipo
        </p>
        <StatsBreakdownBars
          :items="result.dashboard.byType"
          color="#4e85c8"
          clickable
          dark
          @select="selectType"
        />
      </div>

      <div v-if="result.dashboard.byStatus.length > 0" class="mt-3.5">
        <p class="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/45">
          <ListChecks class="size-3" aria-hidden="true" />
          Por estado
        </p>
        <StatsBreakdownBars
          :items="statusItems"
          color="#06e3bd"
          clickable
          dark
          @select="selectStatus"
        />
      </div>

      <div
        v-if="result.dashboard.monthly.some((point) => point.created > 0 || point.approved > 0)"
        class="mt-3.5"
      >
        <p class="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/45">
          Actividad
        </p>
        <StatsMonthTrend :points="result.dashboard.monthly" :limit="12" dark />
      </div>

      <button
        type="button"
        class="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-[#06e3bd]/40 bg-[#06e3bd]/10 px-3 py-1.5 text-[11.5px] font-medium text-[#7df3dd] transition-colors hover:bg-[#06e3bd]/20 hover:text-white"
        @click="showDocuments"
      >
        <FileText class="size-3.5" aria-hidden="true" />
        Ver los {{ result.total }} {{ documentNoun }}
      </button>
    </div>

    <!-- Documentos de la respuesta -->
    <ul v-if="result.results.length > 0" class="space-y-1.5">
      <li v-for="item in result.results" :key="item.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition-colors hover:border-white/25 hover:bg-white/[0.1]"
          @click="emit('open', item.id)"
        >
          <FileText class="size-4 shrink-0 text-[#7df3dd]" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-white">
              {{ item.title }}
            </span>
            <span class="block truncate text-[11.5px] text-white/60">
              {{ docTypeLabel(item.docType) }} · {{ STATUS_LABELS[item.status] }}
              <template v-if="item.docNumber"> · {{ item.docNumber }}</template>
              · {{ formatDate(item.updatedAt) }}
            </span>
          </span>
          <ArrowRight class="size-3.5 shrink-0 text-white/40" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <p v-if="canShowMore" class="text-[11.5px] text-white/45">
      Te muestro los {{ result.results.length }} más recientes de {{ result.total }}.
      <button
        type="button"
        class="font-medium text-[#7df3dd] underline-offset-2 hover:underline"
        @click="showDocuments"
      >
        Ver más
      </button>
    </p>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="suggestion in result.suggestions"
        :key="suggestion"
        type="button"
        class="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
        @click="emit('ask', suggestion)"
      >
        {{ suggestion }}
      </button>

      <RouterLink
        :to="{ name: 'stats', query: statsQuery }"
        class="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition-colors hover:border-white/30 hover:text-white"
      >
        Abrir en Estadísticas
        <ArrowUpRight class="size-3" aria-hidden="true" />
      </RouterLink>
    </div>
  </div>
</template>
