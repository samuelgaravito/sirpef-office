/**
 * Comprueba que el diálogo de envío se abre con **un solo clic** en un
 * documento nuevo.
 *
 *   node scripts/send-dialog-smoke.mjs [http://localhost:5173]
 *
 * Al crear un documento, la URL cambia de `/documents/new` a `/documents/:id`
 * y la vista se remonta. Si la intención de abrir el diálogo no sobrevive a
 * ese remontaje, el primer clic solo crea el documento y hace falta un
 * segundo clic para ver el diálogo.
 *
 * Necesita la web de desarrollo levantada y la base de datos de desarrollo.
 * Entra con el administrador y borra el documento que crea.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function main() {
  const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error(`✖ La web no responde en ${BASE}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });

    await page.evaluate(
      (email, password) => {
        const set = (selector, value) => {
          const input = document.querySelector(selector);
          if (!input) return;
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          )?.set;
          setter?.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('input[type="email"]', email);
        set('input[type="password"]', password);
      },
      process.env.ADMIN_EMAIL ?? 'admin@sirpefoffice.local',
      process.env.ADMIN_PASSWORD ?? 'sirpefoffice',
    );

    await page.click('button[type="submit"]');
    await page.waitForFunction(() => !location.pathname.includes('/login'), {
      timeout: 20000,
    });

    await page.goto(`${BASE}/documents/new`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.ProseMirror');
    await page.click('.ProseMirror');
    await page.keyboard.type('Prueba de envío en un clic');

    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent.trim() === 'Enviar',
      );
      if (!button) return false;
      button.click();
      return true;
    });
    assert(clicked, 'El editor ofrece el botón «Enviar»');

    await wait(1500);
    assert(
      await page.evaluate(() =>
        [...document.querySelectorAll('h2')].some(
          (heading) => heading.textContent.trim() === 'Enviar documento',
        ),
      ),
      'El diálogo se abre con un solo clic',
    );

    assert(
      await page.evaluate(() => Boolean(document.querySelector('#inbox-subject'))),
      'El asunto viene precargado',
    );

    assert(pageErrors.length === 0, 'Sin errores de consola en la página');

    // Limpieza: el documento se creó al pulsar «Enviar».
    const id = page.url().split('/documents/')[1]?.split('?')[0];
    if (id && id !== 'new') {
      const token = await page.evaluate(() => localStorage.getItem('sirpefoffice.token'));
      const response = await fetch(`${BASE.replace(/\/$/, '')}/api/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert(response.ok, 'El documento de prueba se elimina');
    }

    console.log('\n✔ Diálogo de envío: todo correcto');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
