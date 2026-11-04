import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesignTokens, JSONContent, ResolvedChrome, VariableValues } from '@sirpefoffice/shared';
import { PAGE_SIZES_CM } from '@sirpefoffice/shared';

import { env } from '../env.js';
import { getBrowser } from '../lib/browser.js';
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
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
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

    await page.setContent(html, { waitUntil: 'load' });
    // Las fuentes embebidas (Georama) deben estar listas antes de imprimir.
    await page.evaluate('document.fonts.ready.then(() => true)');
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((image) =>
          image.decode ? image.decode().catch(() => undefined) : Promise.resolve(),
        ),
      );
    });

    const size = PAGE_SIZES_CM[design.pageFormat] ?? PAGE_SIZES_CM.A4!;
    const landscape = design.orientation === 'landscape';
    const width = landscape ? size.height : size.width;
    const height = landscape ? size.width : size.height;

    const pdf = await page.pdf({
      width: `${width}cm`,
      height: `${height}cm`,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });

    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Guarda el PDF en disco y devuelve su ruta. */
export async function savePdf(options: PdfOptions, filename: string): Promise<string> {
  const buffer = await renderPdf(options);
  await mkdir(env.EXPORT_DIR, { recursive: true });
  const path = join(env.EXPORT_DIR, filename);
  await writeFile(path, buffer);
  return path;
}
