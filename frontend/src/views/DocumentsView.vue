<script setup lang="ts">
import { ArrowLeft, CalendarDays, ChevronDown, FileText, Loader2, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import DocumentCard from '@/components/documents/DocumentCard.vue';
import NewDocumentDialog from '@/components/documents/NewDocumentDialog.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import {
  DATE_PRESETS,
  dateFilterLabel,
  endOfDayIso,
  formatDayLabel,
  isPresetActive,
  presetRange,
  startOfDayIso,
  type DatePreset,
} from '@/lib/date-presets';
import { STATUS_LABELS } from '@/lib/labels';
import type { DocumentStatus, DocumentSummary, ListResponse, TemplateSummary } from '@/types';

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { creating, createDocument } = useCreateDocument();

const documents = ref<DocumentSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 12;
const loading = ref(true);

const search = ref('');
const scope = ref<'all' | 'mine' | 'shared'>('all');
const templateId = ref('');
const templates = ref<TemplateSummary[]>([]);
/** El panel estadístico puede abrir el listado ya filtrado por estado. */
const statusParam = typeof route.query.status === 'string' ? route.query.status : '';
const status = ref<DocumentStatus | ''>(
  statusParam in STATUS_LABELS ? (statusParam as DocumentStatus) : '',
);
const sort = ref<'updated' | 'created' | 'title'>('updated');
const dateField = ref<'created' | 'updated'>('updated');
/** Permite cerrar el panel de fecha al elegir un atajo. */
const dateDropdown = ref<{ close: () => void } | null>(null);
const dateFrom = ref('');
const dateTo = ref('');
/** `?view=trash` abre directamente la papelera. */
const view = ref<'active' | 'trash'>(route.query.view === 'trash' ? 'trash' : 'active');

const deleting = ref<DocumentSummary | null>(null);
const removing = ref(false);
/** Selector de modelo: la puerta de entrada para crear un documento. */
const pickerOpen = ref(false);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

const dateRangeInvalid = computed(
  () => Boolean(dateFrom.value && dateTo.value && dateFrom.value > dateTo.value),
);

const dateSummary = computed(() => {
  if (!dateFrom.value && !dateTo.value) return '';
  if (dateFrom.value && dateTo.value) {
    return ` · del ${formatDayLabel(dateFrom.value)} al ${formatDayLabel(dateTo.value)}`;
  }
  if (dateFrom.value) return ` · desde el ${formatDayLabel(dateFrom.value)}`;
  return ` · hasta el ${formatDayLabel(dateTo.value)}`;
});

const subtitle = computed(() =>
  view.value === 'trash'
    ? `${total.value} documento${total.value === 1 ? '' : 's'} en la papelera`
    : `${total.value} documento${total.value === 1 ? '' : 's'} en tu espacio de trabajo${dateSummary.value}`,
);

function applyDatePreset(preset: DatePreset): void {
  const range = presetRange(preset);
  dateFrom.value = range.from;
  dateTo.value = range.to;
  dateDropdown.value?.close();
}

const dateFilterActive = computed(() => Boolean(dateFrom.value || dateTo.value));

const dateButtonLabel = computed(() => dateFilterLabel(dateFrom.value, dateTo.value));

/** Cuántos filtros del panel avanzado están activos. */
const advancedFilterCount = computed(
  () => (templateId.value ? 1 : 0) + (status.value ? 1 : 0),
);

function clearAdvancedFilters(): void {
  templateId.value = '';
  status.value = '';
  sort.value = 'updated';
}

function clearDates(): void {
  dateFrom.value = '';
  dateTo.value = '';
}

let searchTimer: number | undefined;

async function loadTemplates(): Promise<void> {
  try {
    const items: TemplateSummary[] = [];
    let currentPage = 1;
    for (;;) {
      const data = await api.get<ListResponse<TemplateSummary>>('/templates', {
        scope: 'all',
        status: 'all',
        page: currentPage,
        pageSize: 100,
      });
      items.push(...data.items);
      if (!data.total || items.length >= data.total || data.items.length === 0) break;
      currentPage += 1;
    }
    templates.value = items;
  } catch (error) {
    toast.failure(error, 'No se pudieron cargar las plantillas para el filtro');
  }
}

async function load(): Promise<void> {
  // Con un rango invertido no se consulta: el aviso ya explica qué corregir.
  if (dateRangeInvalid.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const data = await api.get<ListResponse<DocumentSummary>>('/documents', {
      page: page.value,
      pageSize,
      sort: sort.value,
      scope: view.value === 'active' ? scope.value : undefined,
      trashed: view.value === 'trash' ? 'true' : undefined,
      q: search.value.trim() || undefined,
      templateId: templateId.value || undefined,
      status: status.value || undefined,
      dateField: dateFrom.value || dateTo.value ? dateField.value : undefined,
      dateFrom: dateFrom.value ? startOfDayIso(dateFrom.value) : undefined,
      dateTo: dateTo.value ? endOfDayIso(dateTo.value) : undefined,
    });
    documents.value = data.items;
    total.value = data.total ?? data.items.length;
  } catch (error) {
    toast.failure(error, 'No se pudieron cargar los documentos');
  } finally {
    loading.value = false;
  }
}

watch(scope, () => {
  page.value = 1;
  void load();
});

watch([templateId, status, sort], () => {
  page.value = 1;
  void load();
});

watch([dateField, dateFrom, dateTo], () => {
  if (dateRangeInvalid.value) return;
  page.value = 1;
  void load();
});

watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});

watch(page, () => void load());

watch(view, () => {
  page.value = 1;
  void load();
});

function openDocument(id: string): void {
  void router.push({ name: 'document', params: { id } });
}

/** El selector entrega `null` para la hoja en blanco. */
function onCreate(templateId: string | null): void {
  void createDocument(templateId ?? undefined);
}

async function confirmDelete(): Promise<void> {
  if (!deleting.value || removing.value) return;
  removing.value = true;
  try {
    await api.del(`/documents/${deleting.value.id}`);
    toast.success('Documento eliminado');
    deleting.value = null;
    await load();
  } catch (error) {
    toast.failure(error, 'No se pudo eliminar');
  } finally {
    removing.value = false;
  }
}

function duplicate(document: DocumentSummary): void {
  void document;
  toast.info('Abre el documento y usa «Guardar como plantilla» para reutilizarlo.');
}

async function restore(document: DocumentSummary): Promise<void> {
  try {
    await api.post(`/documents/${document.id}/restore`);
    toast.success('Documento restaurado');
    await load();
  } catch (error) {
    toast.failure(error, 'No se pudo restaurar');
  }
}

onMounted(() => {
  void loadTemplates();
  void load();
});
</script>

<template>
  <AppShell>
    <PageHeader title="Documentos" :subtitle="subtitle">
      <template #actions>
        <button v-if="view === 'active'" type="button" class="btn btn-primary" :disabled="creating !== null" @click="pickerOpen = true">
          <component :is="creating === 'blank' ? Loader2 : Plus" :class="['size-4', creating === 'blank' ? 'animate-spin' : '']" />
          {{ creating === 'blank' ? 'Creando…' : 'Crear documento' }}
        </button>
      </template>
    </PageHeader>

    <div class="mx-auto max-w-[1200px] px-5 pb-14 pt-2 sm:px-8">
      <!-- Barra de filtros -->
      <div class="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-[#f8fafc] p-2.5">
        <div class="relative min-w-[240px] flex-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input v-model="search" class="field pl-9" placeholder="Buscar por título o descripción…" />
        </div>

        <div
          v-if="view === 'active'"
          class="flex items-center gap-1 rounded-lg border border-hairline bg-surface p-1"
        >
          <button
            v-for="option in [
              { value: 'all', label: 'Todos' },
              { value: 'mine', label: 'Míos' },
              { value: 'shared', label: 'Compartidos' },
            ]"
            :key="option.value"
            type="button"
            :class="[
              'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              scope === option.value ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-hover',
            ]"
            @click="scope = option.value as typeof scope"
          >
            {{ option.label }}
          </button>
        </div>

        <!-- Fecha -->
        <BaseDropdown ref="dateDropdown" align="right" width="w-80" :close-on-click="false">
          <template #trigger>
            <button
              type="button"
              :class="[
                'btn btn-sm whitespace-nowrap',
                dateFilterActive
                  ? 'btn-outline !border-accent/40 !bg-accent-soft !text-accent'
                  : 'btn-outline',
              ]"
            >
              <CalendarDays class="size-4" />
              {{ dateButtonLabel }}
              <ChevronDown class="size-3" />
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
                  @click="applyDatePreset(preset.value)"
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
                  <input v-model="dateFrom" type="date" class="field" :max="dateTo || undefined" />
                </label>
                <label class="block">
                  <span class="label">Hasta</span>
                  <input v-model="dateTo" type="date" class="field" :min="dateFrom || undefined" />
                </label>
              </div>

              <label class="mt-3 block">
                <span class="label">Aplicar a</span>
                <select v-model="dateField" class="field">
                  <option value="updated">Última edición</option>
                  <option value="created">Fecha de creación</option>
                </select>
              </label>

              <p v-if="dateRangeInvalid" class="mt-2 text-[12.5px] font-medium text-danger">
                La fecha inicial no puede ser posterior a la final.
              </p>

              <div class="mt-3 flex items-center justify-between border-t border-hairline pt-2.5">
                <span class="text-meta">
                  {{ dateFilterActive ? dateButtonLabel : 'Sin filtro de fecha' }}
                </span>
                <button
                  v-if="dateFilterActive"
                  type="button"
                  class="text-[12.5px] font-medium text-danger hover:underline"
                  @click="clearDates"
                >
                  Limpiar fechas
                </button>
              </div>
            </div>
          </template>
        </BaseDropdown>

        <!-- Filtros avanzados -->
        <BaseDropdown align="right" width="w-72" :close-on-click="false">
          <template #trigger>
            <button
              type="button"
              :class="[
                'btn btn-sm',
                advancedFilterCount ? 'btn-outline !border-accent/40 !text-accent' : 'btn-outline',
              ]"
            >
              <SlidersHorizontal class="size-4" />
              Filtros
              <span
                v-if="advancedFilterCount"
                class="grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-white"
              >
                {{ advancedFilterCount }}
              </span>
            </button>
          </template>
          <template #content>
            <div class="space-y-2.5 p-2" @click.stop>
              <label class="block">
                <span class="label">Plantilla</span>
                <select v-model="templateId" class="field">
                  <option value="">Todas las plantillas</option>
                  <option v-for="template in templates" :key="template.id" :value="template.id">
                    {{ template.name }}
                  </option>
                </select>
              </label>

              <label class="block">
                <span class="label">Estado</span>
                <select v-model="status" class="field">
                  <option value="">Todos los estados</option>
                  <option v-for="(label, value) in STATUS_LABELS" :key="value" :value="value">
                    {{ label }}
                  </option>
                </select>
              </label>

              <label class="block">
                <span class="label">Ordenar por</span>
                <select v-model="sort" class="field">
                  <option value="updated">Última edición</option>
                  <option value="created">Más recientes</option>
                  <option value="title">Título (A-Z)</option>
                </select>
              </label>

              <button
                v-if="advancedFilterCount || sort !== 'updated'"
                type="button"
                class="text-[12.5px] font-medium text-danger hover:underline"
                @click="clearAdvancedFilters"
              >
                Limpiar filtros
              </button>
            </div>
          </template>
        </BaseDropdown>

        <!-- Papelera -->
        <button
          type="button"
          :class="['tool-btn', view === 'trash' ? '!bg-accent-soft !text-accent' : '']"
          :title="view === 'trash' ? 'Volver a documentos' : 'Papelera'"
          :aria-label="view === 'trash' ? 'Volver a documentos' : 'Papelera'"
          @click="view = view === 'active' ? 'trash' : 'active'"
        >
          <component :is="view === 'trash' ? ArrowLeft : Trash2" class="size-4" />
        </button>
      </div>

      <div v-if="loading" class="grid place-items-center py-20">
        <BaseSpinner label="Cargando documentos…" />
      </div>

      <EmptyState
        v-else-if="documents.length === 0"
        :icon="FileText"
        :title="view === 'trash' ? 'La papelera está vacía' : search || templateId || status ? 'Sin resultados' : 'Aún no hay documentos'"
        :description="
          view === 'trash'
            ? 'Los documentos que elimines aparecerán aquí y podrás restaurarlos.'
            : search || templateId || status
              ? 'Prueba con otro término o quita los filtros.'
              : 'Crea tu primer documento a partir de una plantilla.'
        "
      >
        <button v-if="view === 'active'" type="button" class="btn btn-primary" :disabled="creating !== null" @click="pickerOpen = true">
          <component :is="creating === 'blank' ? Loader2 : Plus" :class="['size-4', creating === 'blank' ? 'animate-spin' : '']" />
          {{ creating === 'blank' ? 'Creando…' : 'Crear documento' }}
        </button>
      </EmptyState>

      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <DocumentCard
          v-for="document in documents"
          :key="document.id"
          :document="document"
          :trashed="view === 'trash'"
          show-owner
          @open="openDocument"
          @delete="deleting = $event"
          @duplicate="duplicate"
          @restore="restore"
        />
      </div>

      <div v-if="totalPages > 1" class="mt-6 flex items-center justify-between">
        <p class="text-[12.5px] text-ink-muted">Página {{ page }} de {{ totalPages }}</p>
        <div class="flex gap-2">
          <button type="button" class="btn btn-outline btn-sm" :disabled="page <= 1" @click="page -= 1">
            Anterior
          </button>
          <button type="button" class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="page += 1">
            Siguiente
          </button>
        </div>
      </div>
    </div>

    <BaseModal
      :open="deleting !== null"
      title="Eliminar documento"
      :description="deleting ? `«${deleting.title}» se moverá a la papelera.` : undefined"
      size="sm"
      @close="deleting = null"
    >
      <p class="text-[13px] text-ink-muted">Puedes recuperarlo desde la papelera cuando quieras.</p>
      <template #footer>
        <button type="button" class="btn btn-outline" @click="deleting = null">Cancelar</button>
        <button type="button" class="btn btn-danger" :disabled="removing" @click="confirmDelete">
          {{ removing ? 'Eliminando…' : 'Eliminar' }}
        </button>
      </template>
    </BaseModal>

    <NewDocumentDialog
      :open="pickerOpen"
      @close="pickerOpen = false"
      @create="onCreate"
    />
  </AppShell>
</template>
