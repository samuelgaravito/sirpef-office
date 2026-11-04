/**
 * Prueba funcional de cabecera y pie editables (documento y plantilla).
 *
 *   node scripts/chrome-smoke.mjs [http://localhost:5173]
 *
 * Recorre la UI real, comprueba la herencia documento → plantilla → diseño,
 * edita bandas con texto, imagen, tokens {page}/{total} y alto, exporta
 * PDF/DOCX y verifica la numeración y las imágenes embebidas.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const API = process.env.SD_API ?? 'http://localhost:3101/api';
const SHOTS = '/tmp/sirpefoffice-shots-chrome';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const IMAGE = '/tmp/sirpefoffice-test-image.png';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`  · captura ${name}.png`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Genera un PNG RGB de 240×140 si no existe. */
async function ensureImage() {
  try {
    await readFile(IMAGE);
    return;
  } catch {
    /* generar */
  }
  const { deflateSync } = await import('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const W = 240;
  const H = 140;
  const rows = [];
  for (let y = 0; y < H; y += 1) {
    const row = [0];
    for (let x = 0; x < W; x += 1) {
      row.push(30 + Math.round((180 * x) / W), 90 + Math.round((120 * y) / H), 160);
    }
    rows.push(Buffer.from(row));
  }
  const raw = Buffer.concat(rows);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(IMAGE, png);
}

/** Cliente contra la API reutilizando las cookies de la sesión del navegador. */
function apiClient(page) {
  let cookieHeader = '';
  async function refreshCookies() {
    const cookies = await page.cookies(BASE);
    cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }
  async function request(path, init = {}) {
    if (!cookieHeader) await refreshCookies();
    const headers = { ...(init.headers ?? {}), cookie: cookieHeader };
    const response = await fetch(`${API}${path}`, { ...init, headers });
    return response;
  }
  return {
    refreshCookies,
    async json(path, init) {
      const response = await request(path, init);
      if (!response.ok) {
        throw new Error(`API ${init?.method ?? 'GET'} ${path} → ${response.status}: ${await response.text()}`);
      }
      return response.json();
    },
    async buffer(path, init) {
      const response = await request(path, init);
      if (!response.ok) {
        throw new Error(`API ${init?.method ?? 'GET'} ${path} → ${response.status}: ${await response.text()}`);
      }
      return Buffer.from(await response.arrayBuffer());
    },
    post(path, body) {
      return this.json(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    patch(path, body) {
      return this.json(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    put(path, body) {
      return this.json(path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    delete(path) {
      return this.json(path, { method: 'DELETE' });
    },
  };
}

/** Repite la consulta hasta que se cumpla la condición. */
async function waitForApi(fn, predicate, label, timeout = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await fn();
    if (predicate(last)) return last;
    await wait(500);
  }
  throw new Error(`Tiempo agotado esperando ${label}. Último valor: ${JSON.stringify(last).slice(0, 800)}`);
}

async function openTemplateFromHome(page, name) {
  await page.waitForFunction(
    (templateName) => {
      const section = Array.from(document.querySelectorAll('section')).find((item) =>
        item.textContent?.includes('Empezar un documento nuevo'),
      );
      return Array.from(section?.querySelectorAll('button') ?? []).some((button) =>
        button.textContent?.includes(templateName),
      );
    },
    { timeout: 15000 },
    name,
  );
  const opened = await page.evaluate((templateName) => {
    const section = Array.from(document.querySelectorAll('section')).find((item) =>
      item.textContent?.includes('Empezar un documento nuevo'),
    );
    const target = Array.from(section?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes(templateName),
    );
    if (!target) return false;
    target.click();
    return true;
  }, name);
  if (!opened) throw new Error(`No se encontró la plantilla «${name}» en el inicio`);
}

async function clickChromeButton(page, title) {
  await page.waitForSelector(`button[title="${title}"]`, { timeout: 10000 });
  await page.click(`button[title="${title}"]`);
}

async function openChromeMode(page, title) {
  // Las bandas pueden estar visibles en modo lectura; la barra solo aparece al editar.
  if (!(await page.$('.wp-chrome-band__bar'))) {
    await clickChromeButton(page, title);
  }
  await page.waitForSelector('.wp-chrome-band--header', { timeout: 10000 });
  await page.waitForSelector('.wp-chrome-band--footer', { timeout: 10000 });
  await page.waitForSelector('.wp-chrome-band__bar', { timeout: 10000 });
  await wait(300);
}

async function bandText(page, kind) {
  return page.$eval(`.wp-chrome-band--${kind} .tiptap`, (node) => node.textContent?.trim() ?? '');
}

async function setHeight(page, kind, value) {
  await page.$eval(
    `.wp-chrome-band--${kind} input[type="number"]`,
    (input, next) => {
      input.value = String(next);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}

async function main() {
  await ensureImage();
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    defaultViewport: { width: 1440, height: 920 },
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('401')) return;
    errors.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));

  const api = apiClient(page);
  let documentId = null;
  let templateId = null;
  let designId = null;

  try {
    console.log('→ Login');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });
    await page.waitForSelector('text/Documentos recientes', { timeout: 15000 });
    await api.refreshCookies();

    console.log('→ Crear documento desde «Certificado»');
    await openTemplateFromHome(page, 'Certificado');
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(1200);
    documentId = page.url().match(/\/documents\/([0-9a-f-]{36})/)?.[1] ?? null;
    assert(documentId, 'No se pudo obtener el id del documento desde la URL');
    const initial = await api.json(`/documents/${documentId}`);
    assert(initial.chrome.headerSource !== 'document', 'El documento nuevo no debería tener cabecera propia');
    assert(initial.chrome.footerSource !== 'document', 'El documento nuevo no debería tener pie propio');

    if (initial.chrome.footer.enabled) {
      const readingPreview = await page.evaluate(() => {
        const sheet = document.querySelector('.doc-page-card');
        const footer = sheet?.querySelector('.wp-chrome-band--footer');
        if (!sheet || !footer) return { footer: false, bars: 0, bottomGap: null };
        const sheetRect = sheet.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const pages = document.querySelector('.doc-pages');
        const cm = Number.parseFloat(
          pages ? getComputedStyle(pages).getPropertyValue('--sheet-height') : '0',
        );
        const pageHeight = (cm * 96) / 2.54;
        return {
          footer: true,
          bars: document.querySelectorAll('.wp-chrome-band__bar').length,
          bottomGap: Math.round((sheetRect.bottom - footerRect.bottom) * 10) / 10,
          extraHeight: Math.round((sheetRect.height - pageHeight) * 10) / 10,
        };
      });
      assert(readingPreview.footer, 'El pie no se muestra en el documento sin abrir el modo de edición');
      assert(readingPreview.bars === 0, 'La barra de edición no debería verse antes de abrirla');
      assert(
        Math.abs(readingPreview.bottomGap ?? 99) <= 2,
        `El pie no está pegado al final de la hoja (${readingPreview.bottomGap}px)`,
      );
      assert(
        (readingPreview.extraHeight ?? 99) <= 2,
        `El pie no debe alargar la hoja en modo lectura (${readingPreview.extraHeight}px)`,
      );
      console.log('  · pie visible y anclado al final de la hoja en modo lectura');
    }

    console.log('→ Abrir cabecera y pie');
    await openChromeMode(page, 'Editar cabecera y pie de página');
    let headerSource = await page.$eval('.wp-chrome-band--header .wp-chrome-band__source', (n) => n.textContent?.trim());
    let footerSource = await page.$eval('.wp-chrome-band--footer .wp-chrome-band__source', (n) => n.textContent?.trim());
    assert(headerSource?.includes('Heredado'), `Cabecera inesperada: ${headerSource}`);
    assert(footerSource?.includes('Heredado'), `Pie inesperado: ${footerSource}`);
    await shot(page, '01-bandas-heredadas');

    console.log('→ Editar cabecera, insertar imagen y token de página');
    await page.click('.wp-chrome-band--header .tiptap');
    await page.keyboard.type('Cabecera UI · ');
    await page.waitForSelector('button[title="Insertar «Página 1 de 1»"]', { timeout: 5000 });
    await page.click('button[title="Insertar «Página 1 de 1»"]');

    const [chooser] = await Promise.all([
      page.waitForFileChooser(),
      page.click('button[title="Insertar imagen"]'),
    ]);
    await chooser.accept([IMAGE]);
    await page.waitForSelector('.wp-chrome-band--header img', { timeout: 8000 });
    await setHeight(page, 'header', 28);

    console.log('→ Editar pie y token de página');
    await page.click('.wp-chrome-band--footer .tiptap');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type('Pie UI · ');
    await page.waitForSelector('button[title="Insertar «Página 1 de 1»"]', { timeout: 5000 });
    await page.click('button[title="Insertar «Página 1 de 1»"]');
    await setHeight(page, 'footer', 20);
    await wait(2500);
    await shot(page, '02-bandas-editadas');

    const edited = await waitForApi(
      () => api.json(`/documents/${documentId}`),
      (detail) => detail.document.header?.enabled === true && detail.document.footer?.enabled === true,
      'que se guarden las bandas',
    );
    const headerJson = JSON.stringify(edited.chrome.header.content);
    const footerJson = JSON.stringify(edited.chrome.footer.content);
    assert(headerJson.includes('Cabecera UI'), 'La cabecera guardada no contiene el texto editado');
    assert(headerJson.includes('{page}') && headerJson.includes('{total}'), 'La cabecera no contiene los tokens');
    assert(headerJson.includes('image'), 'La cabecera no contiene la imagen');
    assert(footerJson.includes('Pie UI'), 'El pie guardado no contiene el texto editado');
    assert(footerJson.includes('{page}') && footerJson.includes('{total}'), 'El pie no contiene los tokens');
    assert(edited.chrome.header.heightMm === 28, `Alto de cabecera inesperado: ${edited.chrome.header.heightMm}`);
    assert(edited.chrome.footer.heightMm === 20, `Alto de pie inesperado: ${edited.chrome.footer.heightMm}`);
    assert(edited.chrome.headerSource === 'document', 'La cabecera no figura como propia del documento');
    assert(edited.chrome.footerSource === 'document', 'El pie no figura como propio del documento');

    console.log('→ Añadir contenido para forzar varias páginas');
    const longContent = JSON.parse(JSON.stringify(edited.document.content));
    longContent.content = [
      ...(longContent.content ?? []),
      ...Array.from({ length: 140 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `Párrafo de prueba ${index + 1}` }],
      })),
    ];
    await api.put(`/documents/${documentId}/content`, {
      content: longContent,
      expectedVersion: edited.document.version,
    });

    console.log('→ Exportar PDF y DOCX');
    const pdf = await api.buffer(`/documents/${documentId}/export/pdf`);
    await writeFile('/tmp/wp-chrome-smoke.pdf', pdf);
    assert(pdf.subarray(0, 5).toString() === '%PDF-', 'El PDF no tiene cabecera %PDF');
    const pdfInfo = execFileSync('pdfinfo', ['/tmp/wp-chrome-smoke.pdf'], { encoding: 'utf8' });
    const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    assert(pageCount >= 2, `El PDF debería tener varias páginas y tiene ${pageCount}`);
    const pdfText = execFileSync('pdftotext', ['-layout', '/tmp/wp-chrome-smoke.pdf', '-'], {
      encoding: 'utf8',
    });
    assert(pdfText.includes('Cabecera UI'), 'El PDF no incluye la cabecera personalizada');
    assert(pdfText.includes('Pie UI'), 'El PDF no incluye el pie personalizado');
    const pageNumbers = [...pdfText.matchAll(/Página (\d+) de (\d+)/g)].map((match) => ({
      page: Number(match[1]),
      total: Number(match[2]),
    }));
    const total = pageNumbers[0]?.total ?? 0;
    assert(total === pageCount, `La numeración del PDF no coincide: ${total} vs ${pageCount}`);
    assert(
      pageNumbers.some((item) => item.page === 1) && pageNumbers.some((item) => item.page === 2),
      'El PDF no numera al menos las dos primeras páginas',
    );
    assert(
      pageNumbers.every((item) => item.total === total),
      'El total de páginas no es consistente en el PDF',
    );
    const imageList = execFileSync('pdfimages', ['-list', '/tmp/wp-chrome-smoke.pdf'], { encoding: 'utf8' });
    assert(/\bimage\b/.test(imageList), 'El PDF no contiene la imagen de cabecera');

    const docx = await api.buffer(`/documents/${documentId}/export/docx`);
    await writeFile('/tmp/wp-chrome-smoke.docx', docx);
    await rm('/tmp/wp-chrome-smoke-docx', { recursive: true, force: true });
    await mkdir('/tmp/wp-chrome-smoke-docx', { recursive: true });
    execFileSync('unzip', ['-q', '/tmp/wp-chrome-smoke.docx', '-d', '/tmp/wp-chrome-smoke-docx']);
    const headerXml = await readFile('/tmp/wp-chrome-smoke-docx/word/header1.xml', 'utf8');
    const footerXml = await readFile('/tmp/wp-chrome-smoke-docx/word/footer1.xml', 'utf8');
    assert(headerXml.includes('CABECERA') || headerXml.includes('Cabecera'), 'El DOCX no incluye la cabecera');
    assert(headerXml.includes('PAGE') && headerXml.includes('NUMPAGES'), 'El DOCX no incluye campos de página');
    assert(footerXml.includes('Pie UI'), 'El DOCX no incluye el pie');
    assert(headerXml.includes('<w:drawing') || headerXml.includes('blip'), 'El DOCX no incluye la imagen');
    const media = execFileSync('ls', ['/tmp/wp-chrome-smoke-docx/word/media'], { encoding: 'utf8' });
    assert(media.trim().length > 0, 'El DOCX no tiene medios embebidos');

    console.log('→ Recargar y comprobar persistencia');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(800);
    await openChromeMode(page, 'Editar cabecera y pie de página');
    headerSource = await page.$eval('.wp-chrome-band--header .wp-chrome-band__source', (n) => n.textContent?.trim());
    footerSource = await page.$eval('.wp-chrome-band--footer .wp-chrome-band__source', (n) => n.textContent?.trim());
    assert(headerSource?.includes('Personalizado'), `La cabecera no persistió: ${headerSource}`);
    assert(footerSource?.includes('Personalizado'), `El pie no persistió: ${footerSource}`);
    assert((await bandText(page, 'header')).includes('Cabecera UI'), 'La cabecera no se recuperó tras recargar');
    assert((await bandText(page, 'footer')).includes('Pie UI'), 'El pie no se recuperó tras recargar');
    const headerHeight = await page.$eval(
      '.wp-chrome-band--header input[type="number"]',
      (input) => Number(input.value),
    );
    assert(headerHeight === 28, `Alto recuperado inesperado: ${headerHeight}`);
    await shot(page, '03-recarga');

    console.log('→ Restablecer cabecera y pie al heredado');
    await page.click('.wp-chrome-band--header button[title="Quitar la personalización y volver a heredar"]');
    await page.click('.wp-chrome-band--footer button[title="Quitar la personalización y volver a heredar"]');
    const reset = await waitForApi(
      () => api.json(`/documents/${documentId}`),
      (detail) => detail.document.header === null && detail.document.footer === null,
      'que se restablezcan las bandas',
    );
    assert(reset.chrome.headerSource !== 'document', 'La cabecera sigue siendo propia tras restablecer');
    assert(reset.chrome.footerSource !== 'document', 'El pie sigue siendo propio tras restablecer');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(800);
    await openChromeMode(page, 'Editar cabecera y pie de página');
    headerSource = await page.$eval('.wp-chrome-band--header .wp-chrome-band__source', (n) => n.textContent?.trim());
    assert(headerSource?.includes('Heredado'), `La cabecera no volvió a heredarse: ${headerSource}`);
    assert(!(await bandText(page, 'header')).includes('Cabecera UI'), 'La cabecera personalizada sigue visible');
    const inheritedFooter = await bandText(page, 'footer');
    assert(
      inheritedFooter.includes('Página') && inheritedFooter.includes('{page}'),
      `El pie heredado no muestra la numeración: ${inheritedFooter}`,
    );
    await shot(page, '04-restablecido');

    console.log('→ Herencia y cambio de diseño en plantilla');
    const designs = await api.json('/designs');
    assert(designs.items.length > 0, 'No hay diseños para la prueba de plantilla');
    const baseDesign = await api.json(`/designs/${designs.items[0].id}`);
    const tokens = structuredClone(baseDesign.design.tokens);
    tokens.footer = {
      ...tokens.footer,
      enabled: true,
      content: 'PIE DEL DISEÑO UI · {page} de {total}',
      align: 'center',
      images: [],
    };
    tokens.header = { ...tokens.header, enabled: false, images: [] };
    const testDesign = await api.post('/designs', {
      name: 'Diseño chrome smoke',
      description: 'temporal',
      tokens,
      isShared: false,
    });
    designId = testDesign.design.id;

    const testTemplate = await api.post('/templates', {
      name: 'Plantilla chrome smoke',
      description: 'temporal',
      docType: 'letter',
      designId,
      schema: [],
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cuerpo de prueba.' }] }],
      },
      header: null,
      footer: null,
      isShared: false,
    });
    templateId = testTemplate.template.id;

    await page.goto(`${BASE}/templates/${templateId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(900);
    await openChromeMode(page, 'Editar cabecera y pie de la plantilla');
    assert(
      (await bandText(page, 'footer')).includes('PIE DEL DISEÑO UI'),
      'La plantilla no muestra el pie heredado del diseño',
    );

    console.log('→ Comprobar el pie de plantilla en modo lectura');
    await clickChromeButton(page, 'Editar cabecera y pie de la plantilla');
    await wait(300);
    const templateReading = await page.evaluate(() => {
      const sheet = document.querySelector('.doc-page-card');
      const footer = sheet?.querySelector('.wp-chrome-band--footer');
      if (!sheet || !footer) return { footer: false, bars: 0, bottomGap: null };
      const sheetRect = sheet.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const pages = document.querySelector('.doc-pages');
      const cm = Number.parseFloat(
        pages ? getComputedStyle(pages).getPropertyValue('--sheet-height') : '0',
      );
      const pageHeight = (cm * 96) / 2.54;
      return {
        footer: true,
        bars: document.querySelectorAll('.wp-chrome-band__bar').length,
        bottomGap: Math.round((sheetRect.bottom - footerRect.bottom) * 10) / 10,
        extraHeight: Math.round((sheetRect.height - pageHeight) * 10) / 10,
      };
    });
    assert(templateReading.footer, 'El pie no se muestra en la plantilla sin abrir el modo de edición');
    assert(templateReading.bars === 0, 'La barra de edición de la plantilla debería estar oculta');
    assert(
      Math.abs(templateReading.bottomGap ?? 99) <= 2,
      `El pie de la plantilla no está pegado al final (${templateReading.bottomGap}px)`,
    );
    assert(
      (templateReading.extraHeight ?? 99) <= 2,
      `El pie no debe alargar la plantilla (${templateReading.extraHeight}px)`,
    );
    await openChromeMode(page, 'Editar cabecera y pie de la plantilla');
    await shot(page, '05-plantilla-heredada');

    console.log('→ Editar pie de plantilla y guardar');
    await page.click('.wp-chrome-band--footer .tiptap');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type('PIE DE PLANTILLA UI · ');
    await page.waitForSelector('button[title="Insertar «Página 1 de 1»"]', { timeout: 5000 });
    await page.click('button[title="Insertar «Página 1 de 1»"]');
    await page.click('header button.btn-primary');
    const savedTemplate = await waitForApi(
      () => api.json(`/templates/${templateId}`),
      (detail) => detail.template.footer?.enabled === true,
      'que se guarde el pie de plantilla',
    );
    assert(
      JSON.stringify(savedTemplate.template.footer.content).includes('PIE DE PLANTILLA UI'),
      'El pie de plantilla no se guardó',
    );
    await shot(page, '06-plantilla-editada');

    console.log('→ Restablecer pie de plantilla y cambiar de diseño');
    // Guardar la plantilla devuelve a la lista; se vuelve a abrir para probar
    // que el pie persistió tras la recarga.
    await page.goto(`${BASE}/templates/${templateId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(800);
    await openChromeMode(page, 'Editar cabecera y pie de la plantilla');
    let tplFooterSource = await page.$eval(
      '.wp-chrome-band--footer .wp-chrome-band__source',
      (n) => n.textContent?.trim(),
    );
    assert(tplFooterSource?.includes('Personalizado'), `El pie de plantilla no persistió: ${tplFooterSource}`);
    await page.click('.wp-chrome-band--footer button[title="Quitar la personalización y volver a heredar"]');
    await page.click('header button.btn-primary');
    await waitForApi(
      () => api.json(`/templates/${templateId}`),
      (detail) => detail.template.footer === null,
      'que se restablezca el pie de plantilla',
    );

    // Guardar también devuelve a la lista de plantillas.
    await page.goto(`${BASE}/templates/${templateId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });

    // Cambia el diseño de la plantilla a "sin diseño" y comprueba que la banda
    // heredada se sincroniza con el pie por defecto.
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('aside button')).find(
        (item) => item.textContent?.trim() === 'Ajustes',
      );
      button?.click();
    });
    await wait(400);
    const changed = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const select = selects.find((item) =>
        Array.from(item.options).some((option) => option.textContent?.includes('Sin diseño')),
      );
      if (!select) return false;
      const option = Array.from(select.options).find((item) =>
        item.textContent?.includes('Sin diseño'),
      );
      if (!option) return false;
      select.selectedIndex = Array.from(select.options).indexOf(option);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    assert(changed, 'No se encontró el selector de diseño');
    await wait(700);
    const changedFooter = await bandText(page, 'footer');
    // Los tokens {page}/{total} se muestran resueltos en el editor (1 de 1).
    assert(
      changedFooter.includes('Página') &&
        changedFooter.includes('de') &&
        !changedFooter.includes('PIE DE PLANTILLA UI'),
      `La banda no se actualizó al cambiar de diseño: ${changedFooter}`,
    );
    await shot(page, '07-plantilla-sin-diseno');

    console.log('\n✓ Cabecera y pie: UI, herencia, persistencia y exportación correctos');
  } catch (error) {
    console.error('\n✗ Falló la prueba:', error.message);
    await shot(page, '99-error');
    process.exitCode = 1;
  } finally {
    // Limpieza de los datos temporales creados por la prueba.
    try {
      if (templateId) await api.delete(`/templates/${templateId}`);
    } catch (error) {
      console.error('No se pudo borrar la plantilla temporal:', error.message);
    }
    try {
      if (designId) await api.delete(`/designs/${designId}`);
    } catch (error) {
      console.error('No se pudo borrar el diseño temporal:', error.message);
    }
    try {
      if (documentId) await api.delete(`/documents/${documentId}`);
    } catch (error) {
      console.error('No se pudo borrar el documento temporal:', error.message);
    }

    await browser.close();
  }

  if (errors.length) {
    console.error('\nErrores en la consola del navegador:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('✓ Sin errores de consola');
  }
}

await main();
