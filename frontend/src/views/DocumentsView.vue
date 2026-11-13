<script setup lang="ts">
import { CalendarDays, FileText, Loader2, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import DocumentCard from '@/components/documents/DocumentCard.vue';
import NewDocumentDialog from '@/components/documents/NewDocumentDialog.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import { STATUS_LABELS } from '@/lib/labels';
import type { DocumentStatus, DocumentSummary, ListResponse, TemplateSummary } from '@/types';

const router = useRouter();
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
const status = ref<DocumentStatus | ''>('');
const sort = ref<'updated' | 'created' | 'title'>('updated');
const dateField = ref<'created' | 'updated'>('updated');
const dateFrom = ref('');
const dateTo = ref('');
const filtersOpen = ref(false);
const view = ref<'active' | 'trash'>('active');

const deleting = ref<DocumentSummary | null>(null);
const removing = ref(false);
/** Selector de modelo: la puerta de entrada para crear un documento. */
const pickerOpen = ref(false);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

const dateRangeInvalid = computed(
  () => Boolean(dateFrom.value && dateTo.value && dateFrom.value > dateTo.value),
);

function formatDateInput(value: string): string {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const dateSummary = computed(() => {
  if (!dateFrom.value && !dateTo.value) return '';
  if (dateFrom.value && dateTo.value) {
    return ` · del ${formatDateInput(dateFrom.value)} al ${formatDateInput(dateTo.value)}`;
  }
  if (dateFrom.value) return ` · desde el ${formatDateInput(dateFrom.value)}`;
  return ` · hasta el ${formatDateInput(dateTo.value)}`;
});

const subtitle = computed(() =>
  view.value === 'trash'
    ? `${total.value} documento${total.value === 1 ? '' : 's'} en la papelera`
    : `${total.value} documento${total.value === 1 ? '' : 's'} en tu espacio de trabajo${dateSummary.value}`,
);

/** Convierte un día local en el instante UTC de su inicio o su final. */
function startOfDayIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function endOfDayIso(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type DatePreset = 'today' | '7d' | 'month' | 'lastMonth' | 'year';

/** Atajos de fecha calculados en el calendario local, no en UTC. */
function applyDatePreset(preset: DatePreset): void {
  const now = new Date();
  let from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let to = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === '7d') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  } else if (preset === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (preset === 'lastMonth') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (preset === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
  }

  dateFrom.value = toDateInput(from);
  dateTo.value = toDateInput(to);
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
      <div class="mb-5 rounded-xl border border-hairline bg-[#f8fafc] p-2.5">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div class="relative flex-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input v-model="search" class="field pl-9" placeholder="Buscar por título o descripción…" />
        </div>

        <div v-if="view === 'active'" class="flex items-center gap-1 rounded-lg border border-hairline bg-surface p-1">
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

        <button
          type="button"
          :class="['btn btn-sm', view === 'trash' ? 'btn-primary' : 'btn-outline']"
          @click="view = view === 'active' ? 'trash' : 'active'"
        >
          <Trash2 class="size-4" />
          {{ view === 'trash' ? 'Volver' : 'Papelera' }}
        </button>

        <button type="button" class="btn btn-outline lg:hidden" @click="filtersOpen = !filtersOpen">
          <SlidersHorizontal class="size-4" />
          Filtros
        </button>

        <div :class="['items-center gap-2', filtersOpen ? 'flex' : 'hidden lg:flex']">
          <select v-model="templateId" class="field w-auto min-w-[190px]">
            <option value="">Todas las plantillas</option>
            <option v-for="template in templates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </select>
          <select v-model="status" class="field w-auto min-w-[145px]">
            <option value="">Todos los estados</option>
            <option v-for="(label, value) in STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
          <select v-model="sort" class="field w-auto min-w-[140px]">
            <option value="updated">Última edición</option>
            <option value="created">Más recientes</option>
            <option value="title">Título (A-Z)</option>
          </select>
        </div>
        </div>

        <!-- Filtro por fechas -->
        <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <div class="flex w-full items-center gap-2 text-[12.5px] font-medium text-ink-muted xl:w-auto">
            <CalendarDays class="size-4 text-accent" />
            Filtrar por fecha
          </div>

          <select v-model="dateField" class="field w-auto min-w-[160px]">
            <option value="updated">Última edición</option>
            <option value="created">Fecha de creación</option>
          </select>

          <label class="flex items-center gap-2 text-[12.5px] text-ink-muted">
            Desde
            <input v-model="dateFrom" type="date" class="field w-auto" :max="dateTo || undefined" />
          </label>
          <label class="flex items-center gap-2 text-[12.5px] text-ink-muted">
            Hasta
            <input v-model="dateTo" type="date" class="field w-auto" :min="dateFrom || undefined" />
          </label>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="preset in [
                { value: 'today', label: 'Hoy' },
                { value: '7d', label: '7 días' },
                { value: 'month', label: 'Este mes' },
                { value: 'lastMonth', label: 'Mes anterior' },
                { value: 'year', label: 'Este año' },
              ]"
              :key="preset.value"
              type="button"
              class="rounded-full border border-hairline bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
              @click="applyDatePreset(preset.value as DatePreset)"
            >
              {{ preset.label }}
            </button>
            <button
              v-if="dateFrom || dateTo"
              type="button"
              class="px-1 text-[12.5px] font-medium text-danger hover:underline"
              @click="clearDates"
            >
              Limpiar
            </button>
          </div>

          <p v-if="dateRangeInvalid" class="text-[12.5px] font-medium text-danger xl:ml-auto">
            La fecha inicial no puede ser posterior a la final.
          </p>
        </div>
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
