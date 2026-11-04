<script setup lang="ts">
import { EditorContent, type Editor } from '@tiptap/vue-3';
import { FileText, Rows3 } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import PageChromeBand from '@/components/editor/PageChromeBand.vue';
import PageChromePreview from '@/components/editor/PageChromePreview.vue';
import { useDocumentPagination } from '@/composables/useDocumentPagination';
import { cmToPx } from '@/lib/pagination/geometry';
import { DEFAULT_DESIGN_TOKENS, PAGE_SIZES_CM } from '@sirpefoffice/shared';
import type {
  ChromeConfig,
  ChromeKind,
  ChromeSource,
  DesignTokens,
} from '@sirpefoffice/shared';

interface ChromeBinding {
  editor: Editor | null;
  config: ChromeConfig;
  source: ChromeSource;
  own: boolean;
}

const props = defineProps<{
  editor: Editor | null;
  design: DesignTokens | null;
  header: ChromeBinding;
  footer: ChromeBinding;
  chromeOpen: boolean;
  editable: boolean;
  activeChrome?: 'body' | 'header' | 'footer';
}>();

const emit = defineEmits<{
  toggle: [kind: ChromeKind, enabled: boolean];
  height: [kind: ChromeKind, heightMm: number];
  width: [kind: ChromeKind, widthPercent: number];
  reset: [kind: ChromeKind];
}>();

const PAGINATION_KEY = 'sirpefoffice:pagination';
/** Compatibilidad con la preferencia guardada antes del renombrado. */
const LEGACY_PAGINATION_KEY = 'sirpefdoc:pagination';

function readPaginationPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored =
      window.localStorage.getItem(PAGINATION_KEY) ??
      window.localStorage.getItem(LEGACY_PAGINATION_KEY);
    if (stored && !window.localStorage.getItem(PAGINATION_KEY)) {
      window.localStorage.setItem(PAGINATION_KEY, stored);
      window.localStorage.removeItem(LEGACY_PAGINATION_KEY);
    }
    return stored !== 'continuous';
  } catch {
    return true;
  }
}

const paginated = ref(readPaginationPreference());
watch(paginated, (value) => {
  try {
    window.localStorage.setItem(PAGINATION_KEY, value ? 'paged' : 'continuous');
  } catch {
    /* almacenamiento no disponible */
  }
});

/** La edición de cabecera/pie necesita la hoja continua. */
const isPaginated = computed(() => paginated.value && !props.chromeOpen);

/** Sin diseño se usan exactamente los mismos tokens que el servidor. */
const tokens = computed(() => props.design ?? DEFAULT_DESIGN_TOKENS);

const pageSize = computed(
  () => PAGE_SIZES_CM[tokens.value.pageFormat] ?? PAGE_SIZES_CM.A4!,
);
const pageWidthCm = computed(() =>
  tokens.value.orientation === 'landscape' ? pageSize.value.height : pageSize.value.width,
);
const pageHeightCm = computed(() =>
  tokens.value.orientation === 'landscape' ? pageSize.value.width : pageSize.value.height,
);
const pageHeightPx = computed(() => cmToPx(pageHeightCm.value));

const sheetStyle = computed(() => {
  const design = tokens.value;
  const m = design.margins;

  return {
    '--sheet-width': `${pageWidthCm.value}cm`,
    '--sheet-height': `${pageHeightCm.value}cm`,
    '--sheet-margin-top': `${m.top}cm`,
    '--sheet-margin-right': `${m.right}cm`,
    '--sheet-margin-bottom': `${m.bottom}cm`,
    '--sheet-margin-left': `${m.left}cm`,
    '--sheet-font': design.fontFamily,
    '--sheet-size': `${design.fontSize}pt`,
    '--sheet-leading': String(design.lineHeight),
    '--sheet-primary': design.primaryColor,
    '--sheet-th': design.tableHeadColor,
    '--sheet-text': design.textColor,
    '--sheet-bg': design.backgroundColor,
    '--sheet-accent': design.accentColor,
    '--sheet-border': design.tableBorderColor,
    '--sheet-scale': String(design.headingScale),
  } as Record<string, string>;
});

const pagesEl = ref<HTMLElement | null>(null);
const firstCardEl = ref<HTMLElement | null>(null);
const topInsetPx = ref(0);
const bottomInsetPx = ref(0);
const editorHeightPx = ref(0);

const editorRef = computed(() => props.editor);
const enabledRef = computed(() => isPaginated.value);
const pageHeightRef = computed(() => pageHeightPx.value);

const { pages } = useDocumentPagination({
  editor: editorRef,
  enabled: enabledRef,
  sheet: firstCardEl,
  pageHeightPx: pageHeightRef,
  gapPx: 24,
});

const continuousHeightPx = computed(() =>
  Math.max(
    pageHeightPx.value,
    topInsetPx.value + editorHeightPx.value + bottomInsetPx.value,
  ),
);

/**
 * En modo paginado se usan las páginas calculadas; mientras llega el primer
 * cálculo (o en hoja continua) se dibuja una única tarjeta.
 */
const displayPages = computed(() => {
  if (isPaginated.value && pages.value.length > 0) return pages.value;
  return [
    {
      index: 0,
      topPx: 0,
      heightPx: continuousHeightPx.value,
      usedPx: editorHeightPx.value,
      overflow: false,
    },
  ];
});

const totalHeightPx = computed(() => {
  const last = displayPages.value[displayPages.value.length - 1];
  return last ? last.topPx + last.heightPx : pageHeightPx.value;
});

const flowStyle = computed(() => ({ paddingTop: `${topInsetPx.value}px` }));

function syncFirstCard(): void {
  firstCardEl.value =
    pagesEl.value?.querySelector<HTMLElement>('.doc-page-card') ?? null;
}

function measureInsets(): void {
  const card = firstCardEl.value;
  topInsetPx.value =
    card?.querySelector<HTMLElement>('.doc-page-top')?.getBoundingClientRect().height ?? 0;
  bottomInsetPx.value =
    card?.querySelector<HTMLElement>('.doc-page-bottom')?.getBoundingClientRect().height ?? 0;
}

function measureEditorHeight(): void {
  const editor = props.editor;
  editorHeightPx.value =
    editor && !editor.isDestroyed ? editor.view.dom.getBoundingClientRect().height : 0;
}

let bandObserver: ResizeObserver | null = null;
let editorObserver: ResizeObserver | null = null;

function observeBands(): void {
  bandObserver?.disconnect();
  bandObserver = new ResizeObserver(() => measureInsets());
  measureInsets();
  const card = firstCardEl.value;
  if (!card) return;
  card
    .querySelectorAll<HTMLElement>('.doc-page-top, .doc-page-bottom')
    .forEach((element) => bandObserver!.observe(element));
}

function observeEditor(): void {
  editorObserver?.disconnect();
  measureEditorHeight();
  const editor = props.editor;
  if (!editor || editor.isDestroyed) return;
  editorObserver = new ResizeObserver(() => measureEditorHeight());
  editorObserver.observe(editor.view.dom);
}

function setPaginated(value: boolean): void {
  if (props.chromeOpen) return;
  paginated.value = value;
}

/**
 * Un clic en el espacio blanco de una hoja (debajo del último texto o en el
 * hueco entre páginas) coloca el cursor al final, como en un procesador de
 * textos. Los clics dentro del texto o de una banda no se interceptan.
 */
function onPageBackgroundClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('.tiptap') || target.closest('.wp-chrome-band')) return;
  if (!props.editable || !props.editor) return;
  props.editor.chain().focus('end').run();
}

watch(
  () => displayPages.value.length,
  () => nextTick(syncFirstCard),
);

watch(firstCardEl, () => nextTick(observeBands));

watch(
  () => [isPaginated.value, props.chromeOpen, props.header.config, props.footer.config, props.design],
  () =>
    nextTick(() => {
      observeBands();
      measureEditorHeight();
    }),
);

watch(
  () => props.editor,
  () => nextTick(observeEditor),
  { immediate: true },
);

onMounted(() => {
  void nextTick(() => {
    syncFirstCard();
    observeBands();
    observeEditor();
  });
  void document.fonts?.ready
    .then(() => {
      measureInsets();
      measureEditorHeight();
    })
    .catch(() => undefined);
});

onBeforeUnmount(() => {
  bandObserver?.disconnect();
  editorObserver?.disconnect();
});
</script>

<template>
  <div class="doc-sheet-wrap" :style="sheetStyle">
    <div
      ref="pagesEl"
      class="doc-pages"
      :style="{ height: `${totalHeightPx}px` }"
      @click="onPageBackgroundClick"
    >
      <div class="doc-page-cards">
        <div
          v-for="page in displayPages"
          :key="page.index"
          class="doc-page-card"
          :style="{ top: `${page.topPx}px`, height: `${page.heightPx}px` }"
        >
          <div class="doc-page-top">
            <div
              v-if="design?.logo.enabled && design.logo.dataUrl"
              class="mb-3"
              :style="{ textAlign: design.logo.align }"
            >
              <img
                :src="design.logo.dataUrl"
                alt="Logotipo del diseño"
                :style="{
                  width: `${design.logo.width}px`,
                  display: 'inline-block',
                  maxWidth: '100%',
                }"
              />
            </div>
            <div
              v-if="design?.letterhead.enabled"
              class="mb-4"
              :style="{ textAlign: design.letterhead.align }"
            >
              <div
                v-if="design.letterhead.title"
                :style="{
                  color: design.primaryColor,
                  fontWeight: 700,
                  fontSize: '1.4em',
                  letterSpacing: '.04em',
                }"
              >
                {{ design.letterhead.title }}
              </div>
              <div
                v-if="design.letterhead.subtitle"
                :style="{ opacity: 0.75, fontSize: '.9em' }"
              >
                {{ design.letterhead.subtitle }}
              </div>
              <div :style="{ borderTop: `2px solid ${design.primaryColor}`, marginTop: '.5em' }" />
            </div>

            <PageChromePreview
              v-if="!chromeOpen && header.config.enabled"
              kind="header"
              :config="header.config"
              :page-number="page.index + 1"
              :page-count="displayPages.length"
            />
            <PageChromeBand
              v-else-if="chromeOpen && page.index === 0"
              kind="header"
              :editor="header.editor"
              :config="header.config"
              :source="header.source"
              :own="header.own"
              :editable="editable && chromeOpen"
              :show-bar="chromeOpen"
              :active="activeChrome === 'header'"
              @toggle="emit('toggle', 'header', $event)"
              @height="emit('height', 'header', $event)"
              @width="emit('width', 'header', $event)"
              @reset="emit('reset', 'header')"
            />
          </div>

          <!-- Renglón central vacío: el contenido real vive en el flujo
               superpuesto, pero la rejilla necesita las tres filas. -->
          <div class="doc-page-body" aria-hidden="true" />

          <div class="doc-page-bottom">
            <PageChromePreview
              v-if="!chromeOpen && footer.config.enabled"
              kind="footer"
              :config="footer.config"
              :page-number="page.index + 1"
              :page-count="displayPages.length"
            />
            <PageChromeBand
              v-else-if="chromeOpen && page.index === 0"
              kind="footer"
              :editor="footer.editor"
              :config="footer.config"
              :source="footer.source"
              :own="footer.own"
              :editable="editable && chromeOpen"
              :show-bar="chromeOpen"
              :active="activeChrome === 'footer'"
              @toggle="emit('toggle', 'footer', $event)"
              @height="emit('height', 'footer', $event)"
              @width="emit('width', 'footer', $event)"
              @reset="emit('reset', 'footer')"
            />
          </div>
        </div>
      </div>

      <div class="doc-paged-flow" :style="flowStyle">
        <EditorContent :editor="editor ?? undefined" />
      </div>
    </div>

    <div class="doc-sheet-meta">
      <span class="doc-sheet-meta__info"><slot name="meta" /></span>
      <span class="doc-sheet-meta__count">
        {{ displayPages.length }} {{ displayPages.length === 1 ? 'página' : 'páginas' }}
      </span>
      <div class="doc-mode-toggle" role="group" aria-label="Vista de la hoja">
        <button
          type="button"
          :class="{ 'is-active': isPaginated }"
          :disabled="chromeOpen"
          :title="chromeOpen ? 'La cabecera y el pie se editan en hoja continua' : 'Ver varias hojas'"
          @click="setPaginated(true)"
        >
          <Rows3 class="size-3" />
          Páginas
        </button>
        <button
          type="button"
          :class="{ 'is-active': !isPaginated }"
          :disabled="chromeOpen"
          :title="chromeOpen ? 'La cabecera y el pie se editan en hoja continua' : 'Ver una sola hoja continua'"
          @click="setPaginated(false)"
        >
          <FileText class="size-3" />
          Hoja continua
        </button>
      </div>
    </div>
  </div>
</template>
