#!/usr/bin/env node
/**
 * Copia la fuente única de `shared/src` dentro de cada aplicación.
 *
 * Cada app conserva su propio node_modules y resuelve el alias
 * `@sirpefoffice/shared` contra su copia local, de modo que TipTap se instala
 * una sola vez por aplicación.
 *
 * Usa un bloqueo para que `npm install` simultáneo en frontend y backend no
 * intente crear la misma carpeta a la vez.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, open, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'shared/src');
const lockPath = resolve(root, '.sync-shared.lock');
const targets = [
  resolve(root, 'frontend/src/shared'),
  resolve(root, 'backend/src/shared'),
  // En el paquete de producción solo existe backend; se omite frontend.
].filter((target) => existsSync(resolve(target, '../..')));

async function acquireLock() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      return await open(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await sleep(100);
    }
  }
  throw new Error('No se pudo obtener el bloqueo de scripts/sync-shared.mjs.');
}

const lock = await acquireLock();
try {
  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
  console.log(`shared/src copiado a ${targets.length} aplicaciones.`);
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}
