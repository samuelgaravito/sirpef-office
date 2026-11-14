<script setup lang="ts">
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  FileText,
  Inbox,
  Layers,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import StatsBarList from '@/components/home/stats/StatsBarList.vue';
import StatsDetailDialog from '@/components/home/stats/StatsDetailDialog.vue';
import StatsMonthTrend from '@/components/home/stats/StatsMonthTrend.vue';
import type { StatsBarItem } from '@/components/home/stats/types';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useWorkspaceStats } from '@/composables/useWorkspaceStats';
import {
  DATE_PRESETS,
  dateFilterLabel,
  endOfDayIso,
  isPresetActive,
  presetRange,
  startOfDayIso,
  type DatePreset,
} from '@/lib/date-presets';
import { relativeTime } from '@/lib/labels';
import type { StatsDetailKind } from '@sirpefoffice/shared';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const { stats, loading, error, dateFrom, dateTo, load, clearDates, cancel } = useWorkspaceStats();

/** Permite cerrar el panel de fechas al elegir un atajo. */
const dateDropdown = ref<{ close: () => void } | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) void load();
    else cancel();
  },
  { immediate: true },
);

const dateRangeInvalid = computed(
  () => Boolean(dateFrom.value && dateTo.value && dateFrom.value > dateTo.value),
);

const hasFilter = computed(() => Boolean(dateFrom.value || dateTo.value));

const dateButtonLabel = computed(() => dateFilterLabel(dateFrom.value, dateTo.value));

/** Aplica un atajo y consulta al instante, como en Documentos. */
function applyPreset(preset: DatePreset): void {
  const range = presetRange(preset);
  dateFrom.value = range.from;
  dateTo.value = range.to;
  dateDropdown.value?.close();
  void load();
}

/** Cómo nombrar el periodo en los textos sin repetir la condición. */
const periodLabel = computed(() => (hasFilter.value ? 'el periodo seleccionado' : 'todo el histórico'));
/** Variante con preposición para «documentos de…». */
const periodPhrase = computed(() => (hasFilter.value ? 'del periodo' : 'de todo el histórico'));

const composition = computed(() => {
  const data = stats.value;
  if (!data) return [];
  return [
    {
      key: 'documents',
      label: 'Documentos',
      value: Math.max(0, data.totals.documents - data.totals.drafts),
      color: '#4e85c8',
    },
    { key: 'drafts', label: 'Borradores', value: data.totals.drafts, color: '#06b89b' },
    { key: 'templates', label: 'Plantillas', value: data.totals.templates, color: '#e0a106' },
    { key: 'designs', label: 'Diseños', value: data.totals.designs, color: '#93a9c4' },
  ];
});

const compositionTotal = computed(() =>
  composition.value.reduce((sum, segment) => sum + segment.value, 0),
);

const officialShare = computed(() => {
  const total = stats.value?.totals.documents ?? 0;
  return total > 0 ? Math.round(((stats.value?.totals.official ?? 0) / total) * 100) : 0;
});

const templateItems = computed<StatsBarItem[]>(() =>
  (stats.value?.topTemplates ?? []).map((row) => ({
    key: row.id ?? `no-template-${row.name}`,
    label: row.name,
    count: row.count,
    color: '#4e85c8',
    ...(row.isShared ? { badge: 'Compartida' } : {}),
  })),
);

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function segmentWidth(value: number): string {
  const total = compositionTotal.value;
  if (total <= 0 || value <= 0) return '0%';
  return `${(value / total) * 100}%`;
}

/** Convierte horas en una etiqueta humana: minutos, horas o días. */
function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return minutes <= 0 ? 'menos de 1 min' : `${minutes} min`;
  }
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** Cierra el panel y abre el módulo con el filtro que corresponda. */
function go(name: string, query?: Record<string, string>): void {
  emit('close');
  void router.push(query ? { name, query } : { name });
}

/* ───────────────── Detalle de un valor (modal anidado) ──────────────── */

interface DetailTarget {
  kind: StatsDetailKind;
  templateId: string | null;
  title: string;
  description: string;
  dateFrom: string;
  dateTo: string;
}

const detail = ref<DetailTarget | null>(null);

/** «en el periodo seleccionado» / «en todo el histórico». */
const periodIn = computed(() =>
  hasFilter.value ? 'en el periodo seleccionado' : 'en todo el histórico',
);

/** El detalle reutiliza exactamente el filtro de fechas activo del panel. */
function detailPeriod(): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: dateFrom.value ? startOfDayIso(dateFrom.value) : '',
    dateTo: dateTo.value ? endOfDayIso(dateTo.value) : '',
  };
}

function openTemplateDetail(key: string): void {
  const row = stats.value?.topTemplates.find(
    (item) => (item.id ?? `no-template-${item.name}`) === key,
  );
  if (!row) return;

  detail.value = {
    kind: 'template',
    templateId: row.id ?? 'none',
    title: row.name,
    description: `Documentos creados ${periodIn.value}`,
    ...detailPeriod(),
  };
}

function openApprovalDetail(kind: 'approved' | 'rejected'): void {
  detail.value = {
    kind,
    templateId: null,
    title: kind === 'approved' ? 'Aprobados' : 'Rechazados',
    description: `Envíos ${kind === 'approved' ? 'aprobados' : 'rechazados'} ${periodIn.value}`,
    ...detailPeriod(),
  };
}

function openPendingDetail(): void {
  detail.value = {
    kind: 'pending',
    templateId: null,
    title: 'Pendientes',
    description: 'Envíos esperando aprobación ahora mismo',
    dateFrom: '',
    dateTo: '',
  };
}

function openDetailDocument(id: string): void {
  detail.value = null;
  emit('close');
  void router.push({ name: 'document', params: { id } });
}

function openDetailMessage(id: string): void {
  detail.value = null;
  emit('close');
  void router.push({ name: 'inbox-message', params: { id } });
}

// Si el panel se cierra por otra vía, el detalle no debe quedar abierto.
watch(
  () => props.open,
  (open) => {
    if (!open) detail.value = null;
  },
);
</script>

<template>
  <BaseModal
    :open="open"
    size="xl"
    title="Estadísticas del espacio"
    description="Documentos propios y compartidos: el mismo criterio que el listado."
    @close="emit('close')"
  >
    <!-- Filtro por fecha de creación -->
    <div class="rounded-lg border border-hairline bg-surface-muted/40 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <BaseDropdown
          ref="dateDropdown"
          width="w-[calc(100vw-6rem)] max-w-80"
          :close-on-click="false"
        >
          <template #trigger="{ open }">
            <button
              type="button"
              :class="[
                'btn btn-sm max-w-full whitespace-nowrap',
                dateRangeInvalid
                  ? 'btn-outline !border-danger/40 !bg-danger-soft !text-danger'
                  : hasFilter
                    ? 'btn-outline !border-accent/40 !bg-accent-soft !text-accent'
                    : 'btn-outline',
              ]"
            >
              <CalendarDays class="size-4 shrink-0" />
              <span class="truncate">{{ dateButtonLabel }}</span>
              <ChevronDown
                :class="['size-3 shrink-0 transition-transform', open ? 'rotate-180' : '']"
              />
            </button>
          </template>

          <template #content>
            <div class="p-2" @click.stop>
              <p class="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
                Atajos
              </p>
              <div class="mt-1.5 grid grid-cols-2 gap-1.5">
                <button
                  v-for="preset in DATE_PRESETS"
                  :key="preset.value"
                  type="button"
                  :class="[
                    'rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] font-medium transition-colors',
                    isPresetActive(preset.value, dateFrom, dateTo)
                      ? 'border-accent/40 bg-accent-soft text-accent'
                      : 'border-hairline bg-surface text-ink-muted hover:border-accent/40 hover:text-accent',
                  ]"
                  @click="applyPreset(preset.value)"
                >
                  {{ preset.label }}
                </button>
              </div>

              <p class="mt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
                Rango personalizado
              </p>
              <div class="mt-1.5 grid grid-cols-2 gap-2">
                <label class="block">
                  <span class="label">Desde</span>
                  <input
                    id="stats-from"
                    v-model="dateFrom"
                    type="date"
                    class="field"
                    :max="dateTo || undefined"
                    @change="load()"
                  />
                </label>
                <label class="block">
                  <span class="label">Hasta</span>
                  <input
                    id="stats-to"
                    v-model="dateTo"
                    type="date"
                    class="field"
                    :min="dateFrom || undefined"
                    @change="load()"
                  />
                </label>
              </div>

              <div class="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-2.5">
                <span class="min-w-0 truncate text-meta">
                  {{ hasFilter ? dateButtonLabel : 'Sin filtro de fecha' }}
                </span>
                <button
                  v-if="hasFilter"
                  type="button"
                  class="shrink-0 text-[12.5px] font-medium text-danger hover:underline"
                  @click="clearDates()"
                >
                  Limpiar fechas
                </button>
              </div>
            </div>
          </template>
        </BaseDropdown>

        <p class="text-meta sm:ml-auto">Filtra por fecha de creación</p>
      </div>

      <p v-if="dateRangeInvalid" class="mt-2 text-[12.5px] text-danger">
        La fecha inicial no puede ser posterior a la fecha final.
      </p>
    </div>

    <!-- Cargando por primera vez -->
    <div v-if="loading && !stats" class="mt-4 space-y-4" aria-busy="true">
      <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div v-for="n in 4" :key="n" class="h-[86px] animate-pulse rounded-lg bg-surface-muted" />
      </div>
      <div class="grid gap-3 lg:grid-cols-2">
        <div v-for="n in 2" :key="n" class="h-52 animate-pulse rounded-lg bg-surface-muted" />
      </div>
      <span class="sr-only">Cargando estadísticas…</span>
    </div>

    <!-- Error sin datos previos -->
    <div v-else-if="error && !stats" class="py-10 text-center">
      <AlertCircle class="mx-auto size-8 text-danger" />
      <p class="mt-3 text-[14px] font-semibold">No se pudieron cargar las estadísticas</p>
      <p class="text-description mx-auto mt-1 max-w-sm">{{ error }}</p>
      <button type="button" class="btn btn-outline btn-sm mt-4" @click="load(true)">
        <RefreshCw class="size-3.5" />
        Reintentar
      </button>
    </div>

    <div v-else-if="stats" class="mt-4 space-y-4">
      <p v-if="loading" class="flex items-center gap-2 text-meta">
        <Loader2 class="size-3.5 animate-spin" />
        Actualizando…
      </p>

      <!-- Cifras clave -->
      <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div class="rounded-lg border border-hairline bg-surface p-3">
          <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
            Documentos creados
          </p>
          <p class="mt-1 text-[24px] font-semibold leading-none tabular-nums text-ink">
            {{ stats.totals.documents }}
          </p>
          <p class="text-meta mt-1.5">en {{ periodLabel }}</p>
        </div>

        <div class="rounded-lg border border-hairline bg-surface p-3">
          <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
            En borrador
          </p>
          <p class="mt-1 text-[24px] font-semibold leading-none tabular-nums text-ink">
            {{ stats.totals.drafts }}
          </p>
          <p class="text-meta mt-1.5">siguen en preparación</p>
        </div>

        <div class="rounded-lg border border-hairline bg-surface p-3">
          <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
            Oficiales
          </p>
          <p class="mt-1 text-[24px] font-semibold leading-none tabular-nums text-ink">
            {{ stats.totals.official }}
          </p>
          <p class="text-meta mt-1.5">{{ officialShare }}% de los creados</p>
        </div>

        <button
          type="button"
          class="group rounded-lg border border-hairline bg-surface p-3 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/30"
          aria-label="Ver los envíos pendientes de aprobación"
          @click="openPendingDetail()"
        >
          <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
            Pendientes
          </p>
          <p
            class="mt-1 text-[24px] font-semibold leading-none tabular-nums text-ink transition-colors group-hover:text-accent"
          >
            {{ stats.approvals.pending }}
          </p>
          <p class="text-meta mt-1.5">esperando aprobación ahora</p>
        </button>
      </div>

      <!-- Composición y tendencia -->
      <div class="grid gap-3 lg:grid-cols-2">
        <section class="rounded-lg border border-hairline bg-surface p-4">
          <h3 class="text-[14px] font-semibold">Composición de lo creado</h3>

          <div
            v-if="compositionTotal > 0"
            class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-muted"
            aria-hidden="true"
          >
            <div
              v-for="segment in composition"
              :key="segment.key"
              class="h-full first:rounded-l-full last:rounded-r-full"
              :style="{ width: segmentWidth(segment.value), backgroundColor: segment.color }"
            />
          </div>

          <ul v-if="compositionTotal > 0" class="mt-3 space-y-1.5">
            <li
              v-for="segment in composition"
              :key="segment.key"
              class="flex items-center gap-2 text-[13px]"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :style="{ backgroundColor: segment.color }"
                aria-hidden="true"
              />
              <span class="truncate text-ink-muted">{{ segment.label }}</span>
              <span class="ml-auto flex items-baseline justify-end gap-2 tabular-nums">
                <span class="min-w-[2ch] text-right font-semibold text-ink">
                  {{ segment.value }}
                </span>
                <span class="min-w-[3.5ch] text-right text-[11.5px] font-medium text-ink-subtle">
                  {{ percent(segment.value, compositionTotal) }} %
                </span>
              </span>
            </li>
          </ul>
          <p v-else class="text-description mt-3">No hay elementos creados en este periodo.</p>

          <p v-if="stats.totals.trashed > 0" class="text-meta mt-3 flex items-center gap-1.5">
            <Trash2 class="size-3.5 shrink-0 text-ink-subtle" />
            {{ stats.totals.trashed }} en la papelera (no cuentan)
          </p>

          <p class="text-meta mt-3 border-t border-hairline pt-2">
            <template v-if="hasFilter">
              Total del periodo: {{ stats.totals.elements }} elementos.
            </template>
            <template v-else>
              Total: {{ stats.totals.elements }} elementos, igual que el resumen de inicio.
            </template>
          </p>
        </section>

        <section class="rounded-lg border border-hairline bg-surface p-4">
          <h3 class="text-[14px] font-semibold">Actividad por mes</h3>
          <p class="text-meta mt-0.5">
            Creados frente a aprobados
            {{ hasFilter ? 'en el periodo' : 'en los últimos 12 meses' }}
          </p>
          <StatsMonthTrend :points="stats.monthly" class="mt-3" />
        </section>
      </div>

      <!-- Plantillas -->
      <section class="rounded-lg border border-hairline bg-surface p-4">
        <h3 class="flex items-center gap-2 text-[14px] font-semibold">
          <Layers class="size-4 text-accent" />
          Plantillas más usadas
        </h3>
        <p class="text-meta mt-0.5">
          Documentos {{ periodPhrase }} creados con cada plantilla · pulsa una para ver el detalle
        </p>
        <StatsBarList
          :items="templateItems"
          interactive
          empty-text="Aún no hay documentos creados desde una plantilla en este periodo"
          class="mt-3"
          @select="openTemplateDetail"
        />
      </section>

      <!-- Aprobaciones -->
      <section class="rounded-lg border border-hairline bg-surface p-4">
        <h3 class="flex items-center gap-2 text-[14px] font-semibold">
          <Clock3 class="size-4 text-warning" />
          Aprobaciones
        </h3>
        <p class="text-meta mt-0.5">
          Resultados de tus envíos en {{ periodLabel }} · pulsa un número para ver el detalle
        </p>

        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            class="group -m-1 rounded-md p-1 text-left transition-colors hover:bg-success-soft/50"
            aria-label="Ver los envíos aprobados"
            @click="openApprovalDetail('approved')"
          >
            <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
              Aprobados
            </p>
            <p
              class="mt-0.5 text-[18px] font-semibold tabular-nums text-success group-hover:underline"
            >
              {{ stats.approvals.approved }}
            </p>
          </button>
          <button
            type="button"
            class="group -m-1 rounded-md p-1 text-left transition-colors hover:bg-danger-soft/50"
            aria-label="Ver los envíos rechazados"
            @click="openApprovalDetail('rejected')"
          >
            <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
              Rechazados
            </p>
            <p class="mt-0.5 text-[18px] font-semibold tabular-nums text-danger group-hover:underline">
              {{ stats.approvals.rejected }}
            </p>
          </button>
          <div>
            <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
              Tasa de aprobación
            </p>
            <p class="mt-0.5 text-[18px] font-semibold tabular-nums text-ink">
              {{ formatRate(stats.approvals.approvalRate) }}
            </p>
          </div>
          <div>
            <p class="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
              Tiempo medio
            </p>
            <p class="mt-0.5 text-[18px] font-semibold tabular-nums text-ink">
              {{ formatHours(stats.approvals.avgHours) }}
            </p>
          </div>
        </div>

        <p v-if="stats.approvals.approved + stats.approvals.rejected === 0" class="text-meta mt-3">
          No hay envíos resueltos en este periodo.
        </p>
      </section>

      <!-- Salud del espacio -->
      <section class="rounded-lg border border-hairline bg-surface p-4">
        <h3 class="text-[14px] font-semibold">Qué conviene revisar</h3>
        <p class="text-meta mt-0.5">Estado actual: no depende del filtro de fechas</p>

        <div
          v-if="stats.health.staleDrafts + stats.totals.trashed + stats.approvals.pending > 0"
          class="mt-3 flex flex-wrap gap-2"
        >
          <button
            v-if="stats.health.staleDrafts > 0"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-[12.5px] font-medium text-warning transition-colors hover:bg-warning-soft/70"
            @click="go('documents', { status: 'draft' })"
          >
            <FileText class="size-3.5" />
            {{ stats.health.staleDrafts }}
            {{ stats.health.staleDrafts === 1 ? 'borrador sin tocar' : 'borradores sin tocar' }}
            en 30 días
            <ArrowRight class="size-3" />
          </button>

          <button
            v-if="stats.approvals.pending > 0"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-soft/70"
            @click="go('inbox')"
          >
            <Inbox class="size-3.5" />
            {{ stats.approvals.pending }} esperando aprobación
            <ArrowRight class="size-3" />
          </button>

          <button
            v-if="stats.totals.trashed > 0"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-hairline-strong bg-surface-muted px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-surface-hover"
            @click="go('documents', { view: 'trash' })"
          >
            <Trash2 class="size-3.5" />
            {{ stats.totals.trashed }} en la papelera
            <ArrowRight class="size-3" />
          </button>
        </div>

        <p v-else class="text-description mt-3">
          Nada pendiente: no hay borradores abandonados, aprobaciones ni papelera.
        </p>
      </section>
    </div>

    <template v-if="stats" #footer>
      <span class="mr-auto text-[12px] text-ink-subtle">
        Actualizado {{ relativeTime(stats.generatedAt) }}
      </span>
      <button type="button" class="btn btn-outline btn-sm" @click="emit('close')">Cerrar</button>
      <button type="button" class="btn btn-primary btn-sm" @click="go('documents')">
        Ver documentos
      </button>
    </template>
  </BaseModal>

  <!-- Detalle de un valor: modal anidado sobre el panel -->
  <StatsDetailDialog
    v-if="detail"
    :open="true"
    :kind="detail.kind"
    :template-id="detail.templateId"
    :title="detail.title"
    :description="detail.description"
    :date-from="detail.dateFrom"
    :date-to="detail.dateTo"
    @close="detail = null"
    @open-document="openDetailDocument"
    @open-message="openDetailMessage"
  />
</template>
