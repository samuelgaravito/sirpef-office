import type { Editor } from '@tiptap/core';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';

import {
  clearPaginationDecorations,
  setPaginationDecorations,
} from '@/lib/pagination/extension';
import { measurePageGeometry } from '@/lib/pagination/geometry';
import { buildPaginationLayout, DEFAULT_PAGE_GAP_PX } from '@/lib/pagination/layout';
import type { PageBreakLayout, PageSlice, PaginationLayout } from '@/lib/pagination/layout';

export interface UseDocumentPaginationOptions {
  editor: Ref<Editor | null | undefined> | ComputedRef<Editor | null | undefined>;
  enabled: Ref<boolean> | ComputedRef<boolean>;
  /** Hoja de la que se miden los márgenes internos (cabecera/pie). */
  sheet: Ref<HTMLElement | null>;
  /** Alto físico de la página en píxeles CSS. */
  pageHeightPx: Ref<number> | ComputedRef<number>;
  gapPx?: number;
  /** Retardo de estabilización tras una edición. */
  debounceMs?: number;
}

/**
 * Motor de paginación visual para una única instancia de ProseMirror.
 *
 * Mide el DOM real, calcula los cortes y los inyecta como decoraciones
 * (widgets) que empujan el contenido a la página siguiente. No modifica el
 * documento, por lo que undo y autoguardado siguen funcionando igual.
 */
export function useDocumentPagination(options: UseDocumentPaginationOptions) {
  const pages = ref<PageSlice[]>([]);
  const layout = shallowRef<PaginationLayout | null>(null);
  const ready = ref(false);

  const pageCount = computed(() => pages.value.length);
  const overflowPages = computed(() => pages.value.filter((page) => page.overflow));

  const gapPx = options.gapPx ?? DEFAULT_PAGE_GAP_PX;
  const debounceMs = options.debounceMs ?? 140;

  /** Huecos que están realmente aplicados en el DOM. */
  let appliedBreaks: PageBreakLayout[] = [];
  let rafId = 0;
  let timerId: number | undefined;
  let cleanup: (() => void) | null = null;

  function cancelScheduled(): void {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timerId = undefined;
    }
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function schedule(immediate = false): void {
    if (!options.enabled.value) return;
    cancelScheduled();
    timerId = window.setTimeout(
      () => {
        timerId = undefined;
        rafId = window.requestAnimationFrame(compute);
      },
      immediate ? 0 : debounceMs,
    );
  }

  function compute(): void {
    rafId = 0;
    const editor = options.editor.value;
    const sheet = options.sheet.value;

    if (!options.enabled.value || !editor || editor.isDestroyed || !sheet?.isConnected) {
      return;
    }

    const geometry = measurePageGeometry(sheet, options.pageHeightPx.value);
    if (geometry.capacityPx < 48) return;

    const next = buildPaginationLayout(editor, geometry, {
      gapPx,
      previousBreaks: appliedBreaks,
    });

    const sameBreaks =
      appliedBreaks.length === next.breaks.length &&
      appliedBreaks.every((current, index) => {
        const candidate = next.breaks[index];
        return (
          candidate !== undefined &&
          current.pos === candidate.pos &&
          Math.abs(current.height - candidate.height) < 0.5
        );
      });

    const samePages =
      pages.value.length === next.pages.length &&
      pages.value.every((current, index) => {
        const candidate = next.pages[index];
        return (
          candidate !== undefined &&
          Math.abs(current.heightPx - candidate.heightPx) < 0.5 &&
          Math.abs(current.usedPx - candidate.usedPx) < 0.5 &&
          current.overflow === candidate.overflow
        );
      });

    if (!sameBreaks) {
      appliedBreaks = next.breaks;
      setPaginationDecorations(editor, next.breaks);
    }

    if (!sameBreaks || !samePages) {
      layout.value = next;
      pages.value = next.pages;
    }

    ready.value = true;
  }

  function reset(): void {
    cancelScheduled();
    const editor = options.editor.value;
    const hadBreaks = appliedBreaks.length > 0;
    if (hadBreaks && editor && !editor.isDestroyed) clearPaginationDecorations(editor);
    appliedBreaks = [];
    layout.value = null;
    pages.value = [];
    ready.value = false;
  }

  function start(): void {
    const editor = options.editor.value;
    const sheet = options.sheet.value;
    if (!editor || editor.isDestroyed) return;

    const dom = editor.view.dom;
    const onUpdate = () => schedule();
    editor.on('update', onUpdate);

    const observer = new ResizeObserver(() => schedule());
    observer.observe(dom);
    if (sheet) {
      sheet
        .querySelectorAll<HTMLElement>('.doc-page-top, .doc-page-bottom')
        .forEach((element) => observer.observe(element));
    }

    const onImageLoad = () => schedule();
    dom.addEventListener('load', onImageLoad, true);

    const onFonts = () => schedule();
    void document.fonts?.ready.then(onFonts).catch(() => undefined);
    document.fonts?.addEventListener?.('loadingdone', onFonts);

    const onWindowResize = () => schedule();
    window.addEventListener('resize', onWindowResize);

    cleanup = () => {
      editor.off('update', onUpdate);
      observer.disconnect();
      // `dom` se captura al iniciar: durante el desmontaje TipTap ya puede
      // haber destruido el editor y `editor.view` lanzaría una excepción.
      dom.removeEventListener('load', onImageLoad, true);
      document.fonts?.removeEventListener?.('loadingdone', onFonts);
      window.removeEventListener('resize', onWindowResize);
    };
  }

  function stop(): void {
    cleanup?.();
    cleanup = null;
    cancelScheduled();
  }

  watch(
    [options.enabled, options.editor, options.sheet, options.pageHeightPx],
    () => {
      stop();
      if (options.enabled.value) {
        start();
        schedule(true);
      } else {
        reset();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stop();
    const editor = options.editor.value;
    if (appliedBreaks.length > 0 && editor && !editor.isDestroyed) {
      clearPaginationDecorations(editor);
    }
  });

  return {
    pages,
    pageCount,
    overflowPages,
    layout,
    ready,
    refresh: () => schedule(),
  };
}
