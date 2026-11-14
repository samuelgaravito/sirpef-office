<script setup lang="ts">
import { Copy, LayoutTemplate, Loader2, MoreVertical, Pencil, Plus, Power, PowerOff, RotateCcw, Search, Share2, Sparkles, Trash2, Wand2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import NewTemplateDialog from '@/components/templates/NewTemplateDialog.vue';
import TemplatePreview from '@/components/templates/TemplatePreview.vue';
import TemplateShareDialog from '@/components/templates/TemplateShareDialog.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import { docTypeLabel, relativeTime } from '@/lib/labels';
import { useAuthStore } from '@/stores/auth';
import type { ListResponse, ShareRecord, TemplateSummary } from '@/types';

const router = useRouter();
const toast = useToast();
const auth = useAuthStore();
const { creating, createDocument } = useCreateDocument();

const templates = ref<TemplateSummary[]>([]);
const loading = ref(true);
const search = ref('');
const templateId = ref('');
const status = ref<'all' | 'active' | 'inactive'>('all');
const scope = ref<'all' | 'mine' | 'shared'>('all');
const deleting = ref<TemplateSummary | null>(null);
const removing = ref(false);
const newTemplateOpen = ref(false);
const view = ref<'active' | 'trash'>('active');
/**
 * «Usar» es el modo por defecto: la tarjeta crea un documento, no edita el
 * modelo. «Administrar» deja el editor de plantillas para quien las mantiene.
 */
const mode = ref<'use' | 'manage'>('use');
/** Plantilla cuyos accesos se están gestionando. */
const sharing = ref<TemplateSummary | null>(null);
const shares = ref<ShareRecord[]>([]);

const filtered = computed(() =>
  templateId.value
    ? templates.value.filter((template) => template.id === templateId.value)
    : templates.value,
);

/** ¿Puede este usuario editar la plantilla? (propietario, editor o admin) */
function canEditTemplate(template: TemplateSummary): boolean {
  if (template.permission) return template.permission !== 'viewer';
  return Boolean(template.isMine) || auth.isAdmin;
}

/** La plantilla es del usuario: puede gestionar quién la mejora. */
function ownsTemplate(template: TemplateSummary): boolean {
  if (template.permission) return template.permission === 'owner';
  return Boolean(template.isMine);
}

/**
 * ¿Puede activar o desactivar la plantilla?
 *
 * El propietario sí; el administrador también, como antes, pero solo sobre
 * plantillas compartidas (las privadas de otro usuario ni se listan).
 */
function canToggleActive(template: TemplateSummary): boolean {
  if (ownsTemplate(template)) return true;
  return auth.isAdmin && template.isShared;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<ListResponse<TemplateSummary>>('/templates', {
      q: search.value.trim() || undefined,
      // En modo «Usar» solo interesan los modelos disponibles para crear.
      status: view.value === 'active' ? (mode.value === 'use' ? 'active' : status.value) : undefined,
      scope: view.value === 'active' && mode.value === 'manage' ? scope.value : undefined,
      trashed: view.value === 'trash' ? 'true' : undefined,
    });
    templates.value = data.items;
  } catch (error) {
    toast.failure(error, 'No se pudieron cargar las plantillas');
  } finally {
    loading.value = false;
  }
}

let timer: number | undefined;
watch(search, () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void load(), 300);
});
watch([scope, status], () => {
  templateId.value = '';
  void load();
});
watch(view, () => {
  templateId.value = '';
  void load();
});
watch(mode, () => {
  templateId.value = '';
  if (mode.value === 'use') view.value = 'active';
  void load();
});

function startNewTemplate(designId: string | null): void {
  newTemplateOpen.value = false;
  void router.push({
    name: 'template-new',
    query: designId ? { designId } : {},
  });
}

function openTemplate(id: string): void {
  if (view.value === 'trash') return;
  void router.push({ name: 'template', params: { id } });
}

/**
 * Clic en la tarjeta. En «Usar» crea el documento con ese modelo; en
 * «Administrar» abre el editor de la plantilla.
 */
function useTemplateCard(template: TemplateSummary): void {
  if (view.value === 'trash') return;
  if (mode.value === 'manage') {
    openTemplate(template.id);
    return;
  }
  if (!template.isActive || creating.value !== null) return;
  void createDocument(template.id);
}

/** Abre el editor nuevo con el asistente de redacción ya desplegado. */
function useTemplateWithAI(template: TemplateSummary): void {
  if (view.value === 'trash' || mode.value !== 'use') return;
  if (!template.isActive || creating.value !== null) return;
  void createDocument(template.id, { ai: true });
}

async function clone(template: TemplateSummary): Promise<void> {
  try {
    const data = await api.post<{ template: { id: string } }>(`/templates/${template.id}/clone`);
    toast.success('Plantilla duplicada');
    await router.push({ name: 'template', params: { id: data.template.id } });
  } catch (error) {
    toast.failure(error, 'No se pudo duplicar');
  }
}

async function confirmDelete(): Promise<void> {
  if (!deleting.value || removing.value) return;
  removing.value = true;
  try {
    await api.del(`/templates/${deleting.value.id}`);
    templates.value = templates.value.filter((template) => template.id !== deleting.value?.id);
    toast.success('Plantilla eliminada');
    deleting.value = null;
  } catch (error) {
    toast.failure(error, 'No se pudo eliminar');
  } finally {
    removing.value = false;
  }
}

async function restore(template: TemplateSummary): Promise<void> {
  try {
    await api.post(`/templates/${template.id}/restore`);
    toast.success('Plantilla restaurada');
    await load();
  } catch (error) {
    toast.failure(error, 'No se pudo restaurar');
  }
}

async function toggleActive(template: TemplateSummary): Promise<void> {
  const next = !template.isActive;
  try {
    const data = await api.patch<{ template: { isActive: boolean } }>(
      `/templates/${template.id}/status`,
      { isActive: next },
    );
    templates.value = templates.value.map((item) =>
      item.id === template.id ? { ...item, isActive: data.template.isActive } : item,
    );
    toast.success(data.template.isActive ? 'Plantilla activada' : 'Plantilla desactivada');
    if (status.value !== 'all' && (status.value === 'active') !== data.template.isActive) {
      await load();
    }
  } catch (error) {
    toast.failure(error, 'No se pudo cambiar el estado');
  }
}

/** Abre el diálogo de compartición de una plantilla propia. */
async function openShare(template: TemplateSummary): Promise<void> {
  sharing.value = template;
  shares.value = [];
  try {
    const data = await api.get<ListResponse<ShareRecord>>(`/templates/${template.id}/shares`);
    shares.value = data.items;
  } catch (error) {
    toast.failure(error, 'No se pudieron cargar los accesos');
  }
}

async function reloadShares(): Promise<void> {
  if (!sharing.value) return;
  try {
    const data = await api.get<ListResponse<ShareRecord>>(`/templates/${sharing.value.id}/shares`);
    shares.value = data.items;
  } catch {
    /* la lista mostrada sigue siendo válida */
  }
}

onMounted(load);
</script>

<template>
  <AppShell>
    <PageHeader
      title="Plantillas"
      :subtitle="
        mode === 'use'
          ? 'Elige un modelo para crear un documento nuevo. Editar el modelo es una acción aparte.'
          : 'Modelos reutilizables con variables y diseño propio. Aquí sí se editan.'
      "
    >
      <template #actions>
        <div class="flex items-center gap-1 rounded-lg border border-hairline bg-surface p-1">
          <button
            v-for="option in [
              { value: 'use', label: 'Usar' },
              { value: 'manage', label: 'Administrar' },
            ]"
            :key="option.value"
            type="button"
            :class="[
              'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              mode === option.value ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-hover',
            ]"
            @click="mode = option.value as typeof mode"
          >
            {{ option.label }}
          </button>
        </div>
        <button
          v-if="view === 'active' && mode === 'manage'"
          type="button"
          class="btn btn-primary"
          @click="newTemplateOpen = true"
        >
          <Plus class="size-4" />
          Nueva plantilla
        </button>
      </template>
    </PageHeader>

    <div class="mx-auto max-w-[1200px] px-5 pb-14 pt-2 sm:px-8">
      <div class="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div class="relative flex-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            v-model="search"
            class="field pl-9"
            :placeholder="mode === 'use' ? 'Buscar un modelo…' : 'Buscar plantilla…'"
          />
        </div>
        <select v-if="mode === 'manage'" v-model="templateId" class="field sm:w-[230px]">
          <option value="">Todas las plantillas</option>
          <option v-for="template in templates" :key="template.id" :value="template.id">
            {{ template.name }}
          </option>
        </select>
        <select v-if="view === 'active' && mode === 'manage'" v-model="status" class="field sm:w-[145px]">
          <option value="all">Todas</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
        </select>
        <div v-if="view === 'active' && mode === 'manage'" class="flex items-center gap-1 rounded-lg border border-hairline bg-surface p-1">
          <button
            v-for="option in [
              { value: 'all', label: 'Todas' },
              { value: 'mine', label: 'Mías' },
              { value: 'shared', label: 'Compartidas' },
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
          v-if="mode === 'manage' || view === 'trash'"
          type="button"
          :class="['btn btn-sm', view === 'trash' ? 'btn-primary' : 'btn-outline']"
          @click="view = view === 'active' ? 'trash' : 'active'"
        >
          <Trash2 class="size-4" />
          {{ view === 'trash' ? 'Volver' : 'Papelera' }}
        </button>
      </div>

      <div v-if="loading" class="grid place-items-center py-20">
        <BaseSpinner label="Cargando plantillas…" />
      </div>

      <EmptyState
        v-else-if="filtered.length === 0"
        :icon="LayoutTemplate"
        :title="
          view === 'trash'
            ? 'La papelera está vacía'
            : search || templateId || status !== 'all'
              ? 'Sin resultados'
              : mode === 'use'
                ? 'No hay modelos disponibles'
                : 'No hay plantillas'
        "
        :description="
          view === 'trash'
            ? 'Las plantillas que elimines aparecerán aquí y podrás restaurarlas.'
            : search || templateId || status !== 'all'
              ? 'Prueba con otro término o quita los filtros.'
              : mode === 'use'
                ? 'Puedes crear una hoja en blanco desde «Crear documento» en Inicio, pero no tendrá numeración.'
                : 'Crea una plantilla con variables para generar documentos con un clic.'
        "
      >
        <button
          v-if="view === 'active' && mode === 'manage'"
          type="button"
          class="btn btn-primary"
          @click="newTemplateOpen = true"
        >
          <Plus class="size-4" />
          Nueva plantilla
        </button>
      </EmptyState>

      <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <article
          v-for="template in filtered"
          :key="template.id"
          class="card group flex flex-col transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-pop"
        >
          <button
            type="button"
            class="flex justify-center overflow-hidden rounded-t-[7px] border-b border-hairline bg-[#e9eef5] px-2.5 pb-2.5 pt-2.5 shadow-[inset_0_1px_3px_rgb(4_30_66/0.06)]"
            :class="{ 'cursor-default': view === 'trash' }"
            :aria-label="mode === 'use' ? `Crear documento con ${template.name}` : `Abrir ${template.name}`"
            @click="useTemplateCard(template)"
          >
            <TemplatePreview
              :template-id="template.id"
              :design-id="template.designId"
              :design-updated-at="template.designUpdatedAt"
              :effective-design-id="template.effectiveDesignId"
              :effective-design-updated-at="template.effectiveDesignUpdatedAt"
              :version="template.version"
              :tokens="template.designTokens"
              :scale="0.28"
              :title="template.name"
            />
          </button>

          <div class="flex flex-1 flex-col px-3 pb-3 pt-2.5">
            <div class="flex items-start gap-1">
              <button
                type="button"
                class="min-w-0 flex-1 text-left"
                @click="useTemplateCard(template)"
              >
                <p class="truncate text-[15px] font-medium transition-colors group-hover:text-accent">{{ template.name }}</p>
                <p class="text-meta mt-0.5 flex items-center gap-1.5 truncate">
                  <span class="truncate">{{ docTypeLabel(template.docType) }} · v{{ template.version }}</span>
                  <span
                    v-if="mode === 'manage' || !template.isActive"
                    :class="[
                      'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      template.isActive ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
                    ]"
                  >
                    {{ template.isActive ? 'Activa' : 'Inactiva' }}
                  </span>
                  <span
                    v-if="mode === 'manage' && canEditTemplate(template) && !ownsTemplate(template)"
                    class="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                    title="Puedes mejorar esta plantilla"
                  >
                    Editable
                  </span>
                </p>
                <p
                  v-if="mode === 'manage' && template.effectiveDesignName"
                  class="text-meta mt-1 truncate"
                  :title="`Dibuja con «${template.effectiveDesignName}», el diseño en uso`"
                >
                  Dibuja con {{ template.effectiveDesignName }}
                </p>
              </button>

              <BaseDropdown v-if="mode === 'manage'" align="right" width="w-48">
                <template #trigger>
                  <button
                    type="button"
                    class="rounded-md p-1 text-ink-subtle opacity-0 transition-all hover:bg-surface-hover hover:text-ink group-hover:opacity-100 focus:opacity-100"
                    aria-label="Acciones de la plantilla"
                  >
                    <MoreVertical class="size-4" />
                  </button>
                </template>
                <template #content>
                  <template v-if="view === 'active'">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink disabled:cursor-wait disabled:opacity-60"
                      :disabled="creating !== null || !template.isActive"
                      :title="template.isActive ? undefined : 'Activa la plantilla para crear documentos'"
                      @click="createDocument(template.id)"
                    >
                      <component :is="creating === template.id ? Loader2 : Wand2" :class="['size-4', creating === template.id ? 'animate-spin' : '']" />
                      {{ creating === template.id ? 'Creando…' : 'Crear documento' }}
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-accent hover:bg-accent-soft disabled:cursor-wait disabled:opacity-60"
                      :disabled="creating !== null || !template.isActive"
                      @click="createDocument(template.id, { ai: true })"
                    >
                      <Sparkles class="size-4" />
                      Redactar con IA
                    </button>
                    <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="openTemplate(template.id)">
                      <Pencil class="size-4" />
                      {{ canEditTemplate(template) ? 'Editar' : 'Ver' }}
                    </button>
                    <button
                      v-if="ownsTemplate(template)"
                      type="button"
                      class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
                      @click="openShare(template)"
                    >
                      <Share2 class="size-4" />
                      Compartir
                    </button>
                    <button
                      v-if="canToggleActive(template)"
                      type="button"
                      class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
                      @click="toggleActive(template)"
                    >
                      <component :is="template.isActive ? PowerOff : Power" class="size-4" />
                      {{ template.isActive ? 'Desactivar' : 'Activar' }}
                    </button>
                    <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="clone(template)">
                      <Copy class="size-4" />
                      Duplicar
                    </button>
                    <button v-if="template.isMine" type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-danger hover:bg-danger-soft" @click="deleting = template">
                      <Trash2 class="size-4" />
                      Eliminar
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-accent hover:bg-accent-soft"
                    @click="restore(template)"
                  >
                    <RotateCcw class="size-4" />
                    Restaurar
                  </button>
                </template>
              </BaseDropdown>
            </div>

            <p class="text-description mt-2 line-clamp-2">
              {{ template.description || 'Sin descripción' }}
            </p>

            <div class="mt-3 flex items-center justify-between">
              <span class="text-meta">
                {{ view === 'trash' ? `Eliminada ${relativeTime(template.deletedAt ?? template.updatedAt)}` : relativeTime(template.updatedAt) }}
              </span>
              <div class="flex items-center gap-1">
              <button
                v-if="view === 'active' && mode === 'use'"
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="creating !== null || !template.isActive"
                title="Redactar este documento con el asistente"
                @click="useTemplateWithAI(template)"
              >
                <Sparkles class="size-3.5" />
                IA
              </button>
              <button
                v-if="view === 'active'"
                type="button"
                class="btn btn-outline btn-sm"
                :disabled="mode === 'use' && (creating !== null || !template.isActive)"
                :title="template.isActive ? undefined : 'Activa la plantilla para crear documentos'"
                @click="useTemplateCard(template)"
              >
                <component
                  :is="creating === template.id ? Loader2 : mode === 'use' ? Wand2 : Pencil"
                  :class="['size-3.5', creating === template.id ? 'animate-spin' : '']"
                />
                {{
                  creating === template.id
                    ? 'Creando…'
                    : mode === 'use'
                      ? 'Crear documento'
                      : canEditTemplate(template)
                        ? 'Editar'
                        : 'Ver'
                }}
              </button>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>

    <NewTemplateDialog
      :open="newTemplateOpen"
      @close="newTemplateOpen = false"
      @select="startNewTemplate"
    />

    <TemplateShareDialog
      v-if="sharing"
      :open="sharing !== null"
      :template-id="sharing.id"
      :shares="shares"
      @close="sharing = null"
      @changed="reloadShares"
    />

    <BaseModal
      :open="deleting !== null"
      title="Eliminar plantilla"
      :description="deleting ? `«${deleting.name}» se moverá a la papelera.` : undefined"
      size="sm"
      @close="deleting = null"
    >
      <p class="text-[13px] text-ink-muted">Los documentos ya creados con esta plantilla no se verán afectados. Puedes recuperarla desde la papelera.</p>
      <template #footer>
        <button type="button" class="btn btn-outline" @click="deleting = null">Cancelar</button>
        <button type="button" class="btn btn-danger" :disabled="removing" @click="confirmDelete">
          {{ removing ? 'Eliminando…' : 'Eliminar' }}
        </button>
      </template>
    </BaseModal>
  </AppShell>
</template>
