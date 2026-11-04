<script setup lang="ts">
import { Copy, MoreVertical, Palette, Pencil, Plus, Power, PowerOff, RotateCcw, Search, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import DesignPreview from '@/components/designs/DesignPreview.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import { relativeTime } from '@/lib/labels';
import type { DesignRecord, ListResponse } from '@/types';

const router = useRouter();
const toast = useToast();

const designs = ref<DesignRecord[]>([]);
const loading = ref(true);
const search = ref('');
const status = ref<'all' | 'active' | 'inactive'>('all');
const deleting = ref<DesignRecord | null>(null);
const removing = ref(false);
const view = ref<'active' | 'trash'>('active');

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return designs.value;
  return designs.value.filter((design) => design.name.toLowerCase().includes(term));
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<ListResponse<DesignRecord>>('/designs', {
      status: view.value === 'active' ? status.value : undefined,
      trashed: view.value === 'trash' ? 'true' : undefined,
    });
    designs.value = data.items;
  } catch {
    toast.error('No se pudieron cargar los diseños');
  } finally {
    loading.value = false;
  }
}

async function clone(design: DesignRecord): Promise<void> {
  try {
    const data = await api.post<{ design: { id: string } }>(`/designs/${design.id}/clone`);
    toast.success('Diseño duplicado');
    await router.push({ name: 'design', params: { id: data.design.id } });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo duplicar');
  }
}

function openDesign(id: string): void {
  if (view.value === 'trash') return;
  void router.push({ name: 'design', params: { id } });
}

async function confirmDelete(): Promise<void> {
  if (!deleting.value || removing.value) return;
  removing.value = true;
  try {
    await api.del(`/designs/${deleting.value.id}`);
    designs.value = designs.value.filter((design) => design.id !== deleting.value?.id);
    toast.success('Diseño eliminado');
    deleting.value = null;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
  } finally {
    removing.value = false;
  }
}

async function restore(design: DesignRecord): Promise<void> {
  try {
    await api.post(`/designs/${design.id}/restore`);
    toast.success('Diseño restaurado');
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo restaurar');
  }
}

async function toggleActive(design: DesignRecord): Promise<void> {
  const next = !design.isActive;
  try {
    const data = await api.patch<{ design: { isActive: boolean } }>(
      `/designs/${design.id}/status`,
      { isActive: next },
    );
    designs.value = designs.value.map((item) =>
      item.id === design.id ? { ...item, isActive: data.design.isActive } : item,
    );
    toast.success(data.design.isActive ? 'Diseño activado' : 'Diseño desactivado');
    if (status.value !== 'all' && (status.value === 'active') !== data.design.isActive) {
      await load();
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado');
  }
}

watch([view, status], () => void load());

onMounted(load);
</script>

<template>
  <AppShell>
    <PageHeader title="Diseños" subtitle="Tipografía, colores, márgenes y membrete de tus documentos.">
      <template #actions>
        <button v-if="view === 'active'" type="button" class="btn btn-primary" @click="router.push({ name: 'design', params: { id: 'new' } })">
          <Plus class="size-4" />
          Nuevo diseño
        </button>
      </template>
    </PageHeader>

    <div class="mx-auto max-w-[1200px] px-5 pb-14 pt-2 sm:px-8">
      <div class="mb-5 flex items-center gap-2">
        <div class="relative flex-1 sm:max-w-sm">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input v-model="search" class="field pl-9" placeholder="Buscar diseño…" />
        </div>
        <select v-if="view === 'active'" v-model="status" class="field w-auto min-w-[135px]">
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
        <button
          type="button"
          :class="['btn btn-sm', view === 'trash' ? 'btn-primary' : 'btn-outline']"
          @click="view = view === 'active' ? 'trash' : 'active'"
        >
          <Trash2 class="size-4" />
          {{ view === 'trash' ? 'Volver' : 'Papelera' }}
        </button>
      </div>

      <div v-if="loading" class="grid place-items-center py-20">
        <BaseSpinner label="Cargando diseños…" />
      </div>

      <EmptyState
        v-else-if="filtered.length === 0"
        :icon="Palette"
        :title="view === 'trash' ? 'La papelera está vacía' : 'No hay diseños'"
        :description="
          view === 'trash'
            ? 'Los diseños que elimines aparecerán aquí y podrás restaurarlos.'
            : 'Crea un diseño para definir la identidad visual de tus documentos.'
        "
      >
        <button v-if="view === 'active'" type="button" class="btn btn-primary" @click="router.push({ name: 'design', params: { id: 'new' } })">
          <Plus class="size-4" />
          Nuevo diseño
        </button>
      </EmptyState>

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="design in filtered"
          :key="design.id"
          class="card group flex flex-col transition-shadow hover:shadow-pop"
        >
          <button
            type="button"
            class="flex justify-center overflow-hidden rounded-t-[var(--radius-card)] bg-[#eef1f5] p-3"
            :class="{ 'cursor-default': view === 'trash' }"
            @click="openDesign(design.id)"
          >
            <DesignPreview :tokens="design.tokens" :scale="0.34" />
          </button>

          <div class="flex flex-1 items-start gap-1 px-3 pb-3 pt-2.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] font-medium">{{ design.name }}</p>
              <p class="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-ink-subtle">
                <span class="truncate">{{ design.tokens.fontFamily.split(',')[0] }} · {{ design.tokens.pageFormat }}</span>
                <span
                  :class="[
                    'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    design.isActive ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
                  ]"
                >
                  {{ design.isActive ? 'Activo' : 'Inactivo' }}
                </span>
              </p>
              <div class="mt-2 flex items-center gap-1">
                <span
                  v-for="color in [design.tokens.primaryColor, design.tokens.accentColor, design.tokens.tableHeadColor, design.tokens.tableBorderColor]"
                  :key="color"
                  class="size-3.5 rounded-full border border-black/10"
                  :style="{ background: color }"
                />
                <span class="ml-auto text-[10.5px] text-ink-subtle">
                  {{ view === 'trash' ? `Eliminado ${relativeTime(design.deletedAt ?? design.updatedAt)}` : relativeTime(design.updatedAt) }}
                </span>
              </div>
            </div>

            <BaseDropdown align="right" width="w-44">
              <template #trigger>
                <button
                  type="button"
                  class="rounded-md p-1 text-ink-subtle opacity-0 transition-all hover:bg-surface-hover hover:text-ink group-hover:opacity-100 focus:opacity-100"
                  aria-label="Acciones del diseño"
                >
                  <MoreVertical class="size-4" />
                </button>
              </template>
              <template #content>
                <template v-if="view === 'active'">
                  <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="openDesign(design.id)">
                    <Pencil class="size-4" />
                    Editar
                  </button>
                  <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="clone(design)">
                    <Copy class="size-4" />
                    Duplicar
                  </button>
                  <button
                    v-if="design.isMine"
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
                    @click="toggleActive(design)"
                  >
                    <component :is="design.isActive ? PowerOff : Power" class="size-4" />
                    {{ design.isActive ? 'Desactivar' : 'Activar' }}
                  </button>
                  <button v-if="design.isMine" type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-danger hover:bg-danger-soft" @click="deleting = design">
                    <Trash2 class="size-4" />
                    Eliminar
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-accent hover:bg-accent-soft"
                  @click="restore(design)"
                >
                  <RotateCcw class="size-4" />
                  Restaurar
                </button>
              </template>
            </BaseDropdown>
          </div>
        </article>
      </div>
    </div>

    <BaseModal
      :open="deleting !== null"
      title="Eliminar diseño"
      :description="deleting ? `«${deleting.name}» se moverá a la papelera.` : undefined"
      size="sm"
      @close="deleting = null"
    >
      <p class="text-[13px] text-ink-muted">Los documentos existentes conservan el diseño con el que se crearon. Puedes recuperarlo desde la papelera.</p>
      <template #footer>
        <button type="button" class="btn btn-outline" @click="deleting = null">Cancelar</button>
        <button type="button" class="btn btn-danger" :disabled="removing" @click="confirmDelete">
          {{ removing ? 'Eliminando…' : 'Eliminar' }}
        </button>
      </template>
    </BaseModal>
  </AppShell>
</template>
