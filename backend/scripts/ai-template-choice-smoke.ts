/**
 * Regresión de la elección de plantilla para un encargo en lenguaje natural.
 *
 *   npm run smoke:ai-template
 *
 * Sustituye `fetch` por una respuesta OpenAI-compatible y comprueba que:
 * - el modelo elige una plantilla y se valida que exista;
 * - un id inventado cae en la heurística;
 * - «acta de reunión» acierta el tipo de documento;
 * - sin proveedor configurado se sigue eligiendo una plantilla;
 * - con una sola candidata no se consulta al modelo;
 * - sin plantillas activas se responde con un error explicado.
 */
import type { AiTemplateChoice } from '@sirpefoffice/shared';

import { AppError } from '../src/lib/errors.js';
import { chooseTemplate, type TemplateCandidate } from '../src/modules/ai/template-choice.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const candidates: TemplateCandidate[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Memorándum interno',
    docType: 'memorandum',
    description: 'Comunicación breve entre áreas de la institución.',
    aiInstructions: null,
    updatedAt: new Date('2026-01-10T10:00:00Z'),
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Acta de reunión',
    docType: 'meeting_minutes',
    description: 'Registro de asistentes, temas tratados y acuerdos.',
    aiInstructions: null,
    updatedAt: new Date('2026-02-10T10:00:00Z'),
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Certificado de trabajo',
    docType: 'certificate',
    description: 'Constancia de vínculo laboral y cargo desempeñado.',
    aiInstructions: null,
    updatedAt: new Date('2026-03-10T10:00:00Z'),
  },
];

const config = {
  provider: 'openai' as const,
  baseUrl: 'https://example.test/v1',
  apiKey: 'test',
  model: 'fake-model',
  temperature: 2,
  maxTokens: 100,
};

const originalFetch = globalThis.fetch;

function mockAnswer(content: string): void {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

try {
  mockAnswer(
    JSON.stringify({
      templateId: candidates[2]!.id,
      reason: 'El encargo pide una constancia de trabajo.',
    }),
  );

  const chosen: AiTemplateChoice = await chooseTemplate(
    config,
    'Necesito una constancia de trabajo para Juan Pérez, con su cargo.',
    candidates,
  );

  assert(chosen.templateId === candidates[2]!.id, 'El modelo no eligió el certificado');
  assert(chosen.source === 'ia', 'La elección no se atribuyó al modelo');
  assert(chosen.docType === 'certificate', 'No se devolvió el tipo de documento');
  assert(chosen.reason.includes('constancia'), 'No se conservó el motivo del modelo');
  console.log('ok  : la elección del modelo se valida contra la lista');

  mockAnswer(
    JSON.stringify({ templateId: '99999999-9999-4999-8999-999999999999', reason: 'Inventada.' }),
  );

  const invented = await chooseTemplate(config, 'Hazme un acta de la reunión del lunes.', candidates);
  assert(
    invented.templateId === candidates[1]!.id,
    'Un id inventado debe caer en la heurística de acta',
  );
  assert(invented.source === 'heuristica', 'El origen debería ser la heurística');
  console.log('ok  : un identificador inventado cae en la heurística');

  mockAnswer('esto no es JSON');

  const broken = await chooseTemplate(config, 'Hazme un acta de la reunión del lunes.', candidates);
  assert(broken.templateId === candidates[1]!.id, 'Un JSON roto debe caer en la heurística');
  console.log('ok  : una respuesta sin JSON cae en la heurística');

  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error('no debería llamarse');
  };

  const offline = await chooseTemplate({ ...config, provider: 'none' }, 'Redacta un memo interno.', candidates);
  assert(offline.source === 'heuristica', 'Sin proveedor debe elegir la heurística');
  assert(offline.templateId === candidates[0]!.id, 'El memo debería elegir el memorándum');
  assert(!fetched, 'No se debe llamar al proveedor sin configuración');
  console.log('ok  : sin proveedor se elige por palabras clave');

  const single = await chooseTemplate(config, 'Cualquier cosa', [candidates[0]!]);
  assert(single.source === 'unica', 'Con una sola plantilla no se consulta al modelo');
  assert(!fetched, 'No se debe llamar al proveedor con una sola plantilla');
  console.log('ok  : con una sola plantilla no se llama al modelo');

  let emptyCode = '';
  try {
    await chooseTemplate(config, 'Hazme algo', []);
  } catch (error) {
    if (error instanceof AppError) emptyCode = error.code;
  }
  assert(emptyCode === 'AI_NO_TEMPLATES', 'Sin plantillas debe responder AI_NO_TEMPLATES');
  console.log('ok  : sin plantillas activas se explica el problema');

  console.log('\nRESULTADO: todas las comprobaciones pasaron');
} finally {
  globalThis.fetch = originalFetch;
}
