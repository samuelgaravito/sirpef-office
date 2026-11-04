<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import DocumentThumbnail from '@/components/documents/DocumentThumbnail.vue';
import { api } from '@/api/client';
import { DEFAULT_DESIGN_TOKENS, PAGE_SIZES_CM } from '@sirpefoffice/shared';
import type { DesignTokens } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    documentId: string;
    version?: number;
    updatedAt?: string | null;
    designUpdatedAt?: string | null;
    tokens?: DesignTokens | null;
    scale?: number;
    lazy?: boolean;
    html?: string;
    title?: string;
  }>(),
  { scale: 0.24, lazy: true },
);

const CM_TO_PX = 37.7952755906;
const previewCache = new Map<string, string>();

const container = ref<HTMLElement | null>(null);
const visible = ref(!props.lazy);
const loading = ref(false);
const failed = ref(false);
const html = ref(props.html ?? '');
let observer: IntersectionObserver | null = null;
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

const wrapperStyle = computed(() => ({
  width: `${page.value.width * props.scale}px`,
  height: `${page.value.height * props.scale}px`,
}));

const previewHeight = computed(() => Math.round(page.value.height * props.scale));

const pageStyle = computed(() => ({
  width: `${page.value.width}px`,
  height: `${page.value.height}px`,
  transform: `scale(${props.scale})`,
  transformOrigin: 'top left',
}));

const cacheKey = computed(() =>
  [
    props.documentId,
    props.version ?? 0,
    props.updatedAt ?? '',
    props.designUpdatedAt ?? '',
  ].join(':'),
);

async function load(): Promise<void> {
  if (props.html) {
    requestId += 1;
    html.value = props.html;
    loading.value = false;
    failed.value = false;
    return;
  }
  if (!props.documentId || !visible.value) return;

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
  try {
    const result = await api.get<string>(`/documents/${props.documentId}/html`, {
      embed: '1',
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

function observe(): void {
  if (!props.lazy || !container.value) return;
  if (typeof IntersectionObserver === 'undefined') {
    visible.value = true;
    void load();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible.value = true;
        observer?.disconnect();
        observer = null;
        void load();
      }
    },
    { rootMargin: '240px' },
  );
  observer.observe(container.value);
}

watch(
  () => props.html,
  (value) => {
    requestId += 1;
    html.value = value ?? '';
    failed.value = false;
    loading.value = false;
    if (!value && visible.value) void load();
  },
);

watch(
  [() => props.documentId, () => props.version, () => props.updatedAt, () => props.designUpdatedAt],
  () => {
    html.value = props.html ?? '';
    failed.value = false;
    if (visible.value) void load();
  },
);

onMounted(() => {
  if (visible.value) void load();
  else observe();
});

onBeforeUnmount(() => {
  requestId += 1;
  observer?.disconnect();
});
</script>

<template>
  <div
    ref="container"
    class="relative shrink-0 overflow-hidden rounded-md border border-black/5 bg-white shadow-sm"
    :style="wrapperStyle"
    aria-hidden="true"
  >
    <iframe
      v-if="html"
      :srcdoc="html"
      :style="pageStyle"
      class="pointer-events-none absolute left-0 top-0 border-0"
      sandbox=""
      tabindex="-1"
      :title="title ? `Vista previa de ${title}` : 'Vista previa del documento'"
    />

    <div v-else-if="failed" class="size-full">
      <DocumentThumbnail :tokens="resolvedTokens" :title="title" :height="previewHeight" compact />
    </div>

    <div v-else class="size-full animate-pulse bg-surface-muted/70">
      <div class="size-full bg-gradient-to-br from-white/70 via-transparent to-surface-muted/40" />
    </div>

    <div v-if="loading" class="absolute inset-0 grid place-items-center bg-white/55">
      <span class="size-4 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
    </div>
  </div>
</template>
