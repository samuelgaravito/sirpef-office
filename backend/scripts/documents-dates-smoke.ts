/**
 * Regresión del filtro por fechas de Documentos.
 *
 *   npm run smoke:dates
 *
 * Necesita la API levantada y la misma base de datos. No crea documentos:
 * comprueba rangos sobre los documentos existentes.
 */
import { env } from '../src/env.js';

const API = process.env.SD_API ?? 'http://localhost:3101/api';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@sirpefoffice.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? env.SEED_ADMIN_PASSWORD ?? 'sirpefoffice';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dayStart(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function dayEnd(date: Date): string {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  ).toISOString();
}

async function main(): Promise<void> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(login.ok, `No se pudo iniciar sesión: ${login.status}`);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };

  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  const hoy = await fetch(
    `${API}/documents?pageSize=1&dateFrom=${dayStart(today)}&dateTo=${dayEnd(today)}`,
    { headers },
  );
  assert(hoy.ok, `El filtro de hoy falló: ${hoy.status}`);
  const hoyData = (await hoy.json()) as { total: number };
  assert(hoyData.total >= 0, 'El total de hoy no es válido');
  console.log(`ok  : hoy devuelve ${hoyData.total} documento(s)`);

  const manana = await fetch(
    `${API}/documents?pageSize=1&dateFrom=${dayStart(tomorrow)}&dateTo=${dayEnd(tomorrow)}`,
    { headers },
  );
  assert(manana.ok, `El filtro de mañana falló: ${manana.status}`);
  const mananaData = (await manana.json()) as { total: number };
  assert(mananaData.total === 0, 'Mañana no debería tener documentos todavía');
  console.log('ok  : el rango de mañana queda vacío');

  const created = await fetch(
    `${API}/documents?pageSize=1&dateField=created&dateFrom=${dayStart(new Date(today.getFullYear(), today.getMonth(), 1))}&dateTo=${dayEnd(today)}`,
    { headers },
  );
  assert(created.ok, `El filtro por fecha de creación falló: ${created.status}`);
  console.log('ok  : el filtro por fecha de creación responde');

  const invalid = await fetch(
    `${API}/documents?dateFrom=${dayStart(tomorrow)}&dateTo=${dayStart(today)}`,
    { headers },
  );
  assert(invalid.status === 400, `Un rango invertido debería dar 400, dio ${invalid.status}`);
  const invalidData = (await invalid.json()) as { message?: string };
  assert(
    invalidData.message?.includes('fecha inicial'),
    'El mensaje del rango invertido no es claro',
  );
  console.log('ok  : un rango invertido devuelve 400 con mensaje en español');

  console.log('\nRESULTADO: todas las comprobaciones pasaron');
}

main().catch((error) => {
  console.error('\nFALLO:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
