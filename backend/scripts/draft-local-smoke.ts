/**
 * Regresión del borrador local del documento nuevo (plantillas).
 *
 *   npm run smoke:draft
 *
 * Reproduce el fallo reportado: al abrir una plantilla, salir y volver a
 * entrar, el documento aparecía en blanco porque el borrador guardado en
 * `localStorage` se había escrito con el cuerpo vacío.
 *
 * Comprueba:
 * - al abrir una plantilla y salir sin editar, no queda un borrador corrupto,
 * - al escribir y salir, el borrador conserva el texto,
 * - al volver a entrar, el cuerpo se recupera,
 * - un borrador heredado en blanco se repara con el cuerpo de la plantilla.
 *
 * Necesita la API y la web de desarrollo en marcha.
 */
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:3101/api';
const WEB = process.env.SMOKE_WEB ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@sirpefoffice.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'sirpefoffice';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Selector del editor del cuerpo.
 *
 * Hay varios `.tiptap` en la página: el de la banda de cabecera/pie y el del
 * cuerpo. Solo el del cuerpo es editable.
 */
const BODY_EDITOR = '.tiptap[contenteditable="true"]';

/** Texto visible dentro del cuerpo del editor. */
async function editorText(page: Page): Promise<string> {
  return page.$eval(BODY_EDITOR, (el) => el.textContent?.trim() ?? '');
}

async function login(page: Page): Promise<void> {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 20_000 });
  // En desarrollo el formulario viene autocompleto: se limpia antes de
  // escribir para no concatenar valores.
  await page.$eval('input[type="email"], input[name="email"]', (el) => {
    (el as HTMLInputElement).value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('input[type="password"], input[name="password"]', (el) => {
    (el as HTMLInputElement).value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('input[type="email"], input[name="email"]', EMAIL);
  await page.type('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/login'),
    { timeout: 20_000 },
  );
  await new Promise((r) => setTimeout(r, 800));
}

async function main(): Promise<void> {
  const browser: Browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // El editor avisa antes de cerrar si hay cambios sin guardar: se acepta
    // el aviso para poder navegar.
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // --- Plantilla de prueba con contenido -------------------------------
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    assert(loginRes.ok, `No se pudo iniciar sesión: ${loginRes.status}`);
    const token = (await loginRes.json() as { accessToken: string }).accessToken;

    const templatesRes = await fetch(`${API}/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(templatesRes.ok, `No se pudieron listar las plantillas: ${templatesRes.status}`);
    const templates = (await templatesRes.json() as { items: { id: string; name: string }[] }).items;
    assert(templates.length > 0, 'No hay plantillas para probar');

    const template = templates[0]!;
    const templateRes = await fetch(`${API}/templates/${template.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(templateRes.ok, `No se pudo leer la plantilla: ${templateRes.status}`);
    const templateBody = (await templateRes.json() as {
      template: { body: { content?: { type?: string; content?: unknown[] }[] } };
    }).template.body;
    const templateHasText = JSON.stringify(templateBody).includes('"text"');

    await login(page);

    const draftKey = `sirpef:doc-draft:${template.id}`;

    // --- Caso 1: abrir y salir sin editar -------------------------------
    await page.goto(`${WEB}/documents/new?template=${template.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector(BODY_EDITOR, { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 1200));

    const firstText = await editorText(page);
    if (templateHasText) {
      assert(firstText.length > 0, 'La plantilla debería mostrar su contenido al abrirse');
    }
    console.log(`ok  : la plantilla «${template.name}» se abre con contenido (${firstText.length} chars)`);

    // Salir a la lista de documentos.
    await page.goto(`${WEB}/documents`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 800));

    const storedAfterLeave = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, draftKey);

    if (storedAfterLeave) {
      // El borrador se guardó al abrir la plantilla: su cuerpo debe contener
      // el texto de la plantilla, no un documento vacío.
      const storedText = await page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return '';
        const draft = JSON.parse(raw);
        const parts = [];
        const stack = [draft.content];
        while (stack.length > 0) {
          const node = stack.pop();
          if (!node || typeof node !== 'object') continue;
          if (typeof node.text === 'string') parts.push(node.text);
          for (const child of node.content ?? []) stack.push(child);
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim();
      }, draftKey);

      if (templateHasText) {
        assert(
          storedText.length > 0,
          `El borrador se guardó con el cuerpo vacío: "${storedText.slice(0, 200)}"`,
        );
      }
      console.log(`ok  : el borrador guardado conserva el cuerpo (${storedText.length} chars)`);
    } else {
      console.log('ok  : no se guardó ningún borrador al salir sin editar');
    }

    // --- Caso 2: escribir, salir y volver --------------------------------
    await page.goto(`${WEB}/documents/new?template=${template.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector(BODY_EDITOR, { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 1200));

    await page.click(BODY_EDITOR);
    await page.keyboard.type('TEXTO DE PRUEBA');
    await new Promise((r) => setTimeout(r, 900));

    const withTyping = await editorText(page);
    assert(withTyping.includes('TEXTO DE PRUEBA'), 'El texto escrito no aparece en el editor');

    await page.goto(`${WEB}/documents`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 800));

    const stored = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, draftKey);

    assert(stored, 'No se guardó el borrador tras escribir');
    const storedText = JSON.stringify(stored.content);
    assert(
      storedText.includes('TEXTO DE PRUEBA'),
      `El borrador no conservó el texto escrito: ${storedText.slice(0, 300)}`,
    );
    console.log('ok  : el borrador conserva el texto escrito');

    // Volver a entrar: el cuerpo debe conservarse.
    await page.goto(`${WEB}/documents/new?template=${template.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector(BODY_EDITOR, { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 1400));

    const recovered = await editorText(page);
    assert(
      recovered.includes('TEXTO DE PRUEBA'),
      `Al volver a entrar no se recuperó el texto: "${recovered.slice(0, 120)}"`,
    );
    console.log('ok  : al volver a entrar se recupera el texto del borrador');

    // --- Caso 3: borrador heredado en blanco se repara --------------------
    await page.evaluate(
      (key) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            title: 'Borrador heredado',
            description: '',
            docType: 'blank',
            data: {},
            content: { type: 'doc', content: [] },
            header: null,
            footer: null,
            savedAt: new Date().toISOString(),
          }),
        );
      },
      draftKey,
    );

    await page.goto(`${WEB}/documents/new?template=${template.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector(BODY_EDITOR, { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 1400));

    const repaired = await editorText(page);
    if (templateHasText) {
      assert(
        repaired.length > 0,
        'El borrador heredado en blanco tapó el cuerpo de la plantilla',
      );
      console.log('ok  : el borrador heredado en blanco se repara con la plantilla');
    } else {
      console.log('ok  : la plantilla no tiene texto; reparación no comprobable');
    }

    // Limpieza del borrador de la prueba.
    await page.evaluate((key) => window.localStorage.removeItem(key), draftKey);

    console.log('\nRESULTADO: todas las comprobaciones pasaron');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nFALLO:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
