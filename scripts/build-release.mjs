#!/usr/bin/env node
/**
 * Genera un paquete de producción de SirpefOffice.
 *
 * Uso:
 *   node scripts/build-release.mjs
 *
 * Requiere que exista deploy/env/frontend.production.env, o que las variables
 * VITE_SVA_URL y VITE_SVA_API_URL estén definidas en el entorno.
 *
 * El resultado se guarda en release/ y queda ignorado por Git.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = join(root, 'release');

function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function run(command, args, options = {}) {
  console.log(`\n→ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

const now = new Date();
const stamp = now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
const releaseName = `sirpefoffice-${stamp}`;
const releaseDir = join(releaseRoot, releaseName);

/* ── Entorno del frontend ────────────────────────────────────────────────── */
const frontendEnvPath = join(root, 'deploy/env/frontend.production.env');
const fileEnv = existsSync(frontendEnvPath)
  ? parseEnvFile(await readFile(frontendEnvPath, 'utf8'))
  : {};

const buildEnv = { ...process.env, ...fileEnv, NODE_ENV: 'production' };
buildEnv.VITE_API_URL ||= '/api';
buildEnv.VITE_SVA_URL ||= '';
buildEnv.VITE_SVA_API_URL ||= buildEnv.VITE_SVA_URL;

if (!buildEnv.VITE_SVA_URL) {
  console.error(
    '\n✖ Falta VITE_SVA_URL.\n' +
      '  Crea deploy/env/frontend.production.env a partir de\n' +
      '  deploy/env/frontend.production.env.example y vuelve a ejecutar.\n',
  );
  process.exit(1);
}

/* ── Generar código compartido y compilar el frontend ───────────────────── */
run(process.execPath, [join(root, 'scripts/sync-shared.mjs')], { cwd: root });

run('npm', ['run', 'build'], {
  cwd: join(root, 'frontend'),
  env: buildEnv,
});

if (!existsSync(join(root, 'frontend/dist/index.html'))) {
  throw new Error('El build del frontend no generó frontend/dist/index.html');
}

/* ── Preparar el release ─────────────────────────────────────────────────── */
console.log(`\n→ Creando ${relative(root, releaseDir)}…`);
await rm(releaseDir, { recursive: true, force: true });
await mkdir(join(releaseDir, 'backend'), { recursive: true });
await mkdir(join(releaseDir, 'web'), { recursive: true });
await mkdir(join(releaseDir, 'deploy'), { recursive: true });

const backendSrc = join(root, 'backend');
const backendDest = join(releaseDir, 'backend');

await cp(backendSrc, backendDest, {
  recursive: true,
  filter: (source) => {
    const rel = relative(backendSrc, source);
    if (!rel) return true;
    const parts = rel.split(/[\\/]/);
    if (parts.includes('node_modules') || parts.includes('data')) return false;
    if (rel === '.env' || rel === '.env.local' || rel === '.env.example') return false;
    if (rel === '.sync-shared.lock' || rel.endsWith('.log')) return false;
    if (rel === 'docker-compose.yml') return false;
    // Los scripts operativos se copian aparte; los smoke tests no van.
    if (parts[0] === 'scripts') return false;
    return true;
  },
});

for (const script of ['reset-admin.ts', 'sva-sync.ts']) {
  await cp(join(backendSrc, 'scripts', script), join(backendDest, 'scripts', script));
}

// El release no incluye scripts/sync-shared.mjs: backend/src/shared ya viene
// generado. Se eliminan los scripts npm que dependían de él para que el
// package.json empaquetado sea coherente.
const productionScripts = [
  'start',
  'db:generate',
  'db:migrate',
  'db:seed',
  'admin:reset',
  'sva:sync',
];
const packagedPkgPath = join(backendDest, 'package.json');
const packagedPkg = JSON.parse(await readFile(packagedPkgPath, 'utf8'));
packagedPkg.scripts = Object.fromEntries(
  Object.entries(packagedPkg.scripts ?? {}).filter(([name]) =>
    productionScripts.includes(name),
  ),
);
await writeFile(packagedPkgPath, `${JSON.stringify(packagedPkg, null, 2)}\n`);

await cp(join(root, 'frontend/dist'), join(releaseDir, 'web'), { recursive: true });

await cp(
  join(root, 'deploy/nginx/sirpefoffice.conf'),
  join(releaseDir, 'deploy/nginx.conf'),
);
await cp(
  join(root, 'deploy/systemd/sirpefoffice-api.service'),
  join(releaseDir, 'deploy/sirpefoffice-api.service'),
);
await cp(
  join(root, 'deploy/env/backend.production.env.example'),
  join(releaseDir, 'deploy/backend.env.example'),
);
await cp(
  join(root, 'deploy/env/frontend.production.env.example'),
  join(releaseDir, 'deploy/frontend.env.example'),
);
await cp(
  join(root, 'deploy/install-release.sh'),
  join(releaseDir, 'deploy/install-release.sh'),
);
await chmod(join(releaseDir, 'deploy/install-release.sh'), 0o755);
await cp(join(root, 'README-PRODUCCION.md'), join(releaseDir, 'README-PRODUCCION.md'));
await cp(join(root, 'LICENSE'), join(releaseDir, 'LICENSE'));

/* ── Manifiesto de integridad ────────────────────────────────────────────── */
const files = (await listFiles(releaseDir)).sort();
const sums = [];
for (const file of files) {
  if (basename(file) === 'SHA256SUMS') continue;
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  sums.push(`${hash}  ${relative(releaseDir, file)}`);
}
await writeFile(join(releaseDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);

/* ── Empaquetar ──────────────────────────────────────────────────────────── */
const tarball = join(releaseRoot, `${releaseName}.tar.gz`);
run('tar', ['-czf', tarball, '-C', releaseRoot, releaseName]);

console.log('\n✔ Release generado:');
console.log(`  ${relative(root, releaseDir)}/`);
console.log(`  ${relative(root, tarball)}`);
console.log('\n  Siguiente paso:');
console.log(`  scp ${relative(root, tarball)} usuario@sirpefoffice.mppef.gob.ve:/tmp/`);
console.log('  # En el servidor:');
console.log(`  tar -xzf /tmp/${releaseName}.tar.gz -C /tmp`);
console.log(
  `  sudo /tmp/${releaseName}/deploy/install-release.sh /tmp/${releaseName}.tar.gz\n`,
);
