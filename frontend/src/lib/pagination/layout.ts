import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

import type { PageGeometry } from './geometry';
import { DEFAULT_EPSILON_PX, packBlocks } from '@sirpefoffice/shared';
import type { PackBlock } from '@sirpefoffice/shared';

export const PAGE_BREAK_NODE = 'pageBreak';
export const DEFAULT_PAGE_GAP_PX = 24;

export interface BlockMetric {
  node: PMNode;
  pos: number;
  dom: HTMLElement;
  /** Borde superior relativo al inicio del contenido del editor. */
  top: number;
  /** Borde inferior relativo al inicio del contenido del editor. */
  bottom: number;
  height: number;
  marginTop: number;
  marginBottom: number;
}

export interface PageBreakLayout {
  /** Posición ProseMirror donde va el espaciador. */
  pos: number;
  /** Índice de la página que empieza en esa posición. */
  page: number;
  /** Alto exacto del hueco que hay que insertar. */
  height: number;
}

export interface PageSlice {
  index: number;
  topPx: number;
  heightPx: number;
  usedPx: number;
  overflow: boolean;
}

export interface PaginationLayout {
  geometry: PageGeometry;
  pages: PageSlice[];
  breaks: PageBreakLayout[];
  totalHeightPx: number;
  /** Alto del cuerpo medido sin espaciadores (para la hoja continua). */
  contentHeightPx: number;
  capacityPx: number;
  gapPx: number;
}

export interface BuildPaginationOptions {
  gapPx?: number;
  epsilonPx?: number;
  /**
   * Espaciadores que hay actualmente en el DOM. Se restan de las mediciones
   * para que el cálculo sea independiente de la paginación visible.
   */
  previousBreaks?: readonly PageBreakLayout[];
  pageBreakNodeName?: string;
}

/**
 * Mide los bloques de nivel superior del documento.
 *
 * `nodeDOM` devuelve el elemento real de cada nodo, de modo que los widgets
 * de paginación nunca se confunden con contenido.
 */
export function measureBlocks(
  editor: Editor,
  previousBreaks: readonly PageBreakLayout[] = [],
): BlockMetric[] {
  const root = editor.view.dom;
  const rootTop = root.getBoundingClientRect().top;
  const breaks = [...previousBreaks].sort((a, b) => a.pos - b.pos);
  const metrics: BlockMetric[] = [];
  let breakIndex = 0;
  let spacerOffset = 0;

  editor.state.doc.forEach((node, pos) => {
    while (breakIndex < breaks.length && breaks[breakIndex]!.pos <= pos) {
      spacerOffset += breaks[breakIndex]!.height;
      breakIndex += 1;
    }

    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return;

    const rect = dom.getBoundingClientRect();
    const style = window.getComputedStyle(dom);
    const marginTop = Number.parseFloat(style.marginTop) || 0;
    const marginBottom = Number.parseFloat(style.marginBottom) || 0;

    metrics.push({
      node,
      pos,
      dom,
      top: rect.top - rootTop - spacerOffset,
      bottom: rect.bottom - rootTop - spacerOffset,
      height: rect.height,
      marginTop,
      marginBottom,
    });
  });

  return metrics;
}

/**
 * Calcula saltos, alturas de página y huecos a partir del DOM actual.
 *
 * No modifica el documento: solo devuelve la geometría que la extensión
 * traducirá a decoraciones.
 */
export function buildPaginationLayout(
  editor: Editor,
  geometry: PageGeometry,
  options: BuildPaginationOptions = {},
): PaginationLayout {
  const gapPx = options.gapPx ?? DEFAULT_PAGE_GAP_PX;
  const epsilonPx = options.epsilonPx ?? DEFAULT_EPSILON_PX;
  const pageBreakName = options.pageBreakNodeName ?? PAGE_BREAK_NODE;
  const metrics = measureBlocks(editor, options.previousBreaks ?? []);
  const metricByPos = new Map(metrics.map((metric) => [metric.pos, metric]));

  const blocks: PackBlock[] = [];
  let pendingForceBreak = false;
  let previousContent: BlockMetric | null = null;
  let isFirstContent = true;

  for (const metric of metrics) {
    if (metric.node.type.name === pageBreakName) {
      pendingForceBreak = true;
      previousContent = null;
      continue;
    }

    const gapBefore = previousContent
      ? Math.max(0, metric.top - previousContent.bottom)
      : isFirstContent
        ? Math.max(0, metric.top)
        : metric.marginTop;

    blocks.push({
      pos: metric.pos,
      advancePx: gapBefore + metric.height,
      forceBreakBefore: pendingForceBreak,
    });

    pendingForceBreak = false;
    previousContent = metric;
    isFirstContent = false;
  }

  const packed = packBlocks(blocks, geometry.capacityPx, epsilonPx, pendingForceBreak);

  const pageUseds = [...packed.pageUseds];
  if (packed.trailingBlankPage) pageUseds.push(0);

  const pageHeights = pageUseds.map((used) =>
    Math.max(
      geometry.pageHeightPx,
      geometry.topInsetPx + used + geometry.bottomInsetPx,
    ),
  );

  const pageTops: number[] = [];
  let cursor = 0;
  for (const height of pageHeights) {
    pageTops.push(cursor);
    cursor += height + gapPx;
  }

  // Alto del hueco: desde donde acaba el contenido real hasta el inicio del
  // cuerpo de la página siguiente. La suma de huecos anteriores se descuenta
  // porque las medidas de los bloques ya vienen normalizadas.
  let spacerOffset = 0;
  const breaks = packed.breaks.map((packedBreak) => {
    const metric = metricByPos.get(packedBreak.pos);
    const pageTop = pageTops[packedBreak.page] ?? 0;
    const height = Math.max(0, pageTop - (metric?.top ?? 0) - spacerOffset);
    spacerOffset += height;
    return { ...packedBreak, height };
  });

  const pages: PageSlice[] = pageUseds.map((used, index) => ({
    index,
    topPx: pageTops[index] ?? 0,
    heightPx: pageHeights[index] ?? geometry.pageHeightPx,
    usedPx: used,
    overflow: used > geometry.capacityPx + epsilonPx,
  }));

  const lastPage = pages[pages.length - 1];
  const contentHeightPx = metrics.reduce(
    (max, metric) => Math.max(max, metric.bottom),
    0,
  );

  return {
    geometry,
    pages,
    breaks,
    totalHeightPx: lastPage ? lastPage.topPx + lastPage.heightPx : geometry.pageHeightPx,
    contentHeightPx,
    capacityPx: geometry.capacityPx,
    gapPx,
  };
}
