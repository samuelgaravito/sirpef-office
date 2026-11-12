/**
 * Comprueba la campana flotante de avisos y los avisos del sistema.
 *
 *   node scripts/notification-bell-smoke.mjs [http://localhost:5173]
 *
 * Necesita la web de desarrollo levantada y la base de datos de desarrollo.
 * Entra con el administrador, publica un evento en el canal (como haría la
 * API al recibir un envío) y verifica que:
 *  - la campana aparece, muestra el asunto y ofrece silenciar,
 *  - agrupa varios avisos en una sola campana con el contador,
 *  - desaparece sola pasados unos segundos,
 *  - Ajustes tiene la sección de avisos y el interruptor cambia el estado.
 */
import puppeteer from 'puppeteer-core';
import postgres from 'postgres';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://sirpefoffice:sirpefoffice@127.0.0.1:5433/sirpefoffice';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function main() {
  const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error(`✖ La web no responde en ${BASE}`);

  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  const [admin] = await sql`select id from users where email = 'admin@sirpefoffice.local'`;
  if (!admin) throw new Error('✖ No existe el administrador del seed');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 900 },
  });

  const context = browser.defaultBrowserContext();
  await context.overridePermissions(BASE, ['notifications']);

  const page = await context.newPage();
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
    assert(true, 'Sesión iniciada');

    // El canal tarda un instante en abrirse tras el login.
    await wait(1500);

    const payload = {
      messageId: '00000000-0000-4000-8000-0000000000aa',
      documentId: '00000000-0000-4000-8000-0000000000bb',
      documentTitle: 'Memo de prueba',
      subject: 'Prueba de la campana flotante',
      actorName: 'Luis Gómez',
      status: 'pending_approval',
    };

    await sql.notify(
      'sirpefoffice_realtime',
      JSON.stringify({
        type: 'inbox.message.pending',
        userIds: [admin.id],
        payload,
        ts: new Date().toISOString(),
      }),
    );

    await page.waitForFunction(
      () => document.body.innerText.includes('Envío pendiente de aprobación'),
      { timeout: 8000 },
    );
    assert(true, 'La campana aparece al llegar el aviso');
    assert(
      await page.evaluate(() => document.body.innerText.includes('Prueba de la campana flotante')),
      'Muestra el asunto del envío',
    );
    assert(
      await page.evaluate(() => document.body.innerText.includes('Silenciar avisos')),
      'Ofrece silenciar los avisos del sistema',
    );

    // Agrupa: un segundo aviso mantiene la campana y suma el contador.
    await sql.notify(
      'sirpefoffice_realtime',
      JSON.stringify({
        type: 'inbox.message.created',
        userIds: [admin.id],
        payload: { ...payload, actorName: 'María Ruiz', subject: 'Segundo aviso' },
        ts: new Date().toISOString(),
      }),
    );
    await wait(600);
    assert(
      await page.evaluate(() =>
        [...document.querySelectorAll('span')].some((span) =>
          /^2$/.test(span.textContent?.trim() ?? ''),
        ),
      ),
      'Agrupa los avisos con contador',
    );

    await wait(7500);
    assert(
      await page.evaluate(
        () => !document.body.innerText.includes('Envío pendiente de aprobación'),
      ),
      'La campana desaparece sola',
    );

    // Ajustes: control permanente del permiso y del silencio.
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Ajustes'), {
      timeout: 15000,
    });
    assert(
      await page.evaluate(() => document.body.innerText.includes('Avisos')),
      'Ajustes tiene la sección de avisos',
    );
    assert(
      await page.evaluate(() => document.body.innerText.includes('Activados')),
      'Ajustes refleja que los avisos están activados',
    );

    const muted = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((element) =>
        element.textContent?.includes('Silenciar avisos'),
      );
      button?.click();
      return Boolean(button);
    });
    await wait(400);
    assert(muted, 'El botón de silenciar está disponible');
    assert(
      await page.evaluate(() => document.body.innerText.includes('Silenciados')),
      'Silenciar cambia el estado',
    );

    assert(pageErrors.length === 0, 'Sin errores de consola en la página');

    console.log('\n✔ Campana de avisos: todo correcto');
  } finally {
    await browser.close();
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
