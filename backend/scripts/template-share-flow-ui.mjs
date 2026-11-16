/**
 * Verificación visual del flujo completo de compartición de plantillas.
 *
 *   node scripts/template-share-flow-ui.mjs [http://localhost:5173]
 *
 * El administrador comparte una plantilla propia con un miembro como editor
 * y ese miembro la mejora. Se comprueba que la mejora se aplica a la
 * plantilla original y que el historial la firma.
 *
 * Variables de entorno:
 *   SD_ADMIN_EMAIL / SD_ADMIN_PASSWORD  Credenciales del administrador.
 *   SD_MEMBER_TOKEN                     Access token del miembro (SVA).
 *
 * Las capturas se guardan en /tmp/sirpefoffice-shots-share-flow.
 */
import { mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SHOTS = '/tmp/sirpefoffice-shots-share-flow';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

/**
 * Lee una variable del entorno de la API.
 *
 * El repositorio tiene dos `.env` (raíz y backend) y pueden diferir. La API
 * carga primero `backend/.env` y después el de la raíz **sin** sobrescribir
 * lo que ya está definido, así que el guion replica esa precedencia en vez
 * de confiar en el entorno del shell.
 */
function envValue(key) {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  const values = new Map();
  // El mismo orden que `backend/src/env.ts`: backend/.env manda.
  for (const file of ['../.env', '../../.env']) {
    let content = '';
    try {
      content = readFileSync(new URL(file, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !values.has(match[1])) values.set(match[1], match[2].trim());
    }
  }
  return values.get(key) ?? '';
}

const EMAIL = envValue('SEED_ADMIN_EMAIL');
const PASSWORD = envValue('SEED_ADMIN_PASSWORD');
/** Token del miembro (los miembros vienen de SVA: no tienen contraseña local). */
const MEMBER_TOKEN = process.env.SD_MEMBER_TOKEN ?? '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log(`  · captura ${name}.png`);
}

function check(condition, message) {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

/**
 * Escribe en un campo de Vue.
 *
 * Hay que usar el setter nativo de la propiedad y disparar `input`: si se
 * asigna `value` a secas, Vue no se entera del cambio.
 */
async function fill(page, selector, value) {
  await page.evaluate(
    (sel, text) => {
      const element = document.querySelector(sel);
      if (!element) throw new Error(`No se encontró ${sel}`);
      const proto =
        element instanceof window.HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(element, text);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value,
  );
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type="email"]');
  await fill(page, 'input[type="email"]', email);
  await fill(page, 'input[type="password"]', password);
  await page.click('button[type="submit"]');
  try {
    await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });
  } catch {
    const state = await page.evaluate(() => ({
      url: location.pathname,
      email: document.querySelector('input[type="email"]')?.value,
      password: document.querySelector('input[type="password"]')?.value,
      error: document.body.textContent?.match(/Correo o contraseña[^.]*\./)?.[0] ?? '',
    }));
    throw new Error(`El login falló: ${JSON.stringify(state)}`);
  }
}

/** Elige una opción de un <select> del diálogo por su texto. */
async function selectByText(page, selector, text) {
  await page.evaluate(
    (sel, value) => {
      const root = document.querySelector(sel) ?? document;
      const select = root.querySelector('select');
      if (!select) throw new Error(`No se encontró ${sel}`);
      const option = Array.from(select.options).find((o) => o.textContent?.includes(value));
      if (!option) throw new Error(`No se encontró la opción «${value}»`);
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    selector,
    text,
  );
}

/**
 * Inicia sesión con un token ya emitido (miembros de SVA, sin contraseña
 * local).
 *
 * El token se inyecta antes de que arranque la aplicación: si se pusiera
 * después, la propia app lo borraría al limpiar la sesión caducada de
 * `/login`.
 */
async function loginWithToken(page, token) {
  await page.evaluateOnNewDocument((value) => {
    localStorage.setItem('sirpefoffice.token', value);
  }, token);
  await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle0' });
}

/** Pulsa un botón cuyo texto contenga `text`, dentro de `root` (por defecto, toda la página). */
async function clickText(page, root, text) {
  const handles = await page.$$(`${root} button`);
  for (const handle of handles) {
    const label = (await handle.evaluate((node) => node.textContent ?? '')).trim();
    if (label.includes(text)) {
      await handle.click();
      return true;
    }
  }
  throw new Error(`No se encontró «${text}» en ${root} button`);
}

async function main() {
  if (!PASSWORD || !MEMBER_TOKEN) throw new Error('Faltan SEED_ADMIN_PASSWORD o SD_MEMBER_TOKEN');

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
    // ── El administrador comparte una plantilla ──────────────────────────
    console.log('→ El administrador abre sus plantillas');
    await login(page, EMAIL, PASSWORD);
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('article', { timeout: 15000 });
    await wait(1200);

    // En modo «Usar» la tarjeta crea un documento; para editar hay que
    // entrar en «Administrar».
    await clickText(page, 'body', 'Administrar');
    await wait(400);

    // Abre la primera plantilla propia.
    await page.click('article button');
    await page.waitForSelector('.tiptap', { timeout: 15000 });
    // El nombre por defecto es «Nueva plantilla»: se espera a que llegue el
    // real para no trabajar con una plantilla en blanco.
    try {
      await page.waitForFunction(
        () => {
          const value = document.querySelector('input')?.value ?? '';
          return value !== '' && value !== 'Nueva plantilla';
        },
        { timeout: 15000 },
      );
    } catch {
      await shot(page, 'error-editor');
      const state = await page.evaluate(() => ({
        url: location.pathname,
        inputs: Array.from(document.querySelectorAll('input')).map((i) => i.value),
        body: document.body.textContent?.slice(0, 300),
      }));
      throw new Error(`La plantilla no cargó: ${JSON.stringify(state)}`);
    }
    await wait(900);
    const templateId = page.url().split('/templates/')[1]?.split(/[?#]/)[0] ?? '';
    const templateName = await page.evaluate(
      () => document.querySelector('input')?.value ?? '',
    );
    console.log(`  · url del editor: ${page.url()}`);
    console.log(`  · plantilla abierta: ${templateName} (${templateId})`);

    console.log('→ Comparte con un miembro como editor');
    await clickText(page, 'body', 'Compartir');
    await page.waitForSelector('select', { timeout: 15000 });
    await wait(500);

    // Si el acceso ya existía de una corrida anterior, se retira para
    // que el guion pueda repetirse.
    const alreadyShared = await page.evaluate(() =>
      (document.body.textContent ?? '').includes('Ana Pérez'),
    );
    if (alreadyShared) {
      await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (b) => b.getAttribute('aria-label')?.includes('Quitar acceso a Ana Pérez'),
        );
        button?.click();
      });
      await wait(1200);
    }

    // El selector de personas está en el primer <select> del diálogo.
    await selectByText(page, '[role="dialog"]', 'Ana Pérez');
    await wait(300);
    await shot(page, '01-compartiendo');
    await clickText(page, '[role="dialog"]', 'Añadir');
    await wait(1200);
    await shot(page, '02-acceso-concedido');

    const shared = await page.evaluate(() => document.body.textContent ?? '');
    check(shared.includes('Ana Pérez'), 'el acceso de Ana Pérez aparece en la lista');

    // ── El miembro mejora la plantilla ───────────────────────────────────
    console.log('→ El miembro abre la plantilla y la mejora');
    // Contexto aparte: las cookies no se comparten con la del administrador.
    const memberContext = await browser.createBrowserContext();
    const memberPage = await memberContext.newPage();
    memberPage.on('pageerror', (error) => {
      // Las vistas previas se renderizan en iframes con sandbox: sin
      // `allow-same-origin` no pueden leer `localStorage`. No es un fallo.
      const text = error.message ?? '';
      if (text.includes('localStorage') && text.includes('sandboxed')) return;
      errors.push(`pageerror: ${error.stack ?? error.message}`);
    });
    memberPage.on('response', (res) => {
      if (res.url().includes('/api/auth/')) console.log(`  · ${res.status()} ${res.url()}`);
    });
    await loginWithToken(memberPage, MEMBER_TOKEN);
    await wait(1500);
    console.log(`  · url del miembro: ${memberPage.url()}`);
    await memberPage.waitForSelector('article', { timeout: 15000 });
    await wait(1500);
    await shot(memberPage, '03-plantillas-del-miembro');

    const memberSeesIt = await memberPage.evaluate(
      (name) => document.body.textContent?.includes(name) ?? false,
      templateName,
    );
    check(memberSeesIt, 'el miembro ve la plantilla compartida en su listado');

    // Inspecciona la tarjeta de la plantilla compartida.
    const card = await memberPage.evaluate((name) => {
      const article = Array.from(document.querySelectorAll('article')).find((a) =>
        a.textContent?.includes(name),
      );
      if (!article) return null;
      return {
        meta: article.querySelectorAll('p')[1]?.textContent?.trim(),
        spans: Array.from(article.querySelectorAll('p')[1]?.children ?? []).map((s) =>
          s.textContent?.trim(),
        ),
      };
    }, templateName);
    console.log(`  · tarjeta: ${JSON.stringify(card)}`);

    const editable = await memberPage.evaluate(
      () => document.body.textContent?.includes('Editable') ?? false,
    );
    check(editable, 'la tarjeta muestra la insignia «Editable»');

    // Abre la plantilla compartida concreta.
    await memberPage.goto(`${BASE}/templates/${templateId}`, { waitUntil: 'networkidle0' });
    await memberPage.waitForSelector('.tiptap', { timeout: 15000 });
    await wait(1200);
    await shot(memberPage, '04-editor-como-colaborador');

    const banner = await memberPage.evaluate(() => document.body.textContent ?? '');
    check(
      banner.includes('Estás mejorando la plantilla de'),
      'el editor avisa de que se está mejorando la plantilla de otro',
    );

    // Edita la descripción y guarda.
    await memberPage.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.trim() === 'Ajustes',
      );
      tab?.click();
    });
    await wait(700);
    await fill(memberPage, 'textarea', 'Descripción mejorada por el colaborador');
    await wait(400);
    await shot(memberPage, '05-mejora');
    await clickText(memberPage, 'body', 'Guardar');
    await memberPage.waitForFunction(() => location.pathname === '/templates', { timeout: 15000 });
    await wait(1200);
    await shot(memberPage, '06-guardado');

    // ── El propietario ve la mejora firmada ──────────────────────────────
    console.log('→ El propietario comprueba el historial');
    await page.goto(`${BASE}/templates/${templateId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.tiptap', { timeout: 15000 });
    await wait(1200);
    await page.click('button[title="Historial de la plantilla"]');
    await wait(1400);
    await shot(page, '07-historial-del-propietario');

    const history = await page.evaluate(() => document.body.textContent ?? '');
    check(history.includes('Ana Pérez'), 'el historial muestra quién hizo la mejora');
    check(
      history.includes('Mejora de un colaborador'),
      'el historial describe la mejora del colaborador',
    );

    console.log('\n✔ Flujo visual de compartición verificado');
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
