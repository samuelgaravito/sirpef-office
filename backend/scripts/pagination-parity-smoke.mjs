/**
 * Paridad de paginación entre editor, HTML, impresión, PDF y DOCX.
 *
 *   node scripts/pagination-parity-smoke.mjs [http://localhost:5173]
 *
 * Crea un diseño Letter con cabecera y pie, un documento temporal, escribe
 * contenido de varias hojas y comprueba que las cinco salidas tengan el mismo
 * número de páginas y la misma numeración.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = '/tmp/opencode/pagination-parity';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 980 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('401')) {
    errors.push(`console: ${message.text()}`);
  }
});

let documentId = null;
let designId = null;

try {
  console.log('→ Login y preparación');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('sirpefoffice:pagination', 'paged'));

  const setup = await page.evaluate(async () => {
    const designs = await (await fetch('/api/designs')).json();
    const base = designs.items?.[0];
    if (!base) throw new Error('No hay diseños para crear el fixture');

    const tokens = structuredClone(base.tokens);
    tokens.pageFormat = 'Letter';
    tokens.header = {
      ...tokens.header,
      enabled: true,
      widthPercent: 100,
      heightMm: tokens.header.heightMm ?? 18,
      images: [],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Cabecera de prueba' }],
          },
        ],
      },
    };
    tokens.footer = {
      ...tokens.footer,
      enabled: true,
      widthPercent: 100,
      heightMm: tokens.footer.heightMm ?? 16,
      images: [],
      content: 'Página {page} de {total}',
      showPageNumber: true,
      showTotal: true,
    };

    const designResponse = await fetch('/api/designs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Parity Letter ${Date.now()}`, description: '', tokens }),
    });
    const design = (await designResponse.json()).design;
    const documentResponse = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designId: design.id }),
    });
    const document = (await documentResponse.json()).document;
    const landscape = tokens.orientation === 'landscape';
    return {
      documentId: document.id,
      designId: design.id,
      pageWidthCm: landscape ? 27.94 : 21.59,
      pageHeightCm: landscape ? 21.59 : 27.94,
    };
  });
  documentId = setup.documentId;
  designId = setup.designId;

  console.log('→ Editor: escribir varias hojas');
  await page.goto(`${BASE}/documents/${documentId}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 15000 });
  await wait(800);
  await page.click('.doc-paged-flow .tiptap p');
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.type(
      `Párrafo ${index + 1}. ${'Contenido de prueba para validar la paridad de las exportaciones. '.repeat(2)}`,
    );
    await page.keyboard.press('Enter');
  }
  // Espera al autoguardado (1.4 s de debounce + petición).
  await wait(3000);

  const editor = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.doc-page-card')];
    return {
      pages: cards.length,
      height: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
    };
  });
  const expectedCardHeight = Math.round((setup.pageHeightCm * 96) / 2.54);
  console.log(`  · editor: ${editor.pages} hojas de ${editor.height} px`);
  assert(editor.pages >= 2, `El editor debería tener varias hojas, tiene ${editor.pages}`);
  assert(
    Math.abs(editor.height - expectedCardHeight) <= 2,
    `La hoja del editor mide ${editor.height} px; se esperaban ${expectedCardHeight}`,
  );

  console.log('→ Exportaciones');
  const result = await page.evaluate(async (id) => {
    const toBase64 = async (response) => {
      if (!response.ok) throw new Error(`Exportación: ${response.status} ${await response.text()}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
      }
      return btoa(binary);
    };
    return {
      html: await (await fetch(`/api/documents/${id}/html`)).text(),
      htmlExport: await (await fetch(`/api/documents/${id}/export/html`)).text(),
      pdf: await toBase64(await fetch(`/api/documents/${id}/export/pdf`)),
      docx: await toBase64(await fetch(`/api/documents/${id}/export/docx`)),
    };
  }, documentId);

  const htmlPages = (result.html.match(/class="doc-page"/g) ?? []).length;
  const footerTexts = [...new Set([...result.html.matchAll(/Página\s+\d+\s+de\s+\d+/g)].map((match) => match[0]))];
  console.log(`  · HTML: ${htmlPages} hojas · ${footerTexts.join(', ')}`);
  assert(htmlPages === editor.pages, `HTML tiene ${htmlPages} hojas y el editor ${editor.pages}`);
  const exportedHtmlPages = (result.htmlExport.match(/class="doc-page"/g) ?? []).length;
  assert(
    exportedHtmlPages === editor.pages,
    `La exportación HTML tiene ${exportedHtmlPages} hojas y el editor ${editor.pages}`,
  );
  for (let index = 1; index <= htmlPages; index += 1) {
    assert(
      footerTexts.includes(`Página ${index} de ${htmlPages}`),
      `Falta el pie «Página ${index} de ${htmlPages}» en el HTML`,
    );
  }

  const pdfPath = `${OUT}/parity.pdf`;
  const docxPath = `${OUT}/parity-docx.docx`;
  const printPath = `${OUT}/parity-print.pdf`;
  await writeFile(pdfPath, Buffer.from(result.pdf, 'base64'));
  await writeFile(docxPath, Buffer.from(result.docx, 'base64'));

  const pdfInfo = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pdfPages = Number(/^Pages:\s+(\d+)/m.exec(pdfInfo)?.[1] ?? 0);
  console.log(`  · PDF: ${pdfPages} páginas`);
  assert(pdfPages === editor.pages, `PDF tiene ${pdfPages} páginas y el editor ${editor.pages}`);

  const printPage = await browser.newPage();
  await printPage.setContent(result.html, { waitUntil: 'load' });
  await printPage.evaluate('document.fonts.ready.then(() => true)');
  await writeFile(
    printPath,
    await printPage.pdf({
      width: `${setup.pageWidthCm}cm`,
      height: `${setup.pageHeightCm}cm`,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    }),
  );
  await printPage.close();
  const printInfo = execFileSync('pdfinfo', [printPath], { encoding: 'utf8' });
  const printPages = Number(/^Pages:\s+(\d+)/m.exec(printInfo)?.[1] ?? 0);
  console.log(`  · Vista de impresión: ${printPages} páginas`);
  assert(printPages === editor.pages, `Impresión tiene ${printPages} páginas y el editor ${editor.pages}`);

  const docxXml = execFileSync('unzip', ['-p', docxPath, 'word/document.xml'], {
    encoding: 'utf8',
  });
  const docxBreaks = (docxXml.match(/w:type="page"/g) ?? []).length;
  const docxPages = docxBreaks + 1;
  console.log(`  · DOCX: ${docxPages} páginas (${docxBreaks} saltos explícitos)`);
  assert(
    docxBreaks === editor.pages - 1,
    `DOCX tiene ${docxBreaks} saltos; se esperaban ${editor.pages - 1}`,
  );
  let headerXml = '';
  try {
    headerXml = execFileSync('unzip', ['-p', docxPath, 'word/header1.xml'], {
      encoding: 'utf8',
    });
  } catch {
    /* sin cabecera separada */
  }
  assert(
    headerXml.includes('Cabecera de prueba') || docxXml.includes('Cabecera de prueba'),
    'El DOCX no contiene la cabecera',
  );

  // Si LibreOffice está disponible, comprobamos que Word/LO respeten los
  // saltos explícitos y no añadan páginas por su cuenta.
  let hasLibreOffice = true;
  try {
    execFileSync('which', ['libreoffice'], { encoding: 'utf8' });
  } catch {
    hasLibreOffice = false;
  }

  if (hasLibreOffice) {
    const loDir = `${OUT}/docx-pdf`;
    await mkdir(loDir, { recursive: true });
    execFileSync(
      'libreoffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', loDir, docxPath],
      { timeout: 120_000, stdio: 'ignore' },
    );
    const loInfo = execFileSync('pdfinfo', [`${loDir}/parity-docx.pdf`], {
      encoding: 'utf8',
    });
    const loPages = Number(/^Pages:\s+(\d+)/m.exec(loInfo)?.[1] ?? 0);
    console.log(`  · DOCX renderizado (LibreOffice): ${loPages} páginas`);
    assert(
      loPages === editor.pages,
      `LibreOffice pagina el DOCX en ${loPages} páginas y el editor tiene ${editor.pages}`,
    );
  } else {
    console.log('  · LibreOffice no disponible; se omite la conversión del DOCX');
  }

  if (errors.length) throw new Error(`Errores de consola:\n${errors.join('\n')}`);
  console.log('\n✅ Paridad de paginación correcta');
} finally {
  if (documentId) {
    await page
      .evaluate(async ({ documentId: id, designId: design }) => {
        await fetch(`/api/documents/${id}`, { method: 'DELETE' });
        if (design) await fetch(`/api/designs/${design}`, { method: 'DELETE' });
      }, { documentId, designId })
      .catch(() => undefined);
  }
  await browser.close();
}
