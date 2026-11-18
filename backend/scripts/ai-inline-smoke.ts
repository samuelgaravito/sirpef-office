/**
 * Regresión de la generación inline de la barra de IA, sin proveedor real.
 *
 *   npm run smoke:ai-inline
 *
 * Sustituye `fetch` por una respuesta OpenAI-compatible y comprueba que:
 * - el fragmento se interpreta y se sanea a TipTap;
 * - no se cuelan imágenes ni atributos no permitidos;
 * - una respuesta en texto plano se convierte en párrafos;
 * - los avisos y preguntas se conservan.
 */
import { inlineText } from '../src/modules/ai/inline.js';
import type { AiConfig } from '../src/modules/ai/providers.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://ai.test/v1',
  apiKey: 'test',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 1_000,
};

const envelope = {
  reply: 'He redactado un párrafo sobre los acuerdos.',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Se acuerda aprobar el acta de la reunión.' }],
      },
      {
        type: 'heading',
        attrs: { level: 2, style: 'color:red' },
        content: [{ type: 'text', text: 'Compromisos' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Enviar el informe el viernes.' }] },
            ],
          },
        ],
      },
      // Nodo no permitido: debe desaparecer.
      { type: 'image', attrs: { src: 'https://ejemplo.test/x.png' } },
    ],
  },
  questions: ['¿Confirmas la fecha del viernes?'],
  warnings: ['Se asumió que la reunión fue presencial.'],
};

let response: unknown = envelope;

globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: typeof response === 'string' ? response : JSON.stringify(response) } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;

const result = await inlineText(config, {
  instruction: 'Redacta los acuerdos de la reunión.',
  context: {
    docType: 'meeting_minutes',
    title: 'Acta de reunión',
    selection: '',
    before: 'Orden del día',
    after: 'Firma',
  },
});

assert(result.model === 'test-model', 'El modelo no se conserva en el resultado');
assert(result.reply.includes('acuerdos'), 'La respuesta breve no se conservó');
assert(result.warnings.length === 1, 'Se esperaba un aviso');
assert(result.questions.length === 1, 'Se esperaba una pregunta');
assert(result.content.type === 'doc', 'El contenido debe ser un documento TipTap');

const serialized = JSON.stringify(result.content);
assert(!serialized.includes('image'), 'La imagen no permitida debería haberse eliminado');
assert(!serialized.includes('color:red'), 'El atributo style no permitido debería haberse eliminado');

const blocks = result.content.content ?? [];
assert(blocks[0]?.type === 'paragraph', 'El primer bloque debería ser un párrafo');
assert(blocks[1]?.type === 'heading', 'El segundo bloque debería ser un título');
assert(blocks[2]?.type === 'bulletList', 'La lista debería conservarse');
assert(!blocks.some((block) => block.type === 'image'), 'No debería quedar ninguna imagen');

// Texto plano: se convierte en párrafos separados por línea en blanco.
response = {
  reply: 'Listo.',
  content: 'Primer párrafo.\n\nSegundo párrafo.',
  warnings: [],
  questions: [],
};

const plain = await inlineText(config, {
  instruction: 'Escribe dos párrafos.',
  context: {},
});
const plainBlocks = plain.content.content ?? [];
assert(plainBlocks.length === 2, `Se esperaban 2 párrafos y hay ${plainBlocks.length}`);
assert(
  plainBlocks.every((block) => block.type === 'paragraph'),
  'El texto plano debe convertirse en párrafos',
);

console.log('ok  : el fragmento se sanea y no admite nodos no permitidos');
console.log('ok  : las preguntas y avisos se conservan');
console.log('ok  : el texto plano se convierte en párrafos');
console.log('\nRESULTADO: todas las comprobaciones pasaron');
