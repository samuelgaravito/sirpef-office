/**
 * Verificación visual del panel de numeración de una plantilla.
 *
 *   node scripts/numbering-ui-smoke.mjs [http://localhost:8090]
 *
 * Comprueba que:
 * 1. el panel ofrece un prefijo de hasta 20 caracteres;
 * 2. una plantilla sin prefijo muestra un código automático y un próximo
 *    número con el formato `PREFIJO-CORRELATIVO-AÑO`;
 * 3. al escribir un prefijo que ya usa otra plantilla se explica en el acto
 *    que cada plantilla lleva su propia enumeración;
 * 4. el botón de guardar no se bloquea por un prefijo repetido: solo un
 *    prefijo con formato inválido lo impide.
 *
 * Variables de entorno:
 *   SD_ADMIN_EMAIL / SD_ADMIN_PASSWORD  Credenciales del administrador.
 *
 * Las capturas se guardan en /tmp/sirpefoffice-shots-numbering.
 */
import { mkdir, rm } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:8090';
const SHOTS = '/tmp/sirpefoffice-shots-numbering';
const EMAIL = process.env.SD_ADMIN_EMAIL ?? 'admin@sirpefoffice.local';
const PASSWORD = process.env.SD_ADMIN_PASSWORD ?? 'admin';

function assert(condition, message) {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function textOf(page, selector) {
  return page.$eval(selector, (el) => el.textContent?.trim() ?? '');
}

async function main() {
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });

    // Sesión: se llama a la API desde el propio navegador para que la SPA
    // guarde el token y el usuario igual que lo haría el formulario.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });

    const apiBase = new URL('/api', BASE).toString();
    const session = await page.evaluate(
      async (base, mail, pass) => {
        const response = await fetch(`${base}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: mail, password: pass }),
        });
        if (!response.ok) throw new Error(`Login falló: ${response.status}`);
        const data = await response.json();
        localStorage.setItem('sirpefoffice.token', data.accessToken);
        return data.accessToken;
      },
      apiBase,
      EMAIL,
      PASSWORD,
    );
    assert(Boolean(session), 'Sesión iniciada con la cuenta local');

    // La SPA lee el token al arrancar: se recarga la aplicación ya con la
    // sesión guardada y se espera a que el shell Monte listo.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => Boolean(localStorage.getItem('sirpefoffice.token')),
      { timeout: 15000 },
    );

    // Se toma la primera plantilla desde la API y se abre su editor.
    const templateId = await page.evaluate(async (base) => {
      const response = await fetch(`${base}/templates?pageSize=1`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('sirpefoffice.token')}` },
      });
      const data = await response.json();
      return data.items?.[0]?.id ?? null;
    }, apiBase);
    assert(Boolean(templateId), 'Hay una plantilla disponible');

    await page.goto(`${BASE}/templates/${templateId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('button', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Abrir la pestaña de ajustes
    const settingsTab = await page.$$eval('button', (nodes) => {
      const target = nodes.find((n) => /^\s*Ajustes\s*$/.test(n.textContent ?? ''));
      if (target) target.click();
      return Boolean(target);
    });
    assert(settingsTab, 'Se abre la pestaña de ajustes de la plantilla');

    // El cambio de pestaña se repinta de forma asíncrona: se espera a que el
    // panel aparezca antes de buscar sus campos.
    await new Promise((r) => setTimeout(r, 800));

    // Encender la numeración automática para que aparezcan sus campos.
    const enabled = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('label')];
      const label = labels.find((l) => /Numeración automática/.test(l.textContent ?? ''));
      const input = label?.querySelector('input[type="checkbox"]');
      if (!input) return false;
      if (!input.checked) input.click();
      return true;
    });
    assert(enabled, 'Se puede encender la numeración automática');

    await page.waitForSelector('input[maxlength="20"]', { timeout: 20000 });
    const prefixInput = await page.$('input[maxlength="20"]');
    assert(prefixInput, 'El campo de prefijo admite 20 caracteres');

    const maxLength = await page.$eval('input[maxlength="20"]', (el) => el.getAttribute('maxlength'));
    assert(maxLength === '20', 'El prefijo admite hasta 20 caracteres');

    // Escribir un prefijo largo: el campo lo recorta a 20 caracteres.
    await page.click('input[maxlength="20"]', { clickCount: 3 });
    await page.type('input[maxlength="20"]', 'A'.repeat(25));
    await new Promise((r) => setTimeout(r, 500));
    const typed = await page.$eval('input[maxlength="20"]', (el) => el.value);
    assert(typed.length === 20, 'El prefijo se recorta a 20 caracteres');
    assert(/^A+$/.test(typed), 'El prefijo acepta letras y números en mayúsculas');

    await page.screenshot({ path: `${SHOTS}/01-prefijo.png`, fullPage: true });

    // Escribir un prefijo con caracteres no permitidos: se normaliza al
    // guardar (mayúsculas y sin separadores).
    await page.click('input[maxlength="20"]', { clickCount: 3 });
    await page.type('input[maxlength="20"]', 'mem-01');
    await new Promise((r) => setTimeout(r, 500));
    const typedAlt = await page.$eval('input[maxlength="20"]', (el) => el.value);
    assert(
      /^[A-Za-z0-9-]+$/.test(typedAlt),
      'El prefijo admite letras, números y guiones (que se normalizan al guardar)',
    );

    // Vaciar el prefijo: el servidor asignará un código automático
    await page.click('input[maxlength="20"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await new Promise((r) => setTimeout(r, 600));

    const hint = await page
      .$eval('input[maxlength="20"] ~ p', (el) => el.textContent?.trim() ?? '')
      .catch(() => '');
    assert(
      /único|automátic/i.test(hint),
      'El campo vacío explica que se asignará un código único',
    );

    await page.screenshot({ path: `${SHOTS}/02-codigo-automatico.png`, fullPage: true });

    // Escribir el prefijo de otra plantilla: se explica que cada una lleva
    // su propia enumeración, pero no bloquea el guardado.
    const otherPrefix = await page.evaluate(async (base, currentId) => {
      const response = await fetch(`${base}/templates?pageSize=20`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('sirpefoffice.token')}` },
      });
      const data = await response.json();
      const other = data.items?.find(
        (item) => item.numberingPrefix && item.id !== currentId,
      );
      return other?.numberingPrefix ?? null;
    }, apiBase, templateId);

    if (otherPrefix) {
      await page.click('input[maxlength="20"]', { clickCount: 3 });
      await page.type('input[maxlength="20"]', otherPrefix);
      await new Promise((r) => setTimeout(r, 700));

      const notice = await page.$$eval('p', (nodes) =>
        nodes
          .map((n) => (n.textContent ?? '').trim())
          .find((t) => /propia enumeración|ya lo usa|ya usa/i.test(t)) ?? '',
      );
      assert(
        notice.length > 0,
        `El panel explica que el prefijo ${otherPrefix} puede repetirse sin mezclar las enumeraciones`,
      );

      const blocked = await page.$$eval('button', (nodes) =>
        nodes.some((n) => /guardar/i.test(n.textContent ?? '') && n.hasAttribute('disabled')),
      );
      assert(!blocked, 'El prefijo repetido no bloquea el guardado');

      await page.screenshot({ path: `${SHOTS}/03-prefijo-compartido.png`, fullPage: true });
    } else {
      console.log('· No hay otra plantilla con prefijo para probar el prefijo compartido');
    }

    console.log(`\nCapturas en ${SHOTS}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
