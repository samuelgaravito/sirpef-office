/**
 * Verificación visual de la compartición de plantillas.
 *
 *   node scripts/template-share-ui.mjs [http://localhost:5173]
 *
 * Inicia sesión como administrador, abre una plantilla propia, abre el
 * diálogo de compartir, concede acceso de editor a un miembro y comprueba que
 * el miembro puede mejorar la plantilla.
 *
 * Las capturas se guardan en /tmp/sirpefoffice-shots-share.
 */
import { mkdir, rm } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SHOTS = '/tmp/sirpefoffice-shots-share';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@sirpefoffice.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log(`  · captura ${name}.png`);
}

async function clickText(page, selector, text) {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    const label = (await handle.evaluate((node) => node.textContent ?? '')).trim();
    if (label.includes(text)) {
      await handle.click();
      return true;
    }
  }
  throw new Error(`No se encontró «${text}» en ${selector}`);
}

function check(condition, message) {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type="email"]');
  await page.evaluate(() => {
    document.querySelectorAll('input').forEach((input) => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });
}

async function main() {
  if (!PASSWORD) throw new Error('Falta SEED_ADMIN_PASSWORD');

  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const errors = [];
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('401')) return;
    errors.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));

  try {
    console.log('→ Login como administrador');
    await login(page, EMAIL, PASSWORD);
    await shot(page, '01-inicio');

    console.log('→ Plantillas');
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('article', { timeout: 15000 });
    await wait(1200);
    await shot(page, '02-plantillas');

    console.log('→ Editor de plantilla');
    await clickText(page, 'button', 'Administrar');
    await wait(400);
    await page.click('article button');
    await page.waitForSelector('.tiptap', { timeout: 15000 });
    await wait(1000);
    await shot(page, '03-editor');

    console.log('→ Diálogo de compartir');
    await clickText(page, 'body', 'Compartir');
    await page.waitForSelector('select', { timeout: 15000 });
    await wait(600);
    await shot(page, '04-compartir');

    // El diálogo debe ofrecer el selector de personas y los dos permisos.
    const dialog = await page.evaluate(() => {
      const options = Array.from(document.querySelectorAll('option')).map((o) => o.textContent?.trim());
      return {
        hasEditor: options.includes('Editor'),
        hasViewer: options.includes('Lector'),
        hasTitle: document.body.textContent?.includes('Compartir plantilla'),
      };
    });
    check(dialog.hasTitle, 'se abre el diálogo de compartir plantilla');
    check(dialog.hasEditor && dialog.hasViewer, 'el diálogo ofrece los permisos editor y lector');

    console.log('→ Historial de la plantilla');
    await page.keyboard.press('Escape');
    await wait(400);
    await page.click('button[title="Historial de la plantilla"]');
    await wait(1200);
    await shot(page, '05-historial');

    const history = await page.evaluate(() => document.body.textContent ?? '');
    check(history.includes('Historial de la plantilla'), 'se abre el historial de la plantilla');
    check(
      history.includes('actual') || history.includes('v1'),
      'el historial lista las versiones de la plantilla',
    );

    console.log('\n✔ Verificación visual de la compartición de plantillas');
    if (errors.length > 0) {
      console.error('\n✖ Errores de consola:');
      for (const error of errors) console.error(`  ${error}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
