/**
 * Prueba funcional de la paginación visual del editor.
 *
 *   node scripts/pagination-smoke.mjs [http://localhost:5173]
 *
 * Crea un documento temporal, comprueba que las hojas tengan el alto del
 * diseño (A4 por defecto), que el contenido genere hojas nuevas, que exista
 * separación entre ellas, que el toggle funcione y que el salto manual cree
 * una hoja adicional. El documento se envía a la papelera al terminar.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pressCtrlEnd(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  defaultViewport: { width: 1440, height: 980 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if (message.text().includes('401')) return;
  errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));
page.on('response', (response) => {
  if (response.status() < 400 || response.status() === 401) return;
  errors.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
});

let documentId = null;

try {
  console.log('→ Login');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });

  // La prueba siempre parte de la vista paginada, aunque otra sesión haya
  // dejado la preferencia en hoja continua.
  await page.evaluate(() => localStorage.setItem('sirpefoffice:pagination', 'paged'));

  console.log('→ Crear documento temporal');
  documentId = await page.evaluate(async () => {
    const response = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`Crear documento: ${response.status}`);
    return (await response.json()).document.id;
  });

  await page.goto(`${BASE}/documents/${documentId}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 15000 });
  await wait(800);

  const initial = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.doc-page-card')];
    return {
      count: cards.length,
      heights: cards.map((card) => Math.round(card.getBoundingClientRect().height)),
      widths: cards.map((card) => Math.round(card.getBoundingClientRect().width)),
    };
  });
  console.log(`  · hojas iniciales: ${initial.count} (${initial.heights.join(', ')} px)`);
  assert(initial.count === 1, `El documento vacío debería tener 1 hoja, tiene ${initial.count}`);
  // A4: 29.7 cm × 96 / 2.54 ≈ 1123 px; Letter: 1056 px. El documento de
  // prueba no tiene diseño, así que se usa A4.
  assert(
    Math.abs(initial.heights[0] - 1123) <= 2,
    `La hoja A4 debería medir ~1123 px y mide ${initial.heights[0]}`,
  );
  assert(
    Math.abs(initial.widths[0] - 794) <= 2,
    `El ancho A4 debería ser ~794 px y es ${initial.widths[0]}`,
  );

  console.log('→ Insertar contenido de varias hojas');
  await page.click('.doc-paged-flow .tiptap');
  await pressCtrlEnd(page);
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.type(
      `Párrafo ${index + 1}. ${'Contenido de prueba para validar la paginación automática de hojas. '.repeat(2)}`,
    );
    await page.keyboard.press('Enter');
  }
  await wait(1300);

  const paged = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.doc-page-card')];
    const spacers = [...document.querySelectorAll('.sd-page-spacer')].map((element) =>
      Math.round(element.getBoundingClientRect().height),
    );
    const bodyRects = cards.map((card) => {
      const top = card.querySelector('.doc-page-top')?.getBoundingClientRect();
      const bottom = card.querySelector('.doc-page-bottom')?.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      return {
        top: rect.top,
        bodyTop: top?.bottom ?? rect.top,
        bodyBottom: bottom?.top ?? rect.bottom,
      };
    });
    const paragraphs = [...document.querySelectorAll('.doc-paged-flow .tiptap p')].map(
      (paragraph) => paragraph.getBoundingClientRect(),
    );
    const outside = paragraphs.filter(
      (rect) =>
        !bodyRects.some(
          (body) => rect.top >= body.bodyTop - 3 && rect.bottom <= body.bodyBottom + 3,
        ),
    ).length;

    return {
      count: cards.length,
      heights: cards.map((card) => Math.round(card.getBoundingClientRect().height)),
      gaps: cards.slice(1).map((card, index) =>
        Math.round(
          card.getBoundingClientRect().top -
            (cards[index].getBoundingClientRect().top +
              cards[index].getBoundingClientRect().height),
        ),
      ),
      spacers,
      outside,
      label: document.querySelector('.doc-sheet-meta__count')?.textContent?.trim(),
    };
  });

  console.log(`  · hojas: ${paged.count} (${paged.heights.join(', ')} px)`);
  console.log(`  · huecos: ${paged.gaps.join(', ')} px · espaciadores: ${paged.spacers.join(', ')} px`);
  console.log(`  · párrafos fuera del área útil: ${paged.outside}`);
  assert(paged.count >= 2, `Se esperaban varias hojas, hay ${paged.count}`);
  assert(
    paged.heights.every((height) => Math.abs(height - 1123) <= 2),
    `Todas las hojas normales deben medir ~1123 px: ${paged.heights.join(', ')}`,
  );
  assert(
    paged.gaps.every((gap) => Math.abs(gap - 24) <= 1),
    `La separación entre hojas debe ser 24 px: ${paged.gaps.join(', ')}`,
  );
  assert(
    paged.spacers.length === paged.count - 1,
    `Se esperaban ${paged.count - 1} espaciadores y hay ${paged.spacers.length}`,
  );
  assert(paged.outside === 0, `${paged.outside} párrafos quedaron fuera del área útil`);
  assert(paged.label === `${paged.count} páginas`, `Etiqueta de páginas inesperada: ${paged.label}`);

  console.log('→ Toggle a hoja continua y de vuelta');
  await page.click('.doc-mode-toggle button:nth-child(2)');
  await wait(900);
  const continuous = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.doc-page-card')];
    return {
      count: cards.length,
      height: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
      spacers: document.querySelectorAll('.sd-page-spacer').length,
    };
  });
  assert(continuous.count === 1, `Hoja continua debe tener 1 tarjeta, tiene ${continuous.count}`);
  assert(continuous.spacers === 0, 'Hoja continua no debe tener espaciadores');
  assert(
    continuous.height > 1123,
    `La hoja continua debe crecer con el contenido y mide ${continuous.height}`,
  );
  console.log(`  · hoja continua: ${continuous.height} px`);

  await page.click('.doc-mode-toggle button:nth-child(1)');
  await wait(1000);
  const back = await page.evaluate(() => ({
    count: document.querySelectorAll('.doc-page-card').length,
    spacers: document.querySelectorAll('.sd-page-spacer').length,
    label: document.querySelector('.doc-sheet-meta__count')?.textContent?.trim(),
  }));
  assert(back.count === paged.count, `Al volver a páginas se esperaban ${paged.count} hojas, hay ${back.count}`);
  assert(back.spacers === paged.count - 1, 'No se restauraron los espaciadores al volver a páginas');
  console.log(`  · vuelta a páginas: ${back.count} hojas`);

  console.log('→ Salto de página manual');
  await page.click('.doc-paged-flow .tiptap p:first-of-type');
  await page.waitForFunction(
    () => Boolean(document.activeElement?.closest('.tiptap')),
    { timeout: 5000 },
  );
  const beforeBreakCards = await page.$$eval('.doc-page-card', (elements) => elements.length);
  const beforeBreaks = await page.$$eval('.page-break', (elements) => elements.length);
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await wait(1000);
  const afterBreaks = await page.$$eval('.page-break', (elements) => elements.length);
  const afterBreakCards = await page.$$eval('.doc-page-card', (elements) => elements.length);
  assert(afterBreaks === beforeBreaks + 1, 'Ctrl+Enter no insertó un salto de página');
  assert(
    afterBreakCards >= beforeBreakCards,
    `El salto manual no generó una hoja nueva (${beforeBreakCards} → ${afterBreakCards})`,
  );
  console.log(`  · saltos manuales: ${afterBreaks} · hojas: ${afterBreakCards}`);

  await page.screenshot({ path: '/tmp/opencode/pagination-smoke.png' });
  await page.evaluate(() => {
    const main = document.querySelector('main.overflow-auto');
    if (main) main.scrollTop = 1000;
  });
  await wait(400);
  await page.screenshot({ path: '/tmp/opencode/pagination-gap.png' });
  console.log('  · capturas /tmp/opencode/pagination-smoke.png y pagination-gap.png');

  if (errors.length) throw new Error(`Errores de consola:\n${errors.join('\n')}`);
  console.log('\n✅ Paginación visual correcta');
} finally {
  if (documentId) {
    const status = await page
      .evaluate(async (id) => {
        const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
        return response.status;
      }, documentId)
      .catch(() => 'error');
    console.log(`→ Limpieza del documento temporal: ${status}`);
  }
  await browser.close();
}
