import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { db } from '../../db/index.js';
import { env } from '../../env.js';
import { requireAdmin } from '../../lib/auth-guard.js';
import { getChromeStatus } from '../../lib/browser.js';

interface DiagnosticCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** Comprobaciones que puede lanzar un administrador desde Ajustes. */
export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/diagnostics', async (request) => {
    await requireAdmin(request);

    const checks: DiagnosticCheck[] = [];

    // Base de datos
    try {
      await db.execute(sql`select 1`);
      checks.push({
        key: 'database',
        label: 'Base de datos',
        ok: true,
        detail: 'Conexión correcta',
      });
    } catch (error) {
      checks.push({
        key: 'database',
        label: 'Base de datos',
        ok: false,
        detail: error instanceof Error ? error.message : 'No se pudo conectar',
      });
    }

    // Chrome / Chromium
    const chrome = await getChromeStatus();
    checks.push({
      key: 'chrome',
      label: 'Chrome para PDF y vista previa',
      ok: chrome.ok,
      detail: chrome.ok
        ? `${chrome.version ?? 'versión desconocida'} · ${chrome.path ?? ''}`
        : (chrome.error ?? 'No disponible'),
    });

    // Carpeta de exportación
    try {
      await mkdir(env.EXPORT_DIR, { recursive: true });
      await access(env.EXPORT_DIR, constants.W_OK);
      checks.push({
        key: 'exports',
        label: 'Carpeta de exportación',
        ok: true,
        detail: env.EXPORT_DIR,
      });
    } catch (error) {
      checks.push({
        key: 'exports',
        label: 'Carpeta de exportación',
        ok: false,
        detail: error instanceof Error ? error.message : 'No se puede escribir',
      });
    }

    const memory = process.memoryUsage();
    checks.push({
      key: 'server',
      label: 'Servidor',
      ok: true,
      detail: `Node ${process.version} · ${Math.round(memory.rss / 1024 / 1024)} MB · ${Math.round(process.uptime() / 60)} min`,
    });

    return {
      ok: checks.every((check) => check.ok),
      checks,
      generatedAt: new Date().toISOString(),
    };
  });
}
