<script setup lang="ts">
import { FileText, Loader2, Maximize2, Minus, Plus, Scan } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import DocumentPreview from '@/components/documents/DocumentPreview.vue';
import { api } from '@/api/client';
import { DEFAULT_DESIGN_TOKENS, PAGE_SIZES_CM } from '@sirpefoffice/shared';
import type { DesignTokens } from '@sirpefoffice/shared';

/**
 * Visor de revisión: muestra todas las hojas del documento paginado, con
 * zoom y desplazamiento, sin obligar a abrir el editor.
 */
const props = withDefaults(
  defineProps<{
    documentId: string;
    version?: number;
    updatedAt?: string | null;
    designUpdatedAt?: string | null;
    tokens?: DesignTokens | null;
    title?: string;
    /** Permite ampliar el visor (por ejemplo, en pantalla completa). */
    maxHeightClass?: string;
    /** Muestra el botón de pantalla completa en la barra del visor. */
    expandable?: boolean;
    /**
     * El visor ocupa todo el alto disponible (en escritorio) en vez de abrir
     * una ventana con scroll propio.
     */
    fill?: boolean;
  }>(),
  { tokens: null, title: '', maxHeightClass: 'max-h-[72vh]', expandable: false, fill: false },
);

const emit = defineEmits<{ expand: [] }>();

const CM_TO_PX = 37.7952755906;
const BODY_PADDING_X = 24;
const BODY_PADDING_Y = 48;
const previewCache = new Map<string, string>();

const container = ref<HTMLElement | null>(null);
const html = ref('');
const loading = ref(true);
const failed = ref(false);
const naturalHeight = ref(0);
const pageCount = ref(0);
const containerWidth = ref(0);
const zoom = ref(1);

let observer: ResizeObserver | null = null;
let requestId = 0;

const resolvedTokens = computed<DesignTokens>(() => props.tokens ?? DEFAULT_DESIGN_TOKENS);

const page = computed(() => {
  const size = PAGE_SIZES_CM[resolvedTokens.value.pageFormat] ?? PAGE_SIZES_CM.A4!;
  const landscape = resolvedTokens.value.orientation === 'landscape';
  return {
    width: (landscape ? size.height : size.width) * CM_TO_PX,
    height: (landscape ? size.width : size.height) * CM_TO_PX,
  };
});

const baseWidth = computed(() => Math.round(page.value.width + BODY_PADDING_X));
const baseHeight = computed(() =>
  Math.round(naturalHeight.value || page.value.height + BODY_PADDING_Y),
);

/** Escala que hace encajar la hoja en el ancho disponible. */
const fitScale = computed(() => {
  if (!containerWidth.value) return 1;
  return Math.min(1, Math.max(0.35, (containerWidth.value - 24) / baseWidth.value));
});

const scale = computed(() => fitScale.value * zoom.value);

const cacheKey = computed(() =>
  [props.documentId, props.version ?? 0, props.updatedAt ?? '', props.designUpdatedAt ?? ''].join(':'),
);

const pagesLabel = computed(() =>
  pageCount.value === 1 ? '1 página' : `${pageCount.value} páginas`,
);

async function load(): Promise<void> {
  if (!props.documentId) return;

  const current = ++requestId;
  const key = cacheKey.value;
  const cached = previewCache.get(key);
  if (cached) {
    html.value = cached;
    loading.value = false;
    failed.value = false;
    return;
  }

  loading.value = true;
  failed.value = false;
  naturalHeight.value = 0;
  pageCount.value = 0;

  try {
    // `preview=1`: vista previa dentro de la app (no es una exportación).
    // Sin `embed=1`: el backend pagina todas las hojas, no solo la primera.
    const result = await api.get<string>(`/documents/${props.documentId}/html`, {
      preview: '1',
    });
    if (current !== requestId) return;
    previewCache.set(key, result);
    html.value = result;
  } catch {
    if (current === requestId) {
      failed.value = true;
      html.value = '';
    }
  } finally {
    if (current === requestId) loading.value = false;
  }
}

function onIframeLoad(): void {
  const frame = container.value?.querySelector('iframe');
  const doc = frame?.contentDocument;
  if (!doc) return;

  pageCount.value = doc.querySelectorAll('.doc-page').length || 1;
  const measured = Math.max(
    doc.documentElement?.scrollHeight ?? 0,
    doc.body?.scrollHeight ?? 0,
  );
  if (measured > 0) naturalHeight.value = measured;
}

function measure(): void {
  if (!container.value) return;
  containerWidth.value = container.value.clientWidth;
}

function zoomIn(): void {
  zoom.value = Math.min(2, Math.round((zoom.value + 0.1) * 10) / 10);
}

function zoomOut(): void {
  zoom.value = Math.max(0.5, Math.round((zoom.value - 0.1) * 10) / 10);
}

function fit(): void {
  zoom.value = 1;
}

watch(() => props.documentId, () => void load());
watch(
  [() => props.version, () => props.updatedAt, () => props.designUpdatedAt],
  () => void load(),
);

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && container.value) {
    observer = new ResizeObserver(measure);
    observer.observe(container.value);
  }
  void load();
});

onBeforeUnmount(() => {
  requestId += 1;
  observer?.disconnect();
});
</script>

<template>
  <div
    :class="[
      'overflow-hidden rounded-xl border border-hairline bg-[#e9edf2]',
      fill ? 'lg:flex lg:h-full lg:min-h-0 lg:flex-col' : '',
    ]"
  >
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
      <FileText class="size-4 text-accent" />
      <span class="text-[12.5px] font-medium text-ink">Vista del documento</span>
      <span v-if="pageCount" class="text-[11px] text-ink-subtle">{{ pagesLabel }}</span>

      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover disabled:opacity-40"
          aria-label="Reducir zoom"
          :disabled="zoom <= 0.5"
          @click="zoomOut"
        >
          <Minus class="size-3.5" />
        </button>
        <span class="w-10 text-center text-[11px] font-medium text-ink-muted">
          {{ Math.round(scale * 100) }}%
        </span>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover disabled:opacity-40"
          aria-label="Aumentar zoom"
          :disabled="zoom >= 2"
          @click="zoomIn"
        >
          <Plus class="size-3.5" />
        </button>
        <button
          type="button"
          class="ml-1 flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-hover"
          @click="fit"
        >
          <Scan class="size-3" />
          Ajustar
        </button>
        <button
          v-if="expandable"
          type="button"
          class="ml-1 flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-hover"
          title="Pantalla completa"
          @click="emit('expand')"
        >
          <Maximize2 class="size-3" />
          <span class="hidden sm:inline">Pantalla completa</span>
        </button>
      </div>
    </div>

    <div
      ref="container"
      :class="[
        'min-h-[240px] overflow-auto p-3',
        fill ? 'max-h-[72vh] lg:max-h-none lg:min-h-0 lg:flex-1' : maxHeightClass,
      ]"
    >
      <div v-if="loading" class="grid min-h-[220px] place-items-center">
        <span class="flex items-center gap-2 text-[12.5px] text-ink-muted">
          <Loader2 class="size-4 animate-spin" />
          Preparando vista del documento…
        </span>
      </div>

      <div v-else-if="failed" class="grid place-items-center gap-3 py-6">
        <p class="text-center text-[12.5px] text-ink-muted">
          No se pudo preparar la vista paginada.
        </p>
        <DocumentPreview
          :document-id="documentId"
          :version="version"
          :updated-at="updatedAt"
          :design-updated-at="designUpdatedAt"
          :tokens="tokens"
          :scale="0.55"
          :lazy="false"
          :title="title"
        />
      </div>

      <div
        v-else
        class="mx-auto"
        :style="{ width: `${baseWidth * scale}px`, height: `${baseHeight * scale}px` }"
      >
        <iframe
          :srcdoc="html"
          :style="{
            width: `${baseWidth}px`,
            height: `${baseHeight}px`,
            transform: `scale(${scale})`,
          }"
          class="block origin-top-left border-0 bg-transparent"
          sandbox="allow-same-origin"
          :title="title ? `Documento ${title}` : 'Documento'"
          @load="onIframeLoad"
        />
      </div>
    </div>
  </div>
</template>
