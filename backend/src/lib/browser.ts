import { existsSync } from 'node:fs';

import puppeteer, { type Browser, type Page } from 'puppeteer-core';

import { env } from '../env.js';
import { unavailable } from './errors.js';

/**
 * Chrome es obligatorio para medir y exportar documentos, pero no puede ser un
 * punto único de fallo: si el proceso muere, la API debe relanzarlo en vez de
 * quedarse con una promesa muerta hasta reiniciar el servidor.
 */

/** Rutas habituales según la distribución. La configurada manda. */
const CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

/** Máximo de páginas simultáneas: evita reventar la memoria del servidor. */
const MAX_PAGES = 2;

let browserPromise: Promise<Browser> | null = null;
let activePages = 0;
const waiters: (() => void)[] = [];

function resetBrowser(): void {
  browserPromise = null;
}

/** Ruta real del binario: la configurada o la primera que exista. */
export function getChromePath(): string | null {
  const configured = env.CHROME_PATH?.trim();
  for (const candidate of [configured, ...CANDIDATES]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

async function acquireSlot(): Promise<void> {
  if (activePages < MAX_PAGES) {
    activePages += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activePages += 1;
}

function releaseSlot(): void {
  activePages = Math.max(0, activePages - 1);
  waiters.shift()?.();
}

/** Envuelve una promesa con un límite de tiempo y un mensaje comprensible. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(unavailable('CHROME_TIMEOUT', message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function launchBrowser(): Promise<Browser> {
  const path = getChromePath();
  if (!path) {
    const probed = [env.CHROME_PATH, ...CANDIDATES].filter(Boolean).join(', ');
    throw unavailable(
      'CHROME_MISSING',
      `No se encontró Chrome/Chromium. Rutas probadas: ${probed}. Avisa al soporte para que instale el navegador o ajuste CHROME_PATH.`,
    );
  }

  const browser = await puppeteer.launch({
    executablePath: path,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
      '--mute-audio',
      '--hide-scrollbars',
      '--font-render-hinting=none',
    ],
  });

  // Si Chrome se cierra o se cuelga, la próxima llamada lo relanza.
  browser.on('disconnected', resetBrowser);
  return browser;
}

/** Instancia viva de Chrome; la relanza si estaba muerta. */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      resetBrowser();
      throw error;
    });
  }

  const browser = await browserPromise;
  if (!browser.connected) {
    resetBrowser();
    await browser.close().catch(() => undefined);
    return getBrowser();
  }

  try {
    await withTimeout(browser.version(), 5_000, 'Chrome no responde. Se reiniciará.');
    return browser;
  } catch (error) {
    resetBrowser();
    await browser.close().catch(() => undefined);
    throw error;
  }
}

/** ¿El error tiene pinta de que Chrome murió y merece un reintento? */
function isBrowserFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /disconnect|target closed|session closed|protocol error|browser closed|crash|chrome no responde/i.test(
    message,
  );
}

/**
 * Ejecuta una tarea con una página de Chrome.
 *
 * - Limita la concurrencia a `MAX_PAGES`.
 * - Cierra la página siempre.
 * - Si Chrome murió a mitad, lo relanza y reintenta una vez.
 */
export async function withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
  await acquireSlot();
  let lastError: unknown;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        return await task(page);
      } catch (error) {
        lastError = error;
        if (attempt === 1 || !isBrowserFailure(error)) throw error;
        resetBrowser();
        await browser.close().catch(() => undefined);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    releaseSlot();
  }

  throw lastError instanceof Error
    ? lastError
    : unavailable('CHROME_FAILED', 'Chrome no pudo completar la operación');
}

/** Estado de Chrome para el diagnóstico del sistema. */
export async function getChromeStatus(): Promise<{
  path: string | null;
  exists: boolean;
  version: string | null;
  ok: boolean;
  error?: string;
}> {
  const path = getChromePath();
  if (!path) {
    return {
      path: null,
      exists: false,
      version: null,
      ok: false,
      error: 'No se encontró el binario de Chrome/Chromium',
    };
  }

  try {
    const browser = await getBrowser();
    const version = await withTimeout(browser.version(), 5_000, 'Chrome no responde');
    return { path, exists: true, version, ok: true };
  } catch (error) {
    return {
      path,
      exists: existsSync(path),
      version: null,
      ok: false,
      error: error instanceof Error ? error.message : 'Chrome no pudo iniciarse',
    };
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  resetBrowser();
  await browser?.close().catch(() => {});
}
