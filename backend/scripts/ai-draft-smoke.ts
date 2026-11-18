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

const INLINE_NODES = new Set(['text', 'hardBreak']);
const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'table',
  'horizontalRule',
]);

/**
 * Comprueba lo mismo que TipTap al montar el documento: un `paragraph` solo
 * admite texto, una celda necesita bloques y una tabla solo filas. Si algo
 * falla, `setContent` lanzaría y la propuesta no se aplicaría.
 */
function estructuraInvalida(content: JSONContent): string[] {
  const errores: string[] = [];

  const walk = (node: JSONContent, path: string): void => {
    const children = node.content ?? [];
    const tipo = (child: JSONContent): string => child.type ?? '(sin tipo)';

    if (node.type === 'paragraph' || node.type === 'heading') {
      for (const child of children) {
        if (!INLINE_NODES.has(tipo(child))) errores.push(`${path}: ${node.type} contiene ${tipo(child)}`);
      }
    }

    if (node.type === 'table') {
      for (const child of children) {
        if (tipo(child) !== 'tableRow') errores.push(`${path}: table contiene ${tipo(child)}`);
      }
    }

    if (node.type === 'tableRow') {
      for (const child of children) {
        if (tipo(child) !== 'tableCell' && tipo(child) !== 'tableHeader') {
          errores.push(`${path}: tableRow contiene ${tipo(child)}`);
        }
      }
    }

    if (
      node.type === 'tableCell' ||
      node.type === 'tableHeader' ||
      node.type === 'listItem' ||
      node.type === 'blockquote'
    ) {
      if (!children.some((child) => BLOCK_NODES.has(tipo(child)))) {
        errores.push(`${path}: ${node.type} no tiene ningún bloque dentro`);
      }
    }

    if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const child of children) {
        if (tipo(child) !== 'listItem') errores.push(`${path}: lista contiene ${tipo(child)}`);
      }
    }

    children.forEach((child, index) => walk(child, `${path}/${index}-${tipo(child)}`));
  };

  walk(content, 'doc');
  return errores;
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

/** Configuración de proveedor falsa: el `fetch` está simulado. */
const config = {
  provider: 'openai' as const,
  baseUrl: 'https://example.test/v1',
  apiKey: 'test',
  model: 'fake-model',
  temperature: 0.4,
  maxTokens: 1200,
};

const input = {
  template: {
    name: 'Memorándum',
    docType: 'memorandum',
    schema: [
      { key: 'destinatario', label: 'Para', type: 'text' as const, required: true },
      { key: 'fecha', label: 'Fecha', type: 'date' as const, required: true },
      {
        key: 'cuerpo',
        label: 'Cuerpo',
        type: 'longtext' as const,
        required: true,
        bodySlot: true,
      },
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
  examples: [] as string[],
};

try {
  const result = await draftDocument(config, input);

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

  // Caso 2: el modelo anida bloques donde TipTap no los admite. Sin
  // reubicarlos, `setContent` lanza «Invalid content for node type paragraph»
  // y la hoja se queda con la plantilla sin aplicar.
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: 'Propuesta con anidado incorrecto.',
                content: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: 'PARA: ' },
                        // Tabla dentro de un párrafo (ilegal en el esquema).
                        {
                          type: 'table',
                          content: [
                            {
                              type: 'tableRow',
                              content: [
                                { type: 'tableCell', content: [{ type: 'text', text: 'Ana' }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    // Texto suelto dentro de un elemento de lista (ilegal).
                    { type: 'listItem', content: [{ type: 'text', text: 'Suelto' }] },
                  ],
                },
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const anidado = await draftDocument(config, input);
  const errores = estructuraInvalida(anidado.document.content);

  assert(errores.length === 0, `El saneado dejó una estructura inválida: ${errores.join('; ')}`);
  assert(
    JSON.stringify(anidado.document.content).includes('"table"'),
    'La tabla anidada se perdió en vez de reubicarse',
  );
  assert(
    JSON.stringify(anidado.document.content).includes('Suelto'),
    'El texto mal anidado se perdió en vez de reubicarse',
  );
  console.log('ok  : los bloques mal anidados se reubican y el editor no los rechaza');

  // Caso 3: camino rápido. El modelo devuelve solo datos y prosa del cuerpo;
  // la hoja se conserva y la prosa entra en el marcador del cuerpo.
  const rapidoMock = (body: string, data: Record<string, unknown>): void => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ reply: 'Listo.', title: 'Memorándum', body, data }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
  };

  rapidoMock('Primer párrafo del cuerpo.\n\nSegundo párrafo.', {
    destinatario: 'Ana Pérez',
    fecha: '2026-11-20',
  });

  const rapido = await draftDocument(config, input);
  const rapidoJson = JSON.stringify(rapido.document.content);

  assert(rapidoJson.includes('Primer párrafo del cuerpo'), 'La prosa no entró en la hoja');
  assert(!rapidoJson.includes('{{cuerpo}}'), 'El marcador del cuerpo quedó en la hoja');
  assert(rapidoJson.includes('{{destinatario}}'), 'La hoja perdió el marcador del destinatario');
  assert(rapidoJson.includes('MEMORÁNDUM'), 'La hoja perdió su cabecera');
  assert(rapido.document.data.destinatario === 'Ana Pérez', 'No se aplicó el destinatario');
  assert(
    String(rapido.document.data.cuerpo).includes('Segundo párrafo'),
    'El cuerpo no se guardó como texto en data',
  );
  console.log('ok  : la prosa entra en la hoja y el resto de la plantilla se conserva');

  // Segundo turno: se reemplaza el cuerpo, no se duplica.
  rapidoMock('Primer párrafo corregido.\n\nTercer párrafo.', {
    destinatario: 'Ana Pérez',
    fecha: '2026-11-20',
  });

  const segundoTurno = await draftDocument(config, {
    ...input,
    current: {
      title: rapido.document.title,
      description: rapido.document.description,
      content: rapido.document.content,
      data: rapido.document.data,
    },
  });
  const segundoJson = JSON.stringify(segundoTurno.document.content);
  const ocurrencias = segundoJson.split('corregido').length - 1;

  assert(ocurrencias === 1, `El cuerpo se duplicó (${ocurrencias} veces)`);
  assert(!segundoJson.includes('Segundo párrafo'), 'Quedó prosa vieja en la hoja');
  assert(segundoJson.includes('Tercer párrafo'), 'No se aplicó la prosa nueva');
  console.log('ok  : el segundo turno reemplaza el cuerpo sin duplicarlo');
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
