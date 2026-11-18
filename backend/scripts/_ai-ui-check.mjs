/**
 * Comprobación temporal del flujo «pídele un documento a la IA».
 *
 *   node scripts/_ai-ui-check.mjs [http://localhost:5173]
 */
import { mkdir } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SHOTS = '/tmp/sirpefoffice-shots';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log(`  · captura ${name}.png`);
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    defaultViewport: { width: 1440, height: 900 },
    protocolTimeout: 600000,
  });

  const page = await browser.newPage();
  const errors = [];

  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('401')) {
      errors.push(`console: ${text}`);
    }
    if (text.includes('ia/') || text.includes('ai/')) console.log(`  · consola: ${text.slice(0, 160)}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/ai/') && !url.includes('/api/templates/')) return;
    console.log(`  · HTTP ${response.status()} ${url.replace(BASE, '')}`);
  });

  try {
    console.log('→ Login');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 });

    console.log('→ Escribir el encargo');
    await page.waitForSelector('#home-ai-prompt', { timeout: 20000 });
    await page.type(
      '#home-ai-prompt',
      'Necesito un memorándum breve para el director de operaciones anunciando el cambio de horario de la oficina.',
    );
    await shot(page, 'ai-01-encargo');

    await page.click('button[aria-label="Redactar con IA"]');
    console.log('  · encargo enviado (eligiendo plantilla…)');

    // Se espera la navegación mirando el panel, no solo la ruta: la vista
    // cambia de panel a editor y la URL puede tardar un poco en reflejarse.
    const deadline = Date.now() + 600000;
    let opened = false;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => ({
        path: location.pathname,
        panel: document.body.textContent?.includes('Asistente de redacción') ?? false,
        alerta: document.querySelector('[role="alert"]')?.textContent?.trim() ?? '',
        hint: document.querySelector('#home-ai-prompt-hint')?.textContent?.trim() ?? '',
      }));
      if (state.alerta) {
        console.log(`  · aviso: ${state.alerta}`);
        errors.push(`La barra de la IA mostró un error: ${state.alerta}`);
        break;
      }
      if (state.panel) {
        console.log(`  · el editor se abrió en ${state.path}`);
        opened = true;
        break;
      }
      await wait(2000);
    }

    await shot(page, 'ai-02-editor');

    if (!opened) {
      const where = await page.evaluate(() => location.pathname);
      errors.push(`El editor no se abrió (se quedó en ${where})`);
      throw new Error('el editor no se abrió');
    }

    // La redacción con un modelo local puede tardar minutos.
    const finish = Date.now() + 600000;
    let ready = false;
    while (Date.now() < finish) {
      const state = await page.evaluate(() => {
        const editor = document.querySelector('.ProseMirror');
        const text = editor?.textContent?.trim() ?? '';
        const panel = document.body.textContent ?? '';
        return {
          length: text.length,
          sample: text.slice(0, 240),
          alerta: document.querySelector('[role="alert"]')?.textContent?.trim() ?? '',
          redactando: panel.includes('Redactando la propuesta'),
          sinCuerpo: !text.includes('{{cuerpo}}'),
          respondio: /He redactado|Se ha redactado|preparado una propuesta/i.test(panel),
        };
      });
      if (state.alerta) {
        console.log(`  · aviso en pantalla: ${state.alerta}`);
        errors.push(`El asistente mostró un error: ${state.alerta}`);
        break;
      }
      if (!state.redactando && state.sinCuerpo && state.respondio) {
        console.log(`  · el documento ya tiene ${state.length} caracteres`);
        console.log(`  · muestra: ${state.sample}`);
        ready = true;
        break;
      }
      await wait(3000);
    }

    await shot(page, 'ai-03-resultado');

    if (!ready && errors.length === 0) {
      errors.push('El asistente no redactó nada dentro del tiempo previsto');
    }

    if (errors.length) {
      console.log('\nFALLOS:');
      for (const error of errors) console.log(`  ✖ ${error}`);
      process.exitCode = 1;
    } else {
      console.log('\nRESULTADO: el flujo de la IA funciona de punta a punta');
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
