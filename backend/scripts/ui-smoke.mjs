/**
 * Prueba de humo de la interfaz con Chrome headless.
 *
 *   node scripts/ui-smoke.mjs [http://localhost:5173]
 *
 * Recorre login, panel, documentos, plantillas, diseños, editor y ajustes,
 * guarda capturas en /tmp/sirpefoffice-shots y falla si hay errores de consola.
 */
import { mkdir, rm } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SHOTS = '/tmp/sirpefoffice-shots';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log(`  · captura ${name}.png`);
}

/** Abre el menú «⋯» del editor, donde viven las acciones secundarias. */
async function openActions(page) {
  await page.click('button[aria-label="Más acciones"]');
  await wait(300);
}

/** Pulsa una acción dentro del menú «⋯» ya abierto. */
async function clickMenu(page, text) {
  const clicked = await page.evaluate((label) => {
    const panel = Array.from(document.querySelectorAll('div.z-50')).find((element) =>
      element.textContent?.includes('Descargar'),
    );
    const button = Array.from(panel?.querySelectorAll('button') ?? []).find((item) =>
      (item.textContent ?? '').trim().includes(label),
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`No se encontró «${text}» en el menú de acciones`);
  await wait(300);
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

async function main() {
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  page.on('dialog', async (dialog) => {
    console.log(`  · diálogo del navegador: ${dialog.message() || '(sin mensaje)'}`);
    await dialog.accept();
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // El sondeo de sesión en /login devuelve 401 cuando no hay cookie: es esperado.
    if (text.includes('401')) return;
    errors.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));

  try {
    console.log('→ Login');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await shot(page, '01-login');

    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 });
    await page.waitForSelector('text/Tus últimos documentos', { timeout: 15000 });
    await page.waitForSelector('text/Esperando al jefe', { timeout: 15000 });
    await wait(600);
    const homeDay = await page.evaluate(() => ({
      create: Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('Crear documento'),
      ),
      drafts: Boolean(document.body.textContent?.includes('Tus últimos documentos')),
    }));
    console.log(
      homeDay.create && homeDay.drafts
        ? '  · inicio con «Tu día», borradores y botón Crear documento'
        : '  · falta el panel «Tu día» en Inicio',
    );
    if (!homeDay.create || !homeDay.drafts) errors.push('Inicio no muestra el panel «Tu día»');
    await shot(page, '02-inicio');

    console.log('→ Documentos');
    await page.click('a[href="/documents"]');
    await page.waitForSelector('input[placeholder="Buscar por título o descripción…"]');
    await page.waitForSelector('article iframe', { timeout: 15000 });
    await wait(1400);
    const documentPreviews = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('article iframe'));
      return {
        count: frames.length,
        real: frames.some((frame) => frame.getAttribute('srcdoc')?.includes('doc-page')),
      };
    });
    console.log(
      documentPreviews.real
        ? `  · ${documentPreviews.count} documentos con vista previa real`
        : '  · los documentos NO muestran la vista previa real',
    );
    if (!documentPreviews.real) errors.push('Los documentos no muestran la vista previa real');
    await shot(page, '03-documentos');

    console.log('→ Plantillas');
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[placeholder="Buscar plantilla…"], input[placeholder="Buscar un modelo…"]');
    await wait(1200);
    const templatePreviews = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('article iframe'));
      return {
        count: frames.length,
        real: frames.some((frame) => frame.getAttribute('srcdoc')?.includes('doc-page')),
      };
    });
    console.log(
      templatePreviews.real
        ? `  · ${templatePreviews.count} miniaturas reales en la lista`
        : '  · las miniaturas reales NO se cargaron',
    );
    if (!templatePreviews.real) errors.push('Las plantillas no muestran la vista previa real');
    await shot(page, '04-plantillas');

    console.log('→ Nueva plantilla: diseño en uso');
    await clickText(page, 'button', 'Administrar');
    await wait(400);
    await clickText(page, 'button', 'Nueva plantilla');
    await page.waitForSelector('text/Vista previa del diseño', { timeout: 15000 });
    await wait(900);
    const templateDesignModal = await page.evaluate(() => ({
      hasDesign:
        (document.body.textContent?.includes('Diseño en uso') ?? false) ||
        (document.body.textContent?.includes('Sin diseño') ?? false),
      hasConfirm: Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('Crear plantilla'),
      ),
    }));
    console.log(
      templateDesignModal.hasDesign && templateDesignModal.hasConfirm
        ? '  · la modal muestra el diseño con el que nacerá la plantilla'
        : '  · faltan opciones en la modal de nueva plantilla',
    );
    if (!templateDesignModal.hasDesign || !templateDesignModal.hasConfirm) {
      errors.push('La modal de nueva plantilla no muestra el diseño aplicado');
    }
    await shot(page, '04b-nueva-plantilla');
    await clickText(page, 'button', 'Crear plantilla');
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(900);
    console.log('  · la nueva plantilla abre en el editor');
    await shot(page, '04c-nueva-plantilla-editor');

    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[placeholder="Buscar plantilla…"], input[placeholder="Buscar un modelo…"]');
    await wait(800);

    console.log('→ Editor de plantilla');
    await clickText(page, 'button', 'Administrar');
    await wait(400);
    await page.click('article button');
    await page.waitForSelector('.doc-paged-flow .tiptap');
    await wait(900);
    await shot(page, '05-editor-plantilla');

    console.log('→ Vista previa de la plantilla');
    await page.click('button[title*="Vista previa de la plantilla"]');
    await page.waitForSelector('iframe[title="Vista previa de la plantilla"]', { timeout: 20000 });
    await wait(900);
    const templatePreviewOk = await page.evaluate(() => {
      const frame = document.querySelector('iframe[title="Vista previa de la plantilla"]');
      return frame?.getAttribute('srcdoc')?.includes('doc-page') ?? false;
    });
    console.log(templatePreviewOk ? '  · vista previa de plantilla generada' : '  · vista previa vacía');
    if (!templatePreviewOk) errors.push('La vista previa de la plantilla no se generó');
    await shot(page, '05b-vista-previa-plantilla');
    await page.click('button[title*="Vista previa de la plantilla"]');
    await page.waitForSelector('.doc-paged-flow .tiptap');

    console.log('→ Diseños');
    await page.goto(`${BASE}/designs`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('text/Nuevo diseño');
    await wait(500);
    await shot(page, '06-disenos');

    console.log('→ Editor de diseño');
    await page.click('article button');
    await page.waitForSelector('text/Hoja de trabajo');
    await wait(900);
    const designBands = await page.evaluate(() => ({
      header: document.body.textContent?.includes('Imágenes de cabecera') ?? false,
      footer: document.body.textContent?.includes('Imágenes de pie de página') ?? false,
      sheet: Boolean(document.querySelector('[data-design-band="header"]')),
      footerSheet: Boolean(document.querySelector('[data-design-band="footer"]')),
      zoom: document.body.textContent?.includes('Ajustar ancho') ?? false,
    }));
    console.log(
      designBands.header && designBands.footer && designBands.sheet && designBands.footerSheet && designBands.zoom
        ? '  · hoja ampliable con bandas de cabecera y pie editables'
        : '  · faltan controles en el editor de diseño',
    );
    if (!designBands.header || !designBands.footer || !designBands.sheet || !designBands.footerSheet || !designBands.zoom) {
      errors.push('El editor de diseño no muestra la hoja ampliable con las bandas editables');
    }

    const bandWidthControl = await page.evaluate(() => {
      const range = document.querySelector(
        'label[title*="Ancho de la banda"] input[type="range"]',
      );
      if (!range) return null;
      const original = range.value;
      range.value = range.max;
      range.dispatchEvent(new Event('input', { bubbles: true }));
      return { max: Number(range.max), original };
    });
    await wait(250);
    const bandWidthState = await page.evaluate(() => {
      const band = document.querySelector('[data-design-band="header"]');
      if (!band) return null;
      const style = getComputedStyle(band);
      return {
        marginLeft: Number.parseFloat(style.marginLeft),
        width: Number.parseFloat(style.width),
        parentWidth: Number.parseFloat(getComputedStyle(band.parentElement).width),
      };
    });
    const bandWidthFullPage = Boolean(
      bandWidthControl &&
        bandWidthControl.max === 100 &&
        bandWidthState &&
        bandWidthState.width > 0 &&
        bandWidthState.parentWidth > 0 &&
        bandWidthState.width >= bandWidthState.parentWidth - 1 &&
        Math.abs(bandWidthState.marginLeft) < 1,
    );
    console.log(
      bandWidthFullPage
        ? `  · el ancho de banda llega al 100 % de la página (máx. ${bandWidthControl.max} %)`
        : '  · el ancho de banda no ocupa toda la página',
    );
    if (!bandWidthFullPage) {
      errors.push('El ancho de cabecera/pie no permite ocupar toda la página');
    }
    await page.evaluate((original) => {
      const range = document.querySelector(
        'label[title*="Ancho de la banda"] input[type="range"]',
      );
      if (!range) return;
      range.value = original;
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }, bandWidthControl?.original ?? '100');
    await wait(250);
    await shot(page, '07-editor-diseno');

    console.log('→ Ajustes');
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('text/Asistente de IA');
    await wait(500);
    await shot(page, '08-ajustes');

    console.log('→ Crear documento desde el inicio');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('text/Tus últimos documentos');
    await wait(600);
    await clickText(page, 'button', 'Crear documento');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) =>
        node.textContent?.includes('Elige el modelo'),
      ),
      { timeout: 15000 },
    );
    await page.waitForSelector('[role="dialog"] button.card', { timeout: 15000 });
    await wait(500);
    const picked = await page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) =>
        node.textContent?.includes('Elige el modelo'),
      );
      const target = Array.from(dialog?.querySelectorAll('button.card') ?? []).find((button) =>
        button.textContent?.includes('Certificado'),
      );
      if (!target) return false;
      target.click();
      return true;
    });
    if (!picked) throw new Error('El selector de modelo no muestra «Certificado»');

    console.log('→ Documento creado directamente con el modelo');
    await page.waitForFunction(() => location.pathname.startsWith('/documents/'), {
      timeout: 20000,
    });
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(1200);
    const modalStillOpen = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"]')).some((node) =>
        node.textContent?.includes('Elige el modelo'),
      ),
    );
    console.log(
      modalStillOpen
        ? '  · el selector de modelo sigue abierto'
        : '  · el documento se abrió directamente en el editor',
    );
    if (modalStillOpen) errors.push('El selector de modelo no se cerró al elegir');
    await shot(page, '09-editor-documento');

    console.log('→ Escribir y autoguardar');
    await page.click('.doc-paged-flow .tiptap');
    await page.keyboard.down('Control');
    await page.keyboard.press('End');
    await page.keyboard.up('Control');
    await page.keyboard.type(' Prueba de edición automática.');
    await wait(3000);
    await shot(page, '10-editor-guardado');

    const saveLabel = await page.evaluate(() => {
      const node = Array.from(document.querySelectorAll('p')).find((p) =>
        p.textContent?.includes('Guardado'),
      );
      return node?.textContent?.trim() ?? '';
    });
    console.log(`  · estado de guardado: ${saveLabel || '(no visible)'}`);

    console.log('→ Guardar en el servidor');
    await page.click('button[aria-label="Guardar"]');
    await page.waitForFunction(
      () => /^\/documents\/[0-9a-f-]{36}$/.test(location.pathname),
      { timeout: 20000 },
    );
    await page.waitForSelector('.doc-paged-flow .tiptap');
    await wait(900);
    console.log('  · el borrador se materializa y el editor sigue disponible');

    console.log('→ Historial de versiones');
    await openActions(page);
    await clickMenu(page, 'Historial de versiones');
    await page.waitForSelector('text/Historial de versiones');
    await wait(1400);
    await shot(page, '11-historial');
    await page.click('button[aria-label="Cerrar historial"]');
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Cerrar historial"]'));
    await wait(600);

    console.log('→ Rellenar datos del formulario');
    await page.type('input#var-nombre', 'Ana Torres Quispe');
    await page.type('input#var-evento', 'Curso de Seguridad de la Información');
    await page.type('input#var-horas', '40');
    await wait(2400);
    await shot(page, '12-datos-rellenos');

    console.log('→ Vista previa con datos');
    await page.click('button[aria-label="Vista previa"]');
    await page.waitForSelector('iframe[title="Vista previa del documento"]', { timeout: 20000 });
    await wait(1500);
    await shot(page, '13-vista-previa');

    const previewText = await page.evaluate(() => {
      const frame = document.querySelector('iframe[title="Vista previa del documento"]');
      return frame?.getAttribute('srcdoc')?.includes('Ana Torres Quispe') ?? false;
    });
    console.log(previewText ? '  · los datos aparecen en la vista previa' : '  · ¡los datos NO aparecen!');

    console.log('→ Volver a editar y buscar');
    await page.click('button[aria-label="Vista previa"]');
    await page.waitForSelector('.doc-paged-flow .tiptap');
    await page.keyboard.down('Control');
    await page.keyboard.press('f');
    await page.keyboard.up('Control');
    await page.waitForSelector('input[placeholder="Buscar…"]', { timeout: 5000 });
    await page.type('input[placeholder="Buscar…"]', 'certifica');
    await wait(500);
    await shot(page, '14-buscar');
    await page.keyboard.press('Escape');

    console.log('→ Panel de datos');
    const dataPanel = await page.evaluate(() =>
      Array.from(document.querySelectorAll('aside h2')).some((node) =>
        node.textContent?.includes('Datos del documento'),
      ),
    );
    console.log(dataPanel ? '  · panel de variables visible' : '  · panel de variables NO visible');

    console.log('→ Nuevo documento en blanco');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('text/Tus últimos documentos');
    await wait(600);
    await clickText(page, 'button', 'Crear documento');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) =>
        node.textContent?.includes('Elige el modelo'),
      ),
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[role="dialog"] button')).some((button) =>
        button.textContent?.includes('Hoja en blanco'),
      ),
      { timeout: 15000 },
    );
    await clickText(page, 'button', 'Hoja en blanco');
    await page.waitForFunction(() => location.pathname.startsWith('/documents/'), {
      timeout: 20000,
    });
    await page.waitForSelector('.doc-paged-flow .tiptap', { timeout: 20000 });
    await wait(900);
    console.log('  · la hoja en blanco se abre en el editor y avisa de que no tiene numeración');
    await shot(page, '15-documento-blanco');

    console.log('→ Tablas: insertar y combinar celdas');
    await page.click('.doc-paged-flow .tiptap');
    await page.click('button[title="Insertar tabla"]');
    await page.waitForSelector('button[title="3 filas × 3 columnas"]', { timeout: 5000 });
    await page.click('button[title="3 filas × 3 columnas"]');
    await page.waitForSelector('.tiptap table', { timeout: 5000 });
    await wait(300);
    const tableToolbar = await page.$('[data-table-toolbar]');
    console.log(tableToolbar ? '  · barra contextual de tabla visible' : '  · falta la barra contextual de tabla');
    if (!tableToolbar) errors.push('No aparece la barra contextual al entrar en una tabla');

    await page.click('.tiptap table tr:first-child th:nth-child(1)');
    await page.keyboard.down('Shift');
    await page.click('.tiptap table tr:first-child th:nth-child(2)');
    await page.keyboard.up('Shift');
    await wait(200);
    const merged = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('[data-table-toolbar] button')).find(
        (node) => node.textContent?.trim() === 'Unir',
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    });
    await wait(400);
    const hasMergedCell = await page.evaluate(
      () => Boolean(document.querySelector('.tiptap table th[colspan="2"], .tiptap table td[colspan="2"]')),
    );
    console.log(
      merged && hasMergedCell
        ? '  · celdas combinadas con colspan correcto'
        : '  · no se pudieron combinar las celdas',
    );
    if (!merged || !hasMergedCell) errors.push('La acción Unir celdas no generó un colspan');
    await page.click('[data-table-toolbar] button[title="Propiedades de la tabla"]');
    await page.waitForSelector('text/Distribuir columnas', { timeout: 5000 });
    await shot(page, '16-tabla-combinada');
    await page.keyboard.press('Escape');
  } catch (error) {
    console.error('\n✗ Falló la prueba:', error.message);
    await shot(page, '99-error');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  if (errors.length) {
    console.error('\nErrores en la consola del navegador:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ Sin errores de consola');
  }
}

await main();
