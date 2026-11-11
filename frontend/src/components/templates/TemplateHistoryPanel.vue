<script setup lang="ts">
import { History, RotateCcw, X } from 'lucide-vue-next';
import { onBeforeUnmount, ref, watch } from 'vue';

import { api } from '@/api/client';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useToast } from '@/composables/useToast';
import { formatDateTime, relativeTime } from '@/lib/labels';
import type { ListResponse, TemplateVersionSummary } from '@/types';

const props = defineProps<{
  open: boolean;
  templateId: string;
  /** Versión actual de la plantilla. */
  currentVersion: number;
  /** Solo el propietario (o un administrador) puede deshacer un cambio. */
  canRestore: boolean;
}>();

const emit = defineEmits<{ close: []; restored: [] }>();

const toast = useToast();
const versions = ref<TemplateVersionSummary[]>([]);
const loading = ref(false);
const restoring = ref<number | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<ListResponse<TemplateVersionSummary>>(
      `/templates/${props.templateId}/versions`,
    );
    versions.value = data.items;
  } catch (error) {
    toast.failure(error, 'No se pudo cargar el historial');
  } finally {
    loading.value = false;
  }
}

/**
 * Restaura una versión anterior. La restauración no borra la historia: se
 * guarda como una versión nueva, para que siempre se sepa qué se deshizo.
 */
async function restore(version: number): Promise<void> {
  if (restoring.value !== null) return;
  restoring.value = version;
  try {
    await api.post(`/templates/${props.templateId}/versions/${version}/restore`);
    toast.success(`Versión ${version} restaurada`);
    emit('restored');
    emit('close');
  } catch (error) {
    toast.failure(error, 'No se pudo restaurar');
  } finally {
    restoring.value = null;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void load();
      document.addEventListener('keydown', onKeydown);
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
  },
);

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-120"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-[90] bg-[#0b1220]/30" @mousedown.self="emit('close')" />
    </Transition>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="open"
        class="fixed inset-y-0 right-0 z-[95] flex w-full max-w-[420px] flex-col border-l border-hairline bg-surface shadow-pop"
      >
        <header class="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div class="flex items-center gap-2">
            <History class="size-4 text-ink-muted" />
            <h2 class="text-[14px] font-semibold">Historial de la plantilla</h2>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-hover hover:text-ink"
            aria-label="Cerrar historial"
            @click="emit('close')"
          >
            <X class="size-4" />
          </button>
        </header>

        <div v-if="loading" class="grid flex-1 place-items-center">
          <BaseSpinner label="Cargando historial…" />
        </div>

        <div v-else-if="versions.length === 0" class="grid flex-1 place-items-center px-6 text-center">
          <p class="text-[12.5px] text-ink-muted">
            Todavía no hay versiones guardadas. Cuando alguien mejore la plantilla, su cambio
            aparecerá aquí con su nombre.
          </p>
        </div>

        <ul v-else class="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
          <li v-for="version in versions" :key="version.id" class="flex items-start gap-3 px-5 py-3">
            <UserAvatar :name="version.authorName ?? '—'" size="sm" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="text-[12.5px] font-semibold">v{{ version.version }}</span>
                <span
                  v-if="version.version === currentVersion"
                  class="chip !h-4 !px-1.5 !text-[10px]"
                >
                  actual
                </span>
              </div>
              <p class="mt-0.5 truncate text-[12px] text-ink">
                {{ version.note || 'Cambio guardado' }}
              </p>
              <p class="mt-0.5 text-[11px] text-ink-subtle">
                <template v-if="version.authorName">{{ version.authorName }} · </template>
                {{ formatDateTime(version.createdAt) }} · {{ relativeTime(version.createdAt) }}
              </p>
            </div>
            <button
              v-if="canRestore && version.version !== currentVersion"
              type="button"
              class="btn btn-outline btn-sm shrink-0"
              :disabled="restoring !== null"
              :title="`Volver al contenido de la versión ${version.version}`"
              @click="restore(version.version)"
            >
              <RotateCcw class="size-3.5" />
              {{ restoring === version.version ? 'Restaurando…' : 'Restaurar' }}
            </button>
          </li>
        </ul>
      </aside>
    </Transition>
  </Teleport>
</template>
