/**
 * Prueba funcional de las imágenes A+B (redimensionar, alinear, flotar y
 * arrastrar) y de la exportación PDF/DOCX.
 *
 *   node scripts/image-smoke.mjs [http://localhost:5173]
 *
 * Requiere un PNG de prueba en /tmp/sirpefoffice-test-image.png (lo genera si falta).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SHOTS = '/tmp/sirpefoffice-shots-images';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const IMAGE = '/tmp/sirpefoffice-test-image.png';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`  · captura ${name}.png`);
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

async function main() {
  await ensureImage();
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    defaultViewport: { width: 1440, height: 900 },
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

  const results = {};
  let docId = null;

  try {
    console.log('→ Login');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });
    await page.waitForSelector('text/Empezar un documento nuevo', { timeout: 15000 });
    await wait(600);

    console.log('→ Crear documento');
    const cards = await page.$$('section:nth-of-type(1) button');
    if (cards.length > 1) await cards[1].click();
    else await cards[0].click();
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(1200);

    console.log('→ Insertar imagen');
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 10000 }),
      page.click('button[title="Insertar imagen"]'),
    ]);
    await chooser.accept([IMAGE]);
    await page.waitForSelector('.doc-paged-flow .wp-image img', { timeout: 15000 });
    await wait(800);
    await shot(page, '01-imagen-insertada');

    const inserted = await page.evaluate(() => {
      const img = document.querySelector('.doc-paged-flow .wp-image img');
      return {
        found: Boolean(img),
        src: img?.getAttribute('src')?.slice(0, 30) ?? null,
        wrapperFloat: img?.closest('.wp-image')?.getAttribute('data-float') ?? null,
      };
    });
    results.insert = inserted;
    console.log('  · imagen insertada:', JSON.stringify(inserted));

    console.log('→ Seleccionar imagen y comprobar controles');
    const imgBox = await page.$eval('.doc-paged-flow .wp-image img', (el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.mouse.click(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2);
    await wait(400);
    const hasFloatButton = await page.$$eval('button[title]', (nodes) =>
      nodes.some((node) => node.getAttribute('title')?.includes('Flotar a la izquierda')),
    );
    results.controls = hasFloatButton;
    console.log('  · controles de imagen visibles:', hasFloatButton);
    if (hasFloatButton) await shot(page, '02-controles-imagen');

    console.log('→ Flotar a la izquierda');
    const floatLeft = await page.$('button[title*="Flotar a la izquierda"]');
    if (floatLeft) {
      await floatLeft.click();
      await wait(500);
    }
    const floatState = await page.evaluate(() => {
      const wrapper = document.querySelector('.doc-paged-flow .wp-image');
      const img = wrapper?.querySelector('img');
      return {
        dataFloat: wrapper?.getAttribute('data-float') ?? null,
        cssFloat: img ? getComputedStyle(img).float : null,
        marginRight: img ? getComputedStyle(img).marginRight : null,
      };
    });
    results.floatLeft = floatState;
    console.log('  · estado flotante:', JSON.stringify(floatState));
    await shot(page, '03-flotar-izquierda');

    console.log('→ Arrastrar imagen flotante');
    const box = await page.$eval('.doc-paged-flow .wp-image img', (el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 10 });
    await page.mouse.up();
    await wait(500);
    await shot(page, '04-arrastrada');

    const dragged = await page.evaluate(() => {
      const img = document.querySelector('.doc-paged-flow .wp-image img');
      const comp = img ? getComputedStyle(img) : null;
      return { marginLeft: comp?.marginLeft ?? null, marginTop: comp?.marginTop ?? null };
    });
    results.drag = dragged;
    console.log('  · offsets tras arrastrar:', JSON.stringify(dragged));

    console.log('→ Redimensionar por esquina');
    const before = await page.$eval('.doc-paged-flow .wp-image img', (el) => el.getBoundingClientRect().width);
    const handle = await page.$('.doc-paged-flow [data-resize-handle="bottom-right"]');
    let during = before;
    if (handle) {
      const hb = await handle.boundingBox();
      results.handleBox = hb;
      if (hb && hb.width > 0) {
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(hb.x - 60, hb.y - 35, { steps: 12 });
        await wait(200);
        during = await page.$eval(
          '.doc-paged-flow .wp-image img',
          (el) => el.getBoundingClientRect().width,
        );
        await page.mouse.up();
        await wait(500);
      }
    }
    const after = await page.$eval('.doc-paged-flow .wp-image img', (el) => el.getBoundingClientRect().width);
    results.handleFound = Boolean(handle);
    results.resize = { before: Math.round(before), during: Math.round(during), after: Math.round(after) };
    console.log(`  · ancho ${Math.round(before)} → ${Math.round(during)} (durante) → ${Math.round(after)} px`);
    await shot(page, '05-redimensionada');

    console.log('→ Alineación y modos flotantes');
    // Volver a seleccionar la imagen (los controles dependen de la selección).
    const selBox = await page.$eval('.doc-paged-flow .wp-image img', (el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.mouse.click(selBox.x + selBox.width / 2, selBox.y + selBox.height / 2);
    await wait(300);

    await page.click('button[title="En línea (sin ajuste de texto)"]');
    await wait(300);
    await page.click('button[title="Alinear imagen a la derecha"]');
    await wait(400);
    results.alignRight = await page.evaluate(() => {
      const wrapper = document.querySelector('.doc-paged-flow .wp-image');
      const img = wrapper?.querySelector('img');
      const comp = img ? getComputedStyle(img) : null;
      return {
        dataFloat: wrapper?.getAttribute('data-float') ?? null,
        dataAlign: wrapper?.getAttribute('data-align') ?? null,
        cssFloat: comp?.float ?? null,
        marginLeft: comp?.marginLeft ?? null,
      };
    });
    console.log('  · alineada a la derecha:', JSON.stringify(results.alignRight));
    await shot(page, '06-alineada-derecha');

    await page.click('button[title*="Flotar a la derecha"]');
    await wait(400);
    results.floatRight = await page.evaluate(
      () => document.querySelector('.doc-paged-flow .wp-image')?.getAttribute('data-float') ?? null,
    );
    await shot(page, '07-flotar-derecha');
    console.log('  · flotante derecha:', results.floatRight);

    await page.click('button[title*="Detrás del texto"]');
    await wait(400);
    results.behind = await page.$eval('.doc-paged-flow .wp-image', (el) => {
      const comp = getComputedStyle(el);
      return {
        dataFloat: el.getAttribute('data-float'),
        position: comp.position,
        float: comp.float,
        zIndex: comp.zIndex,
        left: comp.left,
        top: comp.top,
      };
    });
    await shot(page, '08-detras-texto');
    console.log('  · detrás del texto:', JSON.stringify(results.behind));

    // Dejar el modo flotante izquierdo para comprobar la persistencia.
    await page.click('button[title*="Flotar a la izquierda"]');
    await wait(400);

    console.log('→ Autoguardado y persistencia');
    await wait(3200);
    docId = new URL(page.url()).pathname.split('/').filter(Boolean).pop() ?? null;
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.doc-paged-flow .wp-image img', { timeout: 20000 });
    await wait(1000);
    const persisted = await page.evaluate(() => {
      const wrapper = document.querySelector('.doc-paged-flow .wp-image');
      const img = wrapper?.querySelector('img');
      return {
        dataFloat: wrapper?.getAttribute('data-float') ?? null,
        marginLeft: img ? getComputedStyle(img).marginLeft : null,
        width: img ? Math.round(img.getBoundingClientRect().width) : null,
      };
    });
    results.persisted = persisted;
    console.log('  · tras recargar:', JSON.stringify(persisted));
    await shot(page, '06-persistida');

    console.log('→ Exportar PDF y DOCX');
    const exported = await page.evaluate(async (id) => {
      const get = async (format) => {
        const response = await fetch(`/api/documents/${id}/export/${format}`, {
          credentials: 'include',
        });
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return { ok: response.ok, status: response.status, base64: btoa(binary) };
      };
      return { pdf: await get('pdf'), docx: await get('docx') };
    }, docId);

    await writeFile('/tmp/wp-image-export.pdf', Buffer.from(exported.pdf.base64, 'base64'));
    await writeFile('/tmp/wp-image-export.docx', Buffer.from(exported.docx.base64, 'base64'));
    results.exportStatus = { pdf: exported.pdf.status, docx: exported.docx.status };
    console.log('  · estados:', JSON.stringify(results.exportStatus));

    const pdfHead = (await readFile('/tmp/wp-image-export.pdf')).subarray(0, 5).toString('latin1');
    let docxAnchor = false;
    try {
      const xml = execFileSync('unzip', ['-p', '/tmp/wp-image-export.docx', 'word/document.xml'], {
        encoding: 'utf8',
      });
      docxAnchor = xml.includes('wp:anchor') && xml.includes('wp:wrapSquare');
    } catch (error) {
      docxAnchor = `error: ${error.message}`;
    }
    results.pdfHead = pdfHead;
    results.docxAnchor = docxAnchor;
    console.log(`  · cabecera PDF: ${pdfHead}`);
    console.log(`  · DOCX con anclaje flotante: ${docxAnchor}`);
  } catch (error) {
    console.error('\n✗ Falló la prueba:', error.message);
    await shot(page, '99-error');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  console.log('\nResultado:', JSON.stringify(results, null, 2));
  if (errors.length) {
    console.error('\nErrores en la consola del navegador:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ Sin errores de consola');
  }
}

await main();
