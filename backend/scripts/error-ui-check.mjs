/**
 * Comprueba en un navegador real que los avisos de error se muestran con el
 * tono correcto (aviso ámbar para 4xx, error rojo para 5xx) y con el
 * mensaje del servidor.
 *
 *   node scripts/error-ui-check.mjs [http://localhost:5199]
 *
 * Entra con el administrador del seed y fuerza errores en la lista de
 * documentos interceptando la respuesta de la API.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5199';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@sirpefoffice.local';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  const failures = [];

  // Intercepta solo la lista de documentos: el login debe funcionar de verdad.
  await page.setRequestInterception(true);
  let mode = 'ok';
  page.on('request', (request) => {
    const url = request.url();
    if (!url.includes('/api/documents')) return request.continue();
    if (mode === 'validation') {
      return request.respond({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'VALIDATION_ERROR',
          message: 'Datos inválidos: título (El título es obligatorio).',
          details: [{ path: 'título', message: 'El título es obligatorio.' }],
        }),
      });
    }
    if (mode === 'server') {
      return request.respond({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: 'Ocurrió un fallo al procesar la solicitud.',
          reference: 'abcd1234',
        }),
      });
    }
    if (mode === 'offline') {
      return request.abort('connectionrefused');
    }
    return request.continue();
  });

  // Sesión real: se rellenan los campos disparando el evento que Vue
  // escucha, para no depender de lo que el formulario traiga precargado.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.evaluate(
    (email, password) => {
      const set = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('input[type="email"]', email);
      set('input[type="password"]', password);
    },
    EMAIL,
    PASSWORD,
  );
  await wait(300);
  await page.click('button[type="submit"]');
  await wait(4000);

  const loggedIn = !page.url().includes('/login');
  if (!loggedIn) {
    console.log('✖ no se pudo iniciar sesión; revisa las credenciales del seed');
    await browser.close();
    process.exit(1);
  }

  async function readToast() {
    await page.goto(`${BASE}/documents`, { waitUntil: 'networkidle2' });
    await wait(2500);
    return page.evaluate(() => {
      const node = document.querySelector('.fixed.inset-x-0.bottom-0 p');
      if (!node) return null;
      const wrap = node.closest('div');
      return {
        message: node.textContent?.trim() ?? '',
        className: wrap?.querySelector('span')?.className ?? '',
      };
    });
  }

  // 1. Validación (4xx) → aviso ámbar con el mensaje del servidor.
  mode = 'validation';
  let toast = await readToast();
  if (!toast) {
    failures.push('No apareció ningún aviso');
  } else {
    console.log(`4xx → "${toast.message}"`);
    console.log(`     ${toast.className}`);
    if (!toast.message.includes('Datos inválidos')) {
      failures.push('el 4xx no muestra el mensaje del servidor');
    }
    if (!toast.className.includes('warning')) {
      failures.push('el 4xx no se muestra como aviso (warning)');
    }
  }

  // 2. Error del servidor (5xx) → error rojo con la referencia.
  mode = 'server';
  toast = await readToast();
  if (!toast) {
    failures.push('No apareció ningún aviso para el 5xx');
  } else {
    console.log(`5xx → "${toast.message}"`);
    console.log(`     ${toast.className}`);
    if (!toast.message.includes('abcd1234')) {
      failures.push('el 5xx no incluye la referencia de rastreo');
    }
    if (!toast.className.includes('danger')) {
      failures.push('el 5xx no se muestra como error (danger)');
    }
  }

  // 3. Servidor inalcanzable → mensaje en español, no «Failed to fetch».
  mode = 'offline';
  toast = await readToast();
  if (!toast) {
    failures.push('No apareció ningún aviso con el servidor caído');
  } else {
    console.log(`red → "${toast.message}"`);
    console.log(`     ${toast.className}`);
    if (toast.message.includes('Failed to fetch') || toast.message.includes('NetworkError')) {
      failures.push('el fallo de red muestra un mensaje técnico en inglés');
    }
    if (!toast.message.toLowerCase().includes('conectar')) {
      failures.push('el fallo de red no explica que no se pudo conectar');
    }
  }

  await browser.close();

  if (failures.length > 0) {
    console.log('\n✖ Fallos:');
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exit(1);
  }
  console.log('\n✔ Los avisos distinguen 4xx, 5xx y caída de red');
}

await main();
