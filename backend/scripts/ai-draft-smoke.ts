/**
 * Regresión del asistente de redacción, sin proveedor ni base de datos.
 *
 *   npm run smoke:ai-draft
 *
 * Sustituye `fetch` por una respuesta OpenAI-compatible y comprueba que:
 * - el sobre JSON se interpreta aunque venga con vallas de Markdown;
 * - el contenido se sanea a TipTap (nada de imágenes ni HTML);
 * - los tipos de las variables se coaccionan (fecha ISO);
 * - el cuerpo redactable sustituye al marcador y deja texto plano en `data`;
 * - el número correlativo nunca lo devuelve la IA.
 */
import type { JSONContent } from '@sirpefoffice/shared';

import { deriveStyle, draftDocument } from '../src/modules/ai/draft.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const envelope = {
  reply: 'Listo, he preparado el memorándum.',
  document: {
    title: 'Memorándum sobre equipos',
    description: 'Retraso en la entrega de equipos',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'MEMORÁNDUM' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'PARA: ' }, { type: 'text', text: '{{destinatario}}' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Le informo del retraso en la entrega de los equipos.' }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Equipo' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Estado' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Laptop' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pendiente' }] }] },
              ],
            },
          ],
        },
        // Nodo no permitido: debe desaparecer del resultado saneado.
        { type: 'image', attrs: { src: 'https://ejemplo.test/x.png' } },
        // Atributo no permitido: se descarta.
        { type: 'paragraph', attrs: { style: 'color:red' }, content: [{ type: 'text', text: 'Firma' }] },
      ],
    },
    data: {
      destinatario: 'Ana Pérez',
      fecha: '2026-11-13',
      cuerpo: 'Le informo del retraso en la entrega de los equipos.',
      numero: 'MEM-9999-2026',
    },
  },
  questions: ['¿Confirmas el plazo del viernes?'],
  warnings: ['Se asumió el nombre de la jefa.'],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\`` } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const body: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'MEMORÁNDUM' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'PARA: {{destinatario}}' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '{{cuerpo}}' }] },
  ],
};

try {
  const result = await draftDocument(
    {
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test',
      model: 'fake-model',
      temperature: 0.4,
      maxTokens: 1200,
    },
    {
      template: {
        name: 'Memorándum',
        docType: 'memorandum',
        schema: [
          { key: 'destinatario', label: 'Para', type: 'text', required: true },
          { key: 'fecha', label: 'Fecha', type: 'date', required: true },
          { key: 'cuerpo', label: 'Cuerpo', type: 'longtext', required: true, bodySlot: true },
        ],
        body,
        aiInstructions: 'Redacta un memorándum formal.',
        aiStyle: 'Tono institucional y breve.',
      },
      current: {
        title: 'Memorándum',
        description: '',
        content: body,
        data: { destinatario: '', fecha: '', cuerpo: '' },
      },
      messages: [{ role: 'user', content: 'Haz un memo para la jefa Ana sobre el retraso.' }],
      examples: [],
    },
  );

  assert(result.reply.includes('memorándum'), 'No se conservó la respuesta del chat');
  assert(result.document.title === 'Memorándum sobre equipos', 'No se aplicó el título');
  assert(result.document.data.destinatario === 'Ana Pérez', 'No se aplicó el destinatario');
  assert(result.document.data.fecha === '2026-11-13', 'La fecha no se normalizó a ISO');
  assert(!('numero' in result.document.data), 'La IA no debe devolver el número correlativo');
  assert(result.questions.length === 1, 'No se conservaron las preguntas');
  assert(result.warnings.length >= 1, 'No se conservaron los avisos');
  assert(result.model === 'fake-model', 'No se devolvió el modelo');

  const json = JSON.stringify(result.document.content);
  assert(!json.includes('"image"'), 'El saneado dejó pasar un nodo image');
  assert(!json.includes('color:red'), 'El saneado dejó pasar atributos arbitrarios');
  assert(json.includes('"table"'), 'Se perdió la tabla generada');
  assert(!json.includes('{{cuerpo}}'), 'El cuerpo redactable quedó como marcador');
  assert(result.document.data.cuerpo.includes('retraso'), 'No se guardó el texto plano del cuerpo');

  console.log('ok  : el sobre JSON se interpreta con vallas de Markdown');
  console.log('ok  : el contenido se sanea a nodos TipTap permitidos');
  console.log('ok  : las variables se coaccionan y se descarta el correlativo');
  console.log('ok  : el cuerpo redactable se integra en la hoja');
  // Segundo caso: perfil de estilo en texto plano.
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '```text\nTono institucional, tratamiento de usted y párrafos breves.\n```',
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const style = await deriveStyle(
    {
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test',
      model: 'fake-model',
      temperature: 0.4,
      maxTokens: 1200,
    },
    {
      templateName: 'Memorándum',
      docType: 'memorandum',
      aiInstructions: null,
      aiStyle: null,
      examples: ['MEMORÁNDUM\nPara: Ana Pérez\nLe informo del retraso.'],
    },
  );

  assert(style.startsWith('Tono institucional'), 'No se limpiaron las vallas del perfil de estilo');
  assert(!style.includes('```'), 'El perfil conserva vallas de Markdown');
  console.log('ok  : el perfil de estilo se limpia y se devuelve como texto');
  console.log('ok  : preguntas, avisos y modelo llegan al cliente');
  console.log('\nRESULTADO: todas las comprobaciones pasaron');
} finally {
  globalThis.fetch = originalFetch;
}
