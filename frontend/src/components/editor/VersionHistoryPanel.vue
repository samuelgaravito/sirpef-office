<script setup lang="ts">
import { Eye, GitCompareArrows, History, RotateCcw, X } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { api } from '@/api/client';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import { useToast } from '@/composables/useToast';
import { diffBlocks, diffStats } from '@/lib/diff';
import { formatDateTime, relativeTime } from '@/lib/labels';
import type { JSONContent } from '@sirpefoffice/shared';
import type { ListResponse, VersionRecord, VersionSummary } from '@/types';

const props = defineProps<{
  open: boolean;
  documentId: string;
  currentContent: JSONContent;
  currentVersion: number;
  /** Versión concreta que se quiere comparar al abrir el panel. */
  initialVersion?: number | null;
  canRestore: boolean;
}>();

const emit = defineEmits<{ close: []; restored: [] }>();

const toast = useToast();

const versions = ref<VersionSummary[]>([]);
const loading = ref(false);
const loadingDetail = ref(false);
const restoring = ref(false);
const selected = ref<number | null>(null);
const snapshot = ref<VersionRecord | null>(null);
const mode = ref<'diff' | 'preview'>('diff');
const previewHtml = ref('');

const diff = computed(() => (snapshot.value ? diffBlocks(snapshot.value.content, props.currentContent) : []));
const stats = computed(() => diffStats(diff.value));

const isCurrent = computed(() => selected.value === props.currentVersion);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<ListResponse<VersionSummary>>(`/documents/${props.documentId}/versions`);
    versions.value = data.items;
    // Si el editor pide una versión concreta (por ejemplo, la enviada a
    // aprobación), se compara esa; si no, la anterior con la actual.
    const preferred =
      props.initialVersion && data.items.some((item) => item.version === props.initialVersion)
        ? props.initialVersion
        : null;
    const initial = preferred ?? data.items[1]?.version ?? data.items[0]?.version ?? null;
    selected.value = initial;
    if (initial) await loadVersion(initial);
  } catch (error) {
    toast.failure(error, 'No se pudo cargar el historial');
  } finally {
    loading.value = false;
  }
}

async function loadVersion(version: number): Promise<void> {
  selected.value = version;
  loadingDetail.value = true;
  previewHtml.value = '';
  try {
    const data = await api.get<{ version: VersionRecord }>(
      `/documents/${props.documentId}/versions/${version}`,
    );
    snapshot.value = data.version;
  } catch (error) {
    toast.failure(error, 'No se pudo cargar la versión');
  } finally {
    loadingDetail.value = false;
  }
}

async function loadPreview(): Promise<void> {
  if (!selected.value || previewHtml.value) return;
  try {
    previewHtml.value = await api.get<string>(
      `/documents/${props.documentId}/versions/${selected.value}/html`,
      // `preview=1`: es una vista previa dentro de la app, no una exportación.
      { preview: '1' },
    );
  } catch (error) {
    toast.failure(error, 'No se pudo generar la vista previa');
  }
}

watch(mode, (value) => {
  if (value === 'preview') void loadPreview();
});

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

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

async function restore(): Promise<void> {
  if (!selected.value || restoring.value) return;
  restoring.value = true;
  try {
    await api.post(`/documents/${props.documentId}/restore/${selected.value}`);
    toast.success(`Versión ${selected.value} restaurada`);
    emit('restored');
    emit('close');
  } catch (error) {
    toast.failure(error, 'No se pudo restaurar');
  } finally {
    restoring.value = false;
  }
}

const kindLabels: Record<string, string> = {
  auto: 'Autoguardado',
  manual: 'Punto de control',
  ai: 'Redacción IA',
  export: 'Exportación',
  restore: 'Restauración',
};
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
        class="fixed inset-y-0 right-0 z-[95] flex w-full max-w-[520px] flex-col border-l border-hairline bg-surface shadow-pop"
      >
        <header class="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div class="flex items-center gap-2">
            <History class="size-4 text-ink-muted" />
            <h2 class="text-[14px] font-semibold">Historial de versiones</h2>
          </div>
          <button type="button" class="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-hover hover:text-ink" aria-label="Cerrar historial" @click="emit('close')">
            <X class="size-4" />
          </button>
        </header>

        <div v-if="loading" class="grid flex-1 place-items-center">
          <BaseSpinner label="Cargando historial…" />
        </div>

        <div v-else class="flex min-h-0 flex-1">
          <!-- Lista -->
          <div class="w-[190px] shrink-0 overflow-y-auto border-r border-hairline bg-surface-muted/40">
            <button
              v-for="version in versions"
              :key="version.id"
              type="button"
              :class="[
                'block w-full border-b border-hairline px-3 py-2.5 text-left transition-colors',
                selected === version.version ? 'bg-accent-soft/60' : 'hover:bg-surface-hover',
              ]"
              @click="loadVersion(version.version)"
            >
              <span class="flex items-center justify-between">
                <span class="text-[12.5px] font-semibold">v{{ version.version }}</span>
                <span v-if="version.version === currentVersion" class="chip !h-4 !px-1.5 !text-[10px]">actual</span>
              </span>
              <span class="mt-0.5 block truncate text-[11px] text-ink-muted">
                {{ kindLabels[version.kind] ?? version.kind }}
              </span>
              <span class="mt-0.5 block text-[10.5px] text-ink-subtle">{{ relativeTime(version.createdAt) }}</span>
            </button>
          </div>

          <!-- Detalle -->
          <div class="flex min-w-0 flex-1 flex-col">
            <div class="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2">
              <div class="flex items-center gap-1 rounded-lg border border-hairline p-0.5">
                <button
                  type="button"
                  :class="['flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium', mode === 'diff' ? 'bg-accent-soft text-accent' : 'text-ink-muted']"
                  @click="mode = 'diff'"
                >
                  <GitCompareArrows class="size-3.5" />
                  Cambios
                </button>
                <button
                  type="button"
                  :class="['flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium', mode === 'preview' ? 'bg-accent-soft text-accent' : 'text-ink-muted']"
                  @click="mode = 'preview'"
                >
                  <Eye class="size-3.5" />
                  Vista
                </button>
              </div>
              <span v-if="mode === 'diff'" class="text-[11px] text-ink-subtle">
                <span class="text-success">+{{ stats.added }}</span>
                <span class="mx-0.5">/</span>
                <span class="text-danger">−{{ stats.removed }}</span>
              </span>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div v-if="loadingDetail" class="grid h-full place-items-center">
                <BaseSpinner size="sm" />
              </div>

              <template v-else-if="snapshot">
                <p class="mb-3 text-[11px] text-ink-subtle">
                  {{ formatDateTime(snapshot.createdAt) }}
                  <template v-if="snapshot.authorName"> · {{ snapshot.authorName }}</template>
                  <template v-if="snapshot.note"> · {{ snapshot.note }}</template>
                </p>

                <div v-if="mode === 'preview'" class="overflow-hidden rounded-lg border border-hairline">
                  <iframe
                    v-if="previewHtml"
                    :srcdoc="previewHtml"
                    class="h-[560px] w-full bg-white"
                    sandbox=""
                    title="Vista previa de la versión"
                  />
                  <div v-else class="grid h-[240px] place-items-center">
                    <BaseSpinner size="sm" label="Generando vista…" />
                  </div>
                </div>

                <ul v-else class="space-y-1">
                  <li
                    v-for="(block, index) in diff"
                    :key="index"
                    :class="[
                      'whitespace-pre-wrap rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed',
                      block.kind === 'added'
                        ? 'border-l-2 border-success bg-success-soft/60 text-ink'
                        : block.kind === 'removed'
                          ? 'border-l-2 border-danger bg-danger-soft/50 text-ink-muted line-through'
                          : 'text-ink-muted',
                    ]"
                  >
                    {{ block.text }}
                  </li>
                </ul>
              </template>
            </div>

            <footer class="flex items-center justify-between gap-2 border-t border-hairline px-4 py-3">
              <p class="text-[11px] text-ink-subtle">
                Comparando v{{ selected ?? '—' }} con la versión actual (v{{ currentVersion }})
              </p>
              <button
                type="button"
                class="btn btn-outline btn-sm"
                :disabled="!canRestore || isCurrent || restoring || !snapshot"
                @click="restore"
              >
                <RotateCcw class="size-3.5" />
                {{ restoring ? 'Restaurando…' : 'Restaurar' }}
              </button>
            </footer>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
