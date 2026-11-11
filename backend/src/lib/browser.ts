import { existsSync } from 'node:fs';

import puppeteer, { type Browser } from 'puppeteer-core';

import { env } from '../env.js';
import { unavailable } from './errors.js';

let browserPromise: Promise<Browser> | null = null;

/** Reutiliza una única instancia de Chrome entre exportaciones y mediciones. */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    if (!existsSync(env.CHROME_PATH)) {
      throw unavailable(
        'CHROME_MISSING',
        `El servidor no tiene Chrome instalado en ${env.CHROME_PATH}, así que no puede medir ni exportar documentos. Avisa al soporte para que lo configure.`,
      );
    }
    browserPromise = puppeteer.launch({
      executablePath: env.CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
        '--disable-gpu',
      ],
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => {});
}
