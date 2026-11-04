/**
 * Verifica que el nodo `pageBreak` llegue a HTML, PDF y DOCX.
 *
 *   node scripts/page-break-export-smoke.mjs [http://localhost:5173]
 *
 * Crea un documento temporal, lo guarda con un salto manual entre dos
 * párrafos, exporta los tres formatos y elimina el documento al terminar.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const OUT = '/tmp/sirpefoffice-page-break';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));

try {
  console.log('→ Login');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });

  console.log('→ Crear documento con salto manual y exportar');
  const result = await page.evaluate(async () => {
    const create = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!create.ok) throw new Error(`Crear: ${create.status} ${await create.text()}`);
    const created = await create.json();
    const id = created.document.id;

    try {
      const content = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Página uno del salto.' }] },
          { type: 'pageBreak' },
          { type: 'paragraph', content: [{ type: 'text', text: 'Página dos del salto.' }] },
        ],
      };
      const save = await fetch(`/api/documents/${id}/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          header: null,
          footer: null,
          data: {},
          title: 'Prueba salto de página',
          expectedVersion: created.document.version,
          checkpoint: false,
        }),
      });
      if (!save.ok) throw new Error(`Guardar: ${save.status} ${await save.text()}`);

      const toBase64 = async (response) => {
        if (!response.ok) throw new Error(`Exportar: ${response.status} ${await response.text()}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        const chunk = 0x8000;
        for (let index = 0; index < bytes.length; index += chunk) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
        }
        return btoa(binary);
      };

      const pdff = await fetch(`/api/documents/${id}/export/pdf`);
      const docx = await fetch(`/api/documents/${id}/export/docx`);
      const html = await (await fetch(`/api/documents/${id}/html`)).text();

      return {
        pdf: await toBase64(pdff),
        docx: await toBase64(docx),
        html,
      };
    } finally {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  const pdfPath = `${OUT}/page-break.pdf`;
  const docxPath = `${OUT}/page-break.docx`;
  await writeFile(pdfPath, Buffer.from(result.pdf, 'base64'));
  await writeFile(docxPath, Buffer.from(result.docx, 'base64'));

  console.log('→ Comprobar HTML');
  const htmlPages = (result.html.match(/class="doc-page"/g) ?? []).length;
  assert(htmlPages === 2, `El HTML debería tener 2 hojas y tiene ${htmlPages}`);
  assert(result.html.includes('Página uno del salto.'), 'Falta el primer párrafo en el HTML');
  assert(result.html.includes('Página dos del salto.'), 'Falta el segundo párrafo en el HTML');
  assert(result.html.includes('Página 1 de 2'), 'Falta la numeración de la primera hoja');
  assert(result.html.includes('Página 2 de 2'), 'Falta la numeración de la segunda hoja');

  console.log('→ Comprobar PDF');
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
  console.log(`  · páginas: ${pages}`);
  assert(pages === 2, `El PDF debería tener 2 páginas y tiene ${pages}`);

  const pdfText = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  const pdfPages = pdfText.split('\f');
  assert(pdfPages[0]?.includes('Página uno del salto.'), 'La página 1 del PDF no contiene su párrafo');
  assert(pdfPages[1]?.includes('Página dos del salto.'), 'La página 2 del PDF no contiene su párrafo');

  console.log('→ Comprobar DOCX');
  const documentXml = execFileSync('unzip', ['-p', docxPath, 'word/document.xml'], {
    encoding: 'utf8',
  });
  assert(
    documentXml.includes('w:type="page"') || documentXml.includes('pageBreakBefore'),
    'El DOCX no contiene un salto de página',
  );

  await wait(100);
  if (errors.length) throw new Error(`Errores de página:\n${errors.join('\n')}`);

  console.log('\n✅ Exportación del salto de página correcta');
  console.log(`  · ${pdfPath}`);
  console.log(`  · ${docxPath}`);
} finally {
  await browser.close();
}
