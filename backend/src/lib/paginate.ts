import { createHash } from 'node:crypto';

import type {
  DesignTokens,
  DocumentPageLayout,
  JSONContent,
  PackBlock,
  ResolvedChrome,
  VariableValues,
} from '@sirpefoffice/shared';
import { packBlocks } from '@sirpefoffice/shared';
import type { Page } from 'puppeteer-core';

import { getBrowser } from './browser.js';
import { internal } from './errors.js';
import { buildDocumentHtml, prepareContent } from './render.js';

export const PAGE_GAP_PX = 24;

/**
 * Chrome redondea al alza las filas de la rejilla al imprimir. Si el contenido
 * queda exactamente al límite, el pie se desplaza a una página extra en blanco.
 * Se reservan unos píxeles para que la hoja impresa nunca desborde.
 */
const PRINT_SAFETY_PX = 2;

export interface PaginateOptions {
  content: JSONContent;
  design: DesignTokens;
  chrome?: ResolvedChrome | null;
  values?: VariableValues;
  title?: string;
  includeLetterhead?: boolean;
}

export interface PaginatedDocument {
  /** Contenido ya interpolado y limpio, con la misma estructura que se midió. */
  content: JSONContent;
  layout: DocumentPageLayout;
}

interface MeasuredChild {
  index: number;
  top: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  isPageBreak: boolean;
}

interface Measurement {
  pageHeightPx: number;
  topInsetPx: number;
  bottomInsetPx: number;
  children: MeasuredChild[];
}

const cache = new Map<string, DocumentPageLayout>();
const CACHE_LIMIT = 64;

/**
 * Mide el documento dentro de Chrome.
 *
 * La medición se hace en el navegador, así que el error de `page.evaluate`
 * llega como un fallo genérico de Puppeteer. Aquí se convierte en un error
 * con mensaje útil: si el HTML no tiene la estructura esperada, el problema
 * está en el documento, no en el servidor.
 */
async function measurePage(page: Page): Promise<Measurement> {
  try {
    return await page.evaluate((): Measurement => {
      const top = document.querySelector<HTMLElement>('.doc-page-top');
      const bottom = document.querySelector<HTMLElement>('.doc-page-bottom');
      const body = document.querySelector<HTMLElement>('.doc-body');
      if (!top || !bottom || !body) {
        throw new Error('No se encontró la estructura de página para medir');
      }

      const rootTop = body.getBoundingClientRect().top;
      const children: MeasuredChild[] = Array.from(body.children).map((child, index) => {
        const element = child as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          index,
          top: rect.top - rootTop,
          height: rect.height,
          marginTop: Number.parseFloat(style.marginTop) || 0,
          marginBottom: Number.parseFloat(style.marginBottom) || 0,
          isPageBreak:
            element.classList.contains('page-break') ||
            element.hasAttribute('data-page-break'),
        };
      });

      const rootStyle = getComputedStyle(document.documentElement);
      const heightCm = Number.parseFloat(rootStyle.getPropertyValue('--page-h')) || 29.7;
      return {
        pageHeightPx: (heightCm * 96) / 2.54,
        topInsetPx: top.getBoundingClientRect().height,
        bottomInsetPx: bottom.getBoundingClientRect().height,
        children,
      };
    });
  } catch (error) {
    throw internal(
      'PAGINATION_MEASURE_FAILED',
      'No se pudo medir el documento para paginarlo. Revisa su contenido e inténtalo de nuevo.',
      { reason: (error as Error).message },
    );
  }
}

function cacheKey(
  content: JSONContent,
  design: DesignTokens,
  chrome: ResolvedChrome | null | undefined,
  values: VariableValues,
  includeLetterhead: boolean,
): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        content,
        design,
        chrome: chrome ?? null,
        values,
        includeLetterhead,
      }),
    )
    .digest('hex');
}

function remember(key: string, layout: DocumentPageLayout): void {
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, layout);
}

export function clearPaginationCache(): void {
  cache.clear();
}

/**
 * Mide el documento con Chrome y devuelve el mismo reparto por bloques que
 * usa el editor: no parte párrafos ni tablas, solo corta entre bloques.
 */
export async function paginateDocument(options: PaginateOptions): Promise<PaginatedDocument> {
  const values = options.values ?? {};
  const content = prepareContent(options.content, values);
  const chrome = options.chrome ?? null;
  const includeLetterhead = options.includeLetterhead !== false;
  const key = cacheKey(content, options.design, chrome, values, includeLetterhead);
  const cached = cache.get(key);

  if (cached) return { content, layout: cached };

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    const html = buildDocumentHtml({
      content,
      design: options.design,
      chrome,
      values,
      title: options.title,
      includeLetterhead,
      mode: 'screen',
    });

    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready.then(() => true)');
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((image) =>
          image.decode ? image.decode().catch(() => undefined) : Promise.resolve(),
        ),
      );
      await new Promise((resolve) => requestAnimationFrame(() => resolve(true)));
    });

    const measured = await measurePage(page);

    const capacityPx = Math.max(
      48,
      measured.pageHeightPx - measured.topInsetPx - measured.bottomInsetPx - PRINT_SAFETY_PX,
    );
    const blocks: PackBlock[] = [];
    let pendingForceBreak = false;
    let previousContent: MeasuredChild | null = null;
    let isFirstContent = true;

    for (const child of measured.children) {
      if (child.isPageBreak) {
        pendingForceBreak = true;
        previousContent = null;
        continue;
      }

      const gapBefore = previousContent
        ? Math.max(0, child.top - (previousContent.top + previousContent.height))
        : isFirstContent
          ? Math.max(0, child.top)
          : child.marginTop;

      blocks.push({
        pos: child.index,
        advancePx: gapBefore + child.height,
        forceBreakBefore: pendingForceBreak,
      });

      pendingForceBreak = false;
      previousContent = child;
      isFirstContent = false;
    }

    const packed = packBlocks(
      blocks,
      capacityPx,
      1,
      pendingForceBreak,
    );

    const pageUseds = [...packed.pageUseds];
    if (packed.trailingBlankPage) pageUseds.push(0);

    const pageHeightsPx = pageUseds.map((used) =>
      Math.max(
        measured.pageHeightPx,
        measured.topInsetPx + used + measured.bottomInsetPx,
      ),
    );
    const pageTopsPx: number[] = [];
    let cursor = 0;
    for (const height of pageHeightsPx) {
      pageTopsPx.push(cursor);
      cursor += height + PAGE_GAP_PX;
    }

    const pageBlocks: number[][] = [];
    let rangeStart = 0;
    for (const pageBreak of packed.breaks) {
      pageBlocks.push(
        measured.children
          .slice(rangeStart, pageBreak.pos)
          .filter((child) => !child.isPageBreak)
          .map((child) => child.index),
      );
      rangeStart = pageBreak.pos;
    }
    pageBlocks.push(
      measured.children
        .slice(rangeStart)
        .filter((child) => !child.isPageBreak)
        .map((child) => child.index),
    );
    if (packed.trailingBlankPage) pageBlocks.push([]);

    const lastPage = pageBlocks.length - 1;
    const layout: DocumentPageLayout = {
      pageHeightPx: measured.pageHeightPx,
      topInsetPx: measured.topInsetPx,
      bottomInsetPx: measured.bottomInsetPx,
      gapPx: PAGE_GAP_PX,
      pageHeightsPx,
      pageTopsPx,
      pageBlocks,
      totalHeightPx:
        lastPage >= 0
          ? (pageTopsPx[lastPage] ?? 0) + (pageHeightsPx[lastPage] ?? measured.pageHeightPx)
          : measured.pageHeightPx,
    };

    remember(key, layout);
    return { content, layout };
  } finally {
    await page.close().catch(() => undefined);
  }
}
