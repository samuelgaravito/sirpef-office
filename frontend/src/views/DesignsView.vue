<script setup lang="ts">
import { Copy, MoreVertical, Palette, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import DesignPreview from '@/components/designs/DesignPreview.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
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
const deleting = ref<DesignRecord | null>(null);
const removing = ref(false);
const view = ref<'active' | 'trash'>('active');
/** Interruptor «en uso»: solo uno por cuenta. */
const switching = ref<string | null>(null);

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return designs.value;
  return designs.value.filter((design) => design.name.toLowerCase().includes(term));
});

/** Diseño que está en uso ahora mismo (de esta cuenta). */
const activeDesign = computed(
  () => designs.value.find((design) => design.isCurrent) ?? null,
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<ListResponse<DesignRecord>>('/designs', {
      trashed: view.value === 'trash' ? 'true' : undefined,
    });
    designs.value = data.items;
  } catch (error) {
    toast.failure(error, 'No se pudieron cargar los diseños');
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
    toast.failure(error, 'No se pudo duplicar');
  }
}

/**
 * Interruptor «en uso».
 *
 * Al encender un diseño se apaga el que lo estuviera: solo puede haber uno y
 * es el con el que se dibujan todas las plantillas. Los documentos ya
 * creados conservan el diseño con el que nacieron.
 *
 * El cambio se aplica en local (sin recargar la lista) para que el
 * interruptor se deslice y las tarjetas no cambien de sitio; si el servidor
 * responde con error, se revierte.
 */
async function toggleCurrent(design: DesignRecord, next: boolean): Promise<void> {
  if (switching.value) return;
  switching.value = design.id;

  const previous = designs.value;
  designs.value = designs.value.map((item) => {
    if (item.id === design.id) return { ...item, isCurrent: next };
    // Al encender un diseño, el resto se apaga.
    return next ? { ...item, isCurrent: false } : item;
  });

  try {
    await api.post<{ design: { isCurrent: boolean } }>(`/designs/${design.id}/activate`, {
      isCurrent: next,
    });
    toast.success(
      next
        ? `«${design.name}» está en uso: todas las plantillas se dibujan con él`
        : `«${design.name}» ya no está en uso`,
    );
  } catch (error) {
    designs.value = previous;
    toast.failure(error, 'No se pudo cambiar el diseño en uso');
  } finally {
    switching.value = null;
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
    toast.failure(error, 'No se pudo eliminar');
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
    toast.failure(error, 'No se pudo restaurar');
  }
}

watch([view], () => void load());

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
        <button
          type="button"
          :class="['btn btn-sm', view === 'trash' ? 'btn-primary' : 'btn-outline']"
          @click="view = view === 'active' ? 'trash' : 'active'"
        >
          <Trash2 class="size-4" />
          {{ view === 'trash' ? 'Volver' : 'Papelera' }}
        </button>
      </div>

      <p
        v-if="view === 'active' && activeDesign"
        class="mb-4 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[12.5px] text-accent"
      >
        <strong>{{ activeDesign.name }}</strong> está en uso: todas las plantillas se dibujan con él.
        Los documentos ya creados conservan el diseño con el que se hicieron.
      </p>

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

          <!-- Interruptor «en uso»: solo uno por cuenta. -->
          <div
            v-if="view === 'active' && design.isMine"
            class="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2"
          >
            <span class="text-[12px] font-medium text-ink-muted">En uso</span>
            <BaseSwitch
              :model-value="design.isCurrent"
              :disabled="switching !== null"
              :label="`Poner «${design.name}» en uso`"
              @update:model-value="(value) => toggleCurrent(design, value)"
            />
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
