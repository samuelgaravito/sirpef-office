import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesignTokens, JSONContent, ResolvedChrome, VariableValues } from '@sirpefoffice/shared';
import { PAGE_SIZES_CM } from '@sirpefoffice/shared';

import { env } from '../env.js';
import { withPage, withTimeout } from '../lib/browser.js';
import { paginateDocument } from '../lib/paginate.js';
import { buildPaginatedDocumentHtml } from '../lib/render.js';

export { closeBrowser as closePdfBrowser } from '../lib/browser.js';

export interface PdfOptions {
  content: JSONContent;
  design: DesignTokens;
  values?: VariableValues;
  title?: string;
  includeLetterhead?: boolean;
  chrome?: ResolvedChrome | null;
}

/**
 * Genera el PDF a partir de las mismas hojas que ve el editor.
 *
 * La paginación se calcula antes con Chrome y se materializa en tarjetas
 * `.doc-page`; al imprimir, cada tarjeta ocupa exactamente una página física.
 * Así el número de páginas y los cortes coinciden con el HTML y la vista de
 * impresión.
 */
export async function renderPdf(options: PdfOptions): Promise<Buffer> {
  const { design } = options;

  // La paginación se mide primero (usa su propia página de Chrome). Así la
  // exportación no retiene dos páginas a la vez y no bloquea la cola.
  const paginated = await paginateDocument({
    content: options.content,
    design,
    chrome: options.chrome ?? null,
    values: options.values,
    title: options.title,
    includeLetterhead: options.includeLetterhead !== false,
  });

  const html = buildPaginatedDocumentHtml({
    content: options.content,
    preparedContent: paginated.content,
    pageLayout: paginated.layout,
    design,
    chrome: options.chrome ?? null,
    values: options.values,
    title: options.title,
    includeLetterhead: options.includeLetterhead !== false,
    mode: 'print',
  });

  return withPage(async (page) => {
    await withTimeout(
      page.setContent(html, { waitUntil: 'load' }),
      30_000,
      'Chrome tardó demasiado en preparar el documento para el PDF',
    );
    // Las fuentes embebidas (Georama) deben estar listas antes de imprimir.
    await withTimeout(
      page.evaluate('document.fonts.ready.then(() => true)'),
      15_000,
      'Chrome tardó demasiado en cargar las fuentes del PDF',
    );
    await withTimeout(
      page.evaluate(async () => {
        await Promise.all(
          Array.from(document.images).map((image) =>
            image.decode ? image.decode().catch(() => undefined) : Promise.resolve(),
          ),
        );
      }),
      15_000,
      'Chrome tardó demasiado en cargar las imágenes del PDF',
    );

    const size = PAGE_SIZES_CM[design.pageFormat] ?? PAGE_SIZES_CM.A4!;
    const landscape = design.orientation === 'landscape';
    const width = landscape ? size.height : size.width;
    const height = landscape ? size.width : size.height;

    const pdf = await withTimeout(
      page.pdf({
        width: `${width}cm`,
        height: `${height}cm`,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      }),
      60_000,
      'Chrome tardó demasiado en generar el PDF',
    );

    return Buffer.from(pdf);
  });
}

/** Guarda el PDF en disco y devuelve su ruta. */
export async function savePdf(options: PdfOptions, filename: string): Promise<string> {
  const buffer = await renderPdf(options);
  await mkdir(env.EXPORT_DIR, { recursive: true });
  const path = join(env.EXPORT_DIR, filename);
  await writeFile(path, buffer);
  return path;
}
