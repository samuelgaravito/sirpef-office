#!/usr/bin/env tsx
/**
 * Comprobación de los mensajes de error de la API.
 *
 *   npx tsx scripts/error-smoke.ts
 *
 * Recorre con `app.inject()` las rutas que fallan por distintos motivos y
 * comprueba que la respuesta explica qué pasó, en español, y que el estado
 * HTTP corresponde al tipo de fallo.
 */
import { buildApp } from '../src/app.js';

interface Case {
  name: string;
  expectedStatus: number;
  /** Texto que debe aparecer en el mensaje. */
  expects: string;
  /** Texto que NO debe aparecer (mensajes genéricos o en inglés). */
  forbids?: string;
  request: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  };
}

const CASES: Case[] = [
  {
    name: 'Ruta inexistente',
    expectedStatus: 404,
    expects: 'no encontrada',
    request: { method: 'GET', url: '/api/no-existe' },
  },
  {
    name: 'Validación: correo con formato inválido',
    expectedStatus: 400,
    expects: 'Datos inválidos',
    forbids: 'Invalid input',
    request: {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'no-es-un-correo', password: 'x' },
    },
  },
  {
    name: 'Validación: campo ausente',
    expectedStatus: 400,
    expects: 'obligatorio',
    forbids: 'Invalid input',
    request: { method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.com' } },
  },
  {
    name: 'Content-Type no JSON',
    expectedStatus: 400,
    expects: 'Datos inválidos',
    forbids: 'Invalid input',
    request: {
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'hola',
    },
  },
  {
    name: 'Sin sesión',
    expectedStatus: 401,
    expects: 'token',
    request: { method: 'POST', url: '/api/documents', payload: { title: 'x' } },
  },
];

async function main(): Promise<void> {
  const app = await buildApp();
  let failures = 0;

  for (const testCase of CASES) {
    const response = await app.inject({
      method: testCase.request.method,
      url: testCase.request.url,
      ...(testCase.request.payload !== undefined ? { payload: testCase.request.payload } : {}),
      ...(testCase.request.headers ? { headers: testCase.request.headers } : {}),
    });

    let body: { error?: string; message?: string; details?: unknown } = {};
    try {
      body = response.json();
    } catch {
      /* respuesta no JSON */
    }

    const message = body.message ?? '';
    const problems: string[] = [];

    if (response.statusCode !== testCase.expectedStatus) {
      problems.push(`estado ${response.statusCode}, se esperaba ${testCase.expectedStatus}`);
    }
    if (!message.toLowerCase().includes(testCase.expects.toLowerCase())) {
      problems.push(`el mensaje no menciona «${testCase.expects}»`);
    }
    if (testCase.forbids && message.includes(testCase.forbids)) {
      problems.push(`el mensaje contiene «${testCase.forbids}»`);
    }
    if (!body.error) {
      problems.push('la respuesta no trae código de error');
    }

    if (problems.length === 0) {
      console.log(`✔ ${testCase.name}`);
      console.log(`  ${response.statusCode} ${body.error} — ${message}`);
    } else {
      failures += 1;
      console.log(`✖ ${testCase.name}`);
      console.log(`  ${response.statusCode} ${body.error} — ${message}`);
      for (const problem of problems) console.log(`  · ${problem}`);
    }
  }

  await app.close();
  console.log(
    failures === 0
      ? `\n✔ ${CASES.length} casos de error con mensajes comprensibles`
      : `\n✖ ${failures} de ${CASES.length} casos fallaron`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
