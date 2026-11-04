/**
 * Regresión de las imágenes globales de cabecera/pie en el PDF.
 *
 *   npm run smoke:pdf-bands
 *
 * Genera diseños con imágenes de banda y comprueba que:
 * - el PDF tiene exactamente las mismas páginas que la paginación (sin hojas
 *   fantasma por desbordamiento de una imagen),
 * - cada imagen conserva la coordenada en mm de su banda (no la desplaza el
 *   margen entre bloques del contenido),
 * - ninguna hoja desborda su altura física.
 *
 * No necesita la API ni la base de datos: usa el mismo renderizador que la
 * exportación real y un Chrome headless.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import { DEFAULT_DESIGN_TOKENS, resolveChrome } from '@sirpefoffice/shared';
import type { BandImage, DesignTokens, JSONContent } from '@sirpefoffice/shared';

import { renderPdf } from '../src/export/pdf.js';
import { closeBrowser, getBrowser } from '../src/lib/browser.js';
import { paginateDocument } from '../src/lib/paginate.js';
import { buildPaginatedDocumentHtml } from '../src/lib/render.js';

const OUT = '/tmp/opencode/pdf-band-images';

/** PNG 1×1 transparente; se estira al tamaño configurado en la banda. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bandImage(id: string, heightMm: number): BandImage {
  return {
    id,
    src: PNG,
    xMm: 0,
    yMm: 0,
    widthMm: 200,
    heightMm,
    fit: 'fill',
    opacity: 1,
    zIndex: 1,
  };
}

function buildDesign(bandHeightMm: number, imageHeightMm: number): DesignTokens {
  const design = structuredClone(DEFAULT_DESIGN_TOKENS);
  design.pageFormat = 'A4';
  design.margins = { ...design.margins, top: 1.5, bottom: 1.5 };
  design.logo = { enabled: false, dataUrl: '', width: 120, align: 'center' };
  design.letterhead = { enabled: false, title: '', subtitle: '', align: 'center' };
  design.header = {
    enabled: true,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cabecera' }] }],
    },
    align: 'center',
    heightMm: bandHeightMm,
    widthPercent: 100,
    images: [bandImage('header', imageHeightMm)],
  };
  design.footer = {
    enabled: true,
    content: 'Página {page} de {total}',
    align: 'center',
    showPageNumber: true,
    showTotal: true,
    heightMm: bandHeightMm,
    widthPercent: 100,
    images: [bandImage('footer', imageHeightMm)],
  };
  return design;
}

async function check(label: string, design: DesignTokens): Promise<void> {
  const content: JSONContent = {
    type: 'doc',
    content: Array.from({ length: 8 }, (_, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Párrafo ${index + 1}. Contenido de prueba.` }],
    })),
  };
  const chrome = resolveChrome({ design });
  const paginated = await paginateDocument({ content, design, chrome, values: {} });

  const pdf = await renderPdf({ content, design, chrome, values: {}, title: label });
  const pdfPath = `${OUT}/${label}.pdf`;
  await writeFile(pdfPath, pdf);

  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pdfPages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
  assert(
    pdfPages === paginated.layout.pageBlocks.length,
    `${label}: el PDF tiene ${pdfPages} páginas y el layout ${paginated.layout.pageBlocks.length}`,
  );
  assert(
    !paginated.layout.pageHeightsPx.some((height) => height > paginated.layout.pageHeightPx + 0.01),
    `${label}: una hoja del layout supera la altura física`,
  );

  const html = buildPaginatedDocumentHtml({
    content,
    preparedContent: paginated.content,
    pageLayout: paginated.layout,
    design,
    chrome,
    values: {},
    title: label,
    mode: 'print',
  });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready.then(() => true)');

    const measured = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll('.doc-page'));
      const images = Array.from(document.querySelectorAll('.doc-chrome-image')).map((image) => {
        const band = image.closest('.doc-header-band, .doc-footer-band') as HTMLElement | null;
        const imageRect = image.getBoundingClientRect();
        const bandRect = band?.getBoundingClientRect();
        return {
          band: band?.className ?? '',
          top: bandRect ? imageRect.top - bandRect.top : Number.NaN,
          left: bandRect ? imageRect.left - bandRect.left : Number.NaN,
        };
      });
      return {
        pages: pages.length,
        overflows: pages.map((sheet) => sheet.scrollHeight - sheet.clientHeight),
        images,
      };
    });

    assert(
      measured.pages === paginated.layout.pageBlocks.length,
      `${label}: el HTML tiene ${measured.pages} hojas y el layout ${paginated.layout.pageBlocks.length}`,
    );
    assert(
      measured.overflows.every((overflow) => overflow <= 1),
      `${label}: desbordamiento de hoja (${measured.overflows.join(', ')} px)`,
    );
    assert(measured.images.length === 2, `${label}: faltan imágenes de banda en el HTML`);

    for (const image of measured.images) {
      assert(
        Math.abs(image.top) <= 0.5,
        `${label}: la imagen de ${image.band} está desplazada ${image.top.toFixed(2)} px en vertical`,
      );
      assert(
        Math.abs(image.left) <= 0.5,
        `${label}: la imagen de ${image.band} está desplazada ${image.left.toFixed(2)} px en horizontal`,
      );
    }

    console.log(`  · ${label}: ${pdfPages} página(s), imágenes alineadas con su banda`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

try {
  // Caso normal: la imagen ocupa exactamente el alto de la banda.
  await check('coincide', buildDesign(20, 20));
  // Caso heredado con datos descuadrados: la imagen es más alta que la banda
  // (como la plantilla ACTA) y aun así no debe crear una página en blanco.
  await check('imagen-mas-alta', buildDesign(18, 20));

  console.log('\n✅ Imágenes de cabecera/pie alineadas y sin páginas extra');
} finally {
  await closeBrowser();
}
