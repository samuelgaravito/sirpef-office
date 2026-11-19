<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  Save,
  Sparkles,
  X,
} from 'lucide-vue-next';
import { computed } from 'vue';

import ChartRenderer from '@/components/charts/ChartRenderer.vue';
import { formatDayLabel } from '@/lib/date-presets';
import { docTypeLabel, formatDate, STATUS_LABELS } from '@/lib/labels';
import type { AiAskFilters, AiAskPlan, AiAskResult } from '@sirpefoffice/shared';

const props = defineProps<{ result: AiAskResult }>();

const emit = defineEmits<{
  refine: [patch: Partial<AiAskFilters>, label: string];
  ask: [question: string];
  open: [id: string];
  save: [plan: AiAskPlan, title: string];
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

/** Pulsa una barra del gráfico: refina con la dimensión que eligió la IA. */
function onChartSelect(key: string, label: string): void {
  const dimension = props.result.plan.dimensions[0];
  if (!dimension) return;

  if (dimension === 'docType') {
    emit('refine', { docTypes: [key as AiAskFilters['docTypes'][number]] }, `Solo ${label}`);
    return;
  }
  if (dimension === 'status') {
    emit('refine', { statuses: [key as AiAskFilters['statuses'][number]] }, `Solo ${label}`);
    return;
  }
  if (dimension === 'template') {
    emit('refine', { templateName: label }, `Plantilla ${label}`);
    return;
  }
  if (dimension === 'recipient') {
    emit('refine', { recipient: label }, `Para ${label}`);
    return;
  }
  if (dimension === 'month' && /^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split('-').map(Number);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = new Date(year ?? 2000, month ?? 1, 0).toISOString().slice(0, 10);
    emit('refine', { from, to }, label);
  }
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

    <!-- Respuesta visual: KPI, gráfico e insights -->
    <div
      v-if="result.chart || result.insights.length > 0"
      class="rounded-2xl border border-white/12 bg-white/[0.04] p-3.5"
    >
      <div v-if="result.dashboard" class="grid grid-cols-3 gap-2">
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

      <ChartRenderer
        v-if="result.chart"
        :chart="result.chart"
        dark
        :interactive="result.plan.mode !== 'compare'"
        class="mt-3.5"
        @select="onChartSelect"
      />

      <ul v-if="result.insights.length > 0" class="mt-3 space-y-1">
        <li
          v-for="insight in result.insights"
          :key="insight"
          class="flex items-start gap-1.5 text-[11.5px] leading-snug text-white/60"
        >
          <Sparkles class="mt-0.5 size-3 shrink-0 text-[#7df3dd]" aria-hidden="true" />
          {{ insight }}
        </li>
      </ul>

      <div class="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          v-if="result.total > 0"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border border-[#06e3bd]/40 bg-[#06e3bd]/10 px-3 py-1.5 text-[11.5px] font-medium text-[#7df3dd] transition-colors hover:bg-[#06e3bd]/20 hover:text-white"
          @click="showDocuments"
        >
          <FileText class="size-3.5" aria-hidden="true" />
          Ver los {{ result.total }} {{ documentNoun }}
        </button>

        <button
          v-if="result.chart && result.chart.kind !== 'table'"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] text-white/65 transition-colors hover:border-white/30 hover:text-white"
          @click="emit('save', result.plan, result.chart.title)"
        >
          <Save class="size-3.5" aria-hidden="true" />
          Guardar gráfico
        </button>
      </div>
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
