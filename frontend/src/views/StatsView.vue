<script setup lang="ts">
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileCheck2,
  FileText,
  Inbox,
  Layers,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import StatsBreakdownBars from '@/components/stats/StatsBreakdownBars.vue';
import StatsDetailDialog from '@/components/stats/StatsDetailDialog.vue';
import StatsMonthTrend from '@/components/stats/StatsMonthTrend.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import { useToast } from '@/composables/useToast';
import { useWorkspaceStats } from '@/composables/useWorkspaceStats';
import { api } from '@/api/client';
import {
  DATE_PRESETS,
  dateFilterLabel,
  endOfDayIso,
  isPresetActive,
  presetRange,
  startOfDayIso,
  type DatePreset,
} from '@/lib/date-presets';
import { errorMessage } from '@/lib/error-message';
import { docTypeLabel, relativeTime, STATUS_LABELS } from '@/lib/labels';
import type { StatsDetailKind, StatsPanel } from '@sirpefoffice/shared';

const route = useRoute();
const router = useRouter();
const toast = useToast();

/** Filtros que llegan desde el chat de consulta por la URL. */
const chatFilter = ref({
  from: typeof route.query.from === 'string' ? route.query.from : '',
  to: typeof route.query.to === 'string' ? route.query.to : '',
  docType: typeof route.query.docType === 'string' ? route.query.docType : '',
  status: typeof route.query.status === 'string' ? route.query.status : '',
  q: typeof route.query.q === 'string' ? route.query.q : '',
  scope: route.query.scope === 'mine' ? ('mine' as const) : undefined,
  dateField: route.query.dateField === 'updated' ? ('updated' as const) : undefined,
  active: false,
});
chatFilter.value.active = Boolean(
  chatFilter.value.from ||
    chatFilter.value.to ||
    chatFilter.value.docType ||
    chatFilter.value.status ||
    chatFilter.value.q ||
    chatFilter.value.scope ||
    chatFilter.value.dateField,
);

const filteredMode = computed(() => chatFilter.value.active);

const {
  stats,
  loading: overviewLoading,
  error: overviewError,
  dateFrom,
  dateTo,
  load: loadOverview,
  cancel,
} = useWorkspaceStats();

if (filteredMode.value) {
  dateFrom.value = chatFilter.value.from;
  dateTo.value = chatFilter.value.to;
}

const panel = ref<StatsPanel | null>(null);
const panelLoading = ref(false);
const panelError = ref('');

const loading = computed(() => (filteredMode.value ? panelLoading.value : overviewLoading.value));
const error = computed(() => (filteredMode.value ? panelError.value : overviewError.value));

/** Permite cerrar el panel de fechas al elegir un atajo. */
const dateDropdown = ref<{ close: () => void } | null>(null);

const dateRangeInvalid = computed(
  () => Boolean(dateFrom.value && dateTo.value && dateFrom.value > dateTo.value),
);

const hasFilter = computed(() => Boolean(dateFrom.value || dateTo.value));

const dateButtonLabel = computed(() => dateFilterLabel(dateFrom.value, dateTo.value));

const periodPhrase = computed(() =>
  hasFilter.value ? 'del periodo seleccionado' : 'de todo el histórico',
);

async function loadPanel(): Promise<void> {
  if (dateRangeInvalid.value) return;
  panelLoading.value = true;
  panelError.value = '';
  try {
    panel.value = await api.get<StatsPanel>('/stats/panel', {
      dateFrom: dateFrom.value ? startOfDayIso(dateFrom.value) : undefined,
      dateTo: dateTo.value ? endOfDayIso(dateTo.value) : undefined,
      docType: chatFilter.value.docType || undefined,
      status: chatFilter.value.status || undefined,
      q: chatFilter.value.q || undefined,
      scope: chatFilter.value.scope,
      dateField: chatFilter.value.dateField,
    });
  } catch (caught) {
    panelError.value = errorMessage(caught, 'No se pudieron cargar las estadísticas de la consulta');
  } finally {
    panelLoading.value = false;
  }
}

async function load(): Promise<void> {
  if (dateRangeInvalid.value) return;
  if (filteredMode.value) await loadPanel();
  else await loadOverview(true);
}

function applyPreset(preset: DatePreset): void {
  const range = presetRange(preset);
  dateFrom.value = range.from;
  dateTo.value = range.to;
  dateDropdown.value?.close();
  void load();
}

function clearDates(): void {
  dateFrom.value = '';
  dateTo.value = '';
  void load();
}

function leaveFilteredMode(): void {
  void router.replace({ name: 'stats' });
  chatFilter.value = {
    from: '',
    to: '',
    docType: '',
    status: '',
    q: '',
    scope: undefined,
    dateField: undefined,
    active: false,
  };
  dateFrom.value = '';
  dateTo.value = '';
  void loadOverview(true);
}

/* ── Detalle de cada cifra ────────────────────────────────────────── */

const detailOpen = ref(false);
const detailTitle = ref('');
const detailQuery = ref<Record<string, string | number | undefined> | null>(null);

function openDetail(
  kind: StatsDetailKind,
  title: string,
  extra: Record<string, string | number | undefined> = {},
): void {
  detailTitle.value = title;
  detailQuery.value = {
    kind,
    dateFrom: dateFrom.value ? startOfDayIso(dateFrom.value) : undefined,
    dateTo: dateTo.value ? endOfDayIso(dateTo.value) : undefined,
    ...(filteredMode.value
      ? {
          docType: chatFilter.value.docType || undefined,
          status: chatFilter.value.status || undefined,
          q: chatFilter.value.q || undefined,
          scope: chatFilter.value.scope,
          dateField: chatFilter.value.dateField,
        }
      : {}),
    ...extra,
  };
  detailOpen.value = true;
}

function openTemplate(id: string | null, name: string, count: number): void {
  openDetail('template', `${name} · ${count} documento${count === 1 ? '' : 's'}`, {
    templateId: id ?? 'none',
  });
}

/** Estados con la etiqueta de la interfaz, no la de la frase del backend. */
const panelStatusItems = computed(() =>
  (panel.value?.byStatus ?? []).map((item) => ({
    ...item,
    label: STATUS_LABELS[item.key as keyof typeof STATUS_LABELS] ?? item.label,
  })),
);

function statusTitle(key: string): string {
  return `Estado ${STATUS_LABELS[key as keyof typeof STATUS_LABELS] ?? key}`;
}

const chatFilterLabels = computed(() => {
  const labels: string[] = [];
  if (chatFilter.value.docType) labels.push(docTypeLabel(chatFilter.value.docType));
  if (chatFilter.value.status) {
    labels.push(STATUS_LABELS[chatFilter.value.status as keyof typeof STATUS_LABELS] ?? chatFilter.value.status);
  }
  if (chatFilter.value.q) labels.push(`«${chatFilter.value.q}»`);
  if (chatFilter.value.dateField === 'updated') labels.push('por última edición');
  if (chatFilter.value.scope === 'mine') labels.push('solo míos');
  return labels;
});

const approvalRate = computed(() => {
  const value = stats.value?.approvals.approvalRate;
  return value == null ? '—' : `${Math.round(value * 100)}%`;
});

const avgHours = computed(() => {
  const value = stats.value?.approvals.avgHours;
  return value == null ? '—' : `${Math.max(0, value).toFixed(1)} h`;
});

const documentsDetailTitle = computed(() =>
  filteredMode.value ? 'Documentos de la consulta' : `Documentos ${periodPhrase.value}`,
);

onMounted(() => {
  void load();
});

function refresh(): void {
  void load();
  toast.success('Estadísticas actualizadas');
}
</script>

<template>
  <AppShell>
    <PageHeader
      title="Estadísticas"
      :subtitle="
        filteredMode
          ? `Panel de la consulta: documentos ${periodPhrase}`
          : `Actividad del espacio ${periodPhrase}`
      "
      sticky
    >
      <template #actions>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          :disabled="loading"
          title="Actualizar"
          @click="refresh"
        >
          <RefreshCw :class="['size-3.5', loading ? 'animate-spin' : '']" />
          <span class="hidden sm:inline">Actualizar</span>
        </button>

        <BaseDropdown ref="dateDropdown" align="right" width="w-72">
          <template #trigger>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              :class="hasFilter ? 'border-accent text-accent' : ''"
            >
              <CalendarDays class="size-3.5" />
              {{ dateButtonLabel }}
              <ChevronDown class="size-3.5" />
            </button>
          </template>
          <template #content>
            <div class="space-y-3 p-1">
              <div class="grid grid-cols-2 gap-1">
                <button
                  v-for="preset in DATE_PRESETS"
                  :key="preset.value"
                  type="button"
                  class="rounded-md px-2 py-1.5 text-left text-[12px] transition-colors"
                  :class="
                    isPresetActive(preset.value, dateFrom, dateTo)
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                  "
                  @click="applyPreset(preset.value)"
                >
                  {{ preset.label }}
                </button>
              </div>

              <div class="grid grid-cols-2 gap-2 border-t border-hairline pt-2">
                <label class="text-[11px] text-ink-subtle">
                  Desde
                  <input v-model="dateFrom" type="date" class="field mt-1" :max="dateTo || undefined" />
                </label>
                <label class="text-[11px] text-ink-subtle">
                  Hasta
                  <input v-model="dateTo" type="date" class="field mt-1" :min="dateFrom || undefined" />
                </label>
              </div>

              <p v-if="dateRangeInvalid" class="text-[11.5px] text-danger">
                La fecha inicial no puede ser posterior a la final.
              </p>

              <div class="flex justify-between border-t border-hairline pt-2">
                <button type="button" class="text-[12px] text-ink-subtle hover:text-ink" @click="clearDates">
                  Limpiar
                </button>
                <button type="button" class="btn btn-primary btn-sm" @click="dateDropdown?.close(); load()">
                  Aplicar
                </button>
              </div>
            </div>
          </template>
        </BaseDropdown>
      </template>
    </PageHeader>

    <div class="px-5 pb-10 pt-2 sm:px-8">
      <!-- Filtros que vienen del chat -->
      <div
        v-if="filteredMode"
        class="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-accent/30 bg-accent-soft/50 px-3 py-2 text-[12px] text-ink-muted"
      >
        <span class="font-medium text-accent">Filtros de la consulta</span>
        <span v-for="label in chatFilterLabels" :key="label" class="rounded-full bg-surface px-2 py-0.5">
          {{ label }}
        </span>
        <button
          type="button"
          class="ml-auto inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-1 text-[11.5px] hover:bg-surface"
          @click="leaveFilteredMode"
        >
          <X class="size-3" />
          Volver al resumen del espacio
        </button>
      </div>

      <div v-if="loading && !stats && !panel" class="flex items-center justify-center gap-2 py-20 text-ink-muted">
        <BaseSpinner />
        Cargando estadísticas…
      </div>

      <p
        v-else-if="error"
        class="flex items-start gap-2 rounded-card bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
      >
        <AlertCircle class="mt-0.5 size-4 shrink-0" />
        {{ error }}
      </p>

      <template v-else>
        <!-- Panel filtrado (mismo motor que el chat) -->
        <template v-if="filteredMode && panel">
          <div class="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              class="kpi"
              @click="openDetail('documents', documentsDetailTitle)"
            >
              <span class="kpi-label"><FileText class="size-3.5" /> Documentos</span>
              <span class="kpi-value">{{ panel.totals.documents }}</span>
              <span class="kpi-hint">Ver la lista</span>
            </button>
            <button
              type="button"
              class="kpi"
              @click="openDetail('drafts', 'Borradores')"
            >
              <span class="kpi-label"><Layers class="size-3.5" /> Borradores</span>
              <span class="kpi-value">{{ panel.totals.drafts }}</span>
              <span class="kpi-hint">Ver la lista</span>
            </button>
            <button
              type="button"
              class="kpi"
              @click="openDetail('official', 'Documentos oficiales')"
            >
              <span class="kpi-label"><FileCheck2 class="size-3.5" /> Oficiales</span>
              <span class="kpi-value">{{ panel.totals.official }}</span>
              <span class="kpi-hint">Enviados, aprobados, finales y archivados</span>
            </button>
          </div>

          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            <section class="card p-4">
              <h2 class="card-title">Por tipo</h2>
              <StatsBreakdownBars
                v-if="panel.byType.length > 0"
                :items="panel.byType"
                color="#3c6fb0"
                clickable
                @select="(key) => openDetail('documents', docTypeLabel(key), { docType: key })"
              />
              <p v-else class="text-[12.5px] text-ink-subtle">Sin documentos en el periodo.</p>
            </section>

            <section class="card p-4">
              <h2 class="card-title">Por estado</h2>
              <StatsBreakdownBars
                v-if="panel.byStatus.length > 0"
                :items="panelStatusItems"
                color="#06b89b"
                clickable
                @select="(key) => openDetail('documents', statusTitle(key), { status: key })"
              />
              <p v-else class="text-[12.5px] text-ink-subtle">Sin documentos en el periodo.</p>
            </section>

            <section class="card p-4 lg:col-span-2">
              <h2 class="card-title">Actividad mensual</h2>
              <StatsMonthTrend :points="panel.monthly" />
            </section>

            <section class="card p-4 lg:col-span-2">
              <h2 class="card-title">Plantillas más usadas</h2>
              <ul v-if="panel.topTemplates.length > 0" class="space-y-1.5">
                <li v-for="row in panel.topTemplates" :key="row.id ?? row.name">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-hover"
                    @click="openTemplate(row.id, row.name, row.count)"
                  >
                    <span class="min-w-0 flex-1 truncate text-ink">{{ row.name }}</span>
                    <span v-if="row.isShared" class="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">
                      Compartida
                    </span>
                    <span class="w-8 text-right font-medium tabular-nums text-ink">{{ row.count }}</span>
                  </button>
                </li>
              </ul>
              <p v-else class="text-[12.5px] text-ink-subtle">Sin plantillas en el periodo.</p>
            </section>
          </div>
        </template>

        <!-- Resumen del espacio -->
        <template v-else-if="stats">
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <button type="button" class="kpi kpi-accent" @click="openDetail('documents', 'Documentos del espacio')">
              <span class="kpi-label"><FileText class="size-3.5" /> Documentos</span>
              <span class="kpi-value">{{ stats.totals.documents }}</span>
              <span class="kpi-hint">{{ stats.totals.drafts }} en borrador</span>
            </button>

            <button type="button" class="kpi" @click="openDetail('drafts', 'Borradores')">
              <span class="kpi-label"><Layers class="size-3.5" /> Borradores</span>
              <span class="kpi-value">{{ stats.totals.drafts }}</span>
              <span class="kpi-hint">Sin número todavía</span>
            </button>

            <button type="button" class="kpi" @click="openDetail('official', 'Documentos oficiales')">
              <span class="kpi-label"><FileCheck2 class="size-3.5" /> Oficiales</span>
              <span class="kpi-value">{{ stats.totals.official }}</span>
              <span class="kpi-hint">Enviados, aprobados, finales y archivados</span>
            </button>

            <div class="kpi">
              <span class="kpi-label"><FileText class="size-3.5" /> Plantillas activas</span>
              <span class="kpi-value">{{ stats.totals.templates }}</span>
              <span class="kpi-hint">Disponibles para crear</span>
            </div>

            <div class="kpi">
              <span class="kpi-label"><Layers class="size-3.5" /> Diseños</span>
              <span class="kpi-value">{{ stats.totals.designs }}</span>
              <span class="kpi-hint">Propios o compartidos</span>
            </div>

            <button type="button" class="kpi" @click="openDetail('trashed', 'Papelera')">
              <span class="kpi-label"><Trash2 class="size-3.5" /> Papelera</span>
              <span class="kpi-value">{{ stats.totals.trashed }}</span>
              <span class="kpi-hint">Solo tus documentos</span>
            </button>
          </div>

          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            <section class="card p-4 lg:col-span-2">
              <h2 class="card-title">Actividad mensual</h2>
              <StatsMonthTrend :points="stats.monthly" />
            </section>

            <section class="card p-4">
              <h2 class="card-title">Aprobaciones</h2>
              <div class="grid grid-cols-3 gap-2">
                <button type="button" class="mini" @click="openDetail('pending', 'Pendientes de aprobación')">
                  <span class="mini-label">Pendientes</span>
                  <span class="mini-value text-warning">{{ stats.approvals.pending }}</span>
                </button>
                <button type="button" class="mini" @click="openDetail('approved', 'Aprobados')">
                  <span class="mini-label">Aprobados</span>
                  <span class="mini-value text-success">{{ stats.approvals.approved }}</span>
                </button>
                <button type="button" class="mini" @click="openDetail('rejected', 'Rechazados')">
                  <span class="mini-label">Rechazados</span>
                  <span class="mini-value text-danger">{{ stats.approvals.rejected }}</span>
                </button>
              </div>
              <div class="mt-3 flex items-center gap-4 border-t border-hairline pt-3 text-[12px] text-ink-muted">
                <span class="inline-flex items-center gap-1.5">
                  <CheckCircle2 class="size-3.5 text-success" />
                  Tasa de aprobación: <strong class="text-ink">{{ approvalRate }}</strong>
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <Clock3 class="size-3.5 text-accent" />
                  Tiempo medio: <strong class="text-ink">{{ avgHours }}</strong>
                </span>
              </div>
            </section>

            <section class="card p-4">
              <h2 class="card-title">Salud del espacio</h2>
              <div class="space-y-2">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] hover:bg-surface-hover"
                  @click="openDetail('stale', 'Borradores sin tocar en 30 días')"
                >
                  <Clock3 class="size-4 text-warning" />
                  <span class="flex-1 text-ink-muted">Borradores sin tocar (30 días)</span>
                  <span class="font-semibold text-ink">{{ stats.health.staleDrafts }}</span>
                </button>
                <p class="px-2 text-[11.5px] text-ink-subtle">
                  Última actualización: {{ relativeTime(stats.generatedAt) }}
                </p>
              </div>
            </section>

            <section class="card p-4 lg:col-span-2">
              <h2 class="card-title">Plantillas más usadas</h2>
              <ul v-if="stats.topTemplates.length > 0" class="space-y-1.5">
                <li v-for="row in stats.topTemplates" :key="row.id ?? row.name">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-hover"
                    @click="openTemplate(row.id, row.name, row.count)"
                  >
                    <span class="min-w-0 flex-1 truncate text-ink">{{ row.name }}</span>
                    <span v-if="row.isShared" class="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">
                      Compartida
                    </span>
                    <span class="w-8 text-right font-medium tabular-nums text-ink">{{ row.count }}</span>
                  </button>
                </li>
              </ul>
              <p v-else class="text-[12.5px] text-ink-subtle">Sin plantillas en el periodo.</p>
            </section>
          </div>
        </template>

        <div v-else class="flex flex-col items-center gap-2 py-16 text-center">
          <Inbox class="size-8 text-ink-subtle" />
          <p class="text-[14px] font-medium text-ink">Todavía no hay actividad</p>
          <p class="max-w-sm text-[12.5px] text-ink-subtle">
            Crea tu primer documento y este panel se llenará solo.
          </p>
        </div>
      </template>
    </div>

    <StatsDetailDialog
      :open="detailOpen"
      :title="detailTitle"
      :query="detailQuery"
      @close="detailOpen = false"
    />
  </AppShell>
</template>

<style scoped>
.kpi {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-card, 12px);
  background: var(--color-surface);
  padding: 12px 14px;
  text-align: left;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

button.kpi:hover {
  border-color: var(--color-accent);
  box-shadow: 0 8px 24px -18px rgb(4 30 66 / 0.5);
}

.kpi-accent {
  border-left: 3px solid var(--color-accent);
}

.kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-ink-subtle);
}

.kpi-value {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}

.kpi-hint {
  font-size: 11.5px;
  color: var(--color-ink-subtle);
}

.card-title {
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-ink-subtle);
}

.mini {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  padding: 8px 10px;
  text-align: left;
  transition: border-color 150ms ease;
}

.mini:hover {
  border-color: var(--color-accent);
}

.mini-label {
  font-size: 10.5px;
  color: var(--color-ink-subtle);
}

.mini-value {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
