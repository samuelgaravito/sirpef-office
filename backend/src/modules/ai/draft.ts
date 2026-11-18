import {
  contentHasVariable,
  plainTextFromContent,
  resolveBodyVariable,
  sanitizeAiContent,
  type AiDraftMessage,
  type AiDraftResult,
  type JSONContent,
  type VariableDef,
  type VariableValues,
} from '@sirpefoffice/shared';
import { DOCUMENT_NUMBER_VARIABLE } from '@sirpefoffice/shared';

import { AppError } from '../../lib/errors.js';
import { assertConfigured, chat, type AiConfig } from './providers.js';
import { coerce, describeVariable, extractJsonObject, isEmpty } from './values.js';

/** Datos de la plantilla que necesita el redactor. */
export interface DraftTemplate {
  name: string;
  docType: string;
  schema: VariableDef[];
  body: JSONContent;
  aiInstructions: string | null;
  aiStyle: string | null;
}

export interface DraftInput {
  template: DraftTemplate;
  current: {
    title: string;
    description: string;
    content: JSONContent;
    data: VariableValues;
  };
  messages: AiDraftMessage[];
  /** Extractos de documentos aprobados de la misma plantilla. */
  examples?: string[];
}

/** Opciones de la llamada al redactor. */
export interface DraftOptions {
  /** Se invoca con el tamaño acumulado de la respuesta mientras llega. */
  onProgress?: (chars: number) => void;
}

const DEFAULT_STYLE =
  'Tono institucional, claro y directo. Frases y párrafos cortos. Español de Perú, sin ' +
  'florituras ni muletillas. Estructura explícita: situación, detalle y solicitud o decisión.';

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * Esqueleto de la hoja: encabezados, párrafos resumidos y tamaño de las
 * tablas.
 *
 * El modelo no reescribe la hoja, solo necesita conocer su estructura, así
 * que enviar el JSON completo solo gastaría contexto y tiempo de prefill.
 */
function skeletonOf(content: JSONContent): string {
  const lines: string[] = [];

  const walk = (node: JSONContent, depth: number): void => {
    const indent = '  '.repeat(Math.min(depth, 4));
    const text = plainTextFromContent(node).replace(/\s+/g, ' ').trim();

    if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 1);
      lines.push(`${indent}${'#'.repeat(Math.min(Math.max(level, 1), 3))} ${truncate(text, 160)}`);
    } else if (node.type === 'paragraph' && text) {
      lines.push(`${indent}[párrafo] ${truncate(text, 240)}`);
    } else if (node.type === 'table') {
      const rows = node.content?.length ?? 0;
      const cells = node.content?.[0]?.content?.length ?? 0;
      lines.push(`${indent}[tabla ${rows}×${cells}] ${truncate(text, 240)}`);
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      lines.push(`${indent}[lista] ${truncate(text, 240)}`);
      return;
    } else if (node.type === 'blockquote') {
      lines.push(`${indent}[cita] ${truncate(text, 240)}`);
    } else if (node.type === 'horizontalRule') {
      lines.push(`${indent}---`);
    }

    node.content?.forEach((child) => walk(child, depth + 1));
  };

  walk(content, 0);
  return lines.join('\n');
}

/**
 * ¿Es la variable del correlativo?
 *
 * Las plantillas usan `numero_documento` (la de sistema) o una `numero`
 * propia, y la serie de numeración la rellena al aprobar. El redactor tiene
 * instrucción expresa de no escribirla, así que pedírsela al modelo —o avisar
 * de que está vacía— sería un aviso falso en todos los borradores de
 * memorándum, nota de entrega y acta.
 */
function isNumberingVariable(variable: VariableDef): boolean {
  return variable.key === DOCUMENT_NUMBER_VARIABLE || variable.key === 'numero';
}

function dataForPrompt(data: VariableValues, schema: VariableDef[]): string {
  const clean: VariableValues = {};

  for (const variable of schema) {
    if (isNumberingVariable(variable)) continue;
    const value = data[variable.key];
    if (value === undefined) continue;
    if (variable.type === 'image') {
      clean[variable.key] = '[imagen omitida]';
      continue;
    }
    if (typeof value === 'string' && value.length > 2_000) {
      clean[variable.key] = `${value.slice(0, 2_000)}…`;
      continue;
    }
    clean[variable.key] = value;
  }

  return JSON.stringify(clean, null, 2);
}

function conversationForPrompt(messages: AiDraftMessage[]): string {
  return messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? 'Usuario' : 'Asistente'}: ${truncate(message.content, 2_000)}`)
    .join('\n');
}

function buildSystemPrompt(): string {
  return [
    'Eres un redactor experto en documentos administrativos en español (Perú).',
    'Trabajas dentro de una plantilla: la hoja (cabecera, tablas de datos, firmas) ya existe;',
    'tú rellenas sus variables y redactas su cuerpo. No reinventas el formato.',
    'Escribes con un tono formal, claro y conciso, y no inventas datos verificables que no se te den.',
    '',
    'Devuelves SIEMPRE un único objeto JSON válido, sin markdown ni comentarios, con esta forma exacta:',
    '{"reply":"...","title":"...","description":"...","body":"...","data":{...},"questions":["..."],"warnings":["..."]}',
    '',
    'Reglas de "data":',
    '- Rellena en "data" TODAS las variables del esquema que puedas deducir del encargo; si no, quedarán vacías.',
    '- Usa exactamente las claves del esquema: no inventes campos nuevos.',
    '- Respeta el tipo: fechas ISO (AAAA-MM-DD), números sin símbolos ni separadores, tablas como arrays de objetos.',
    '- Para una tabla, cada fila es un objeto con las claves que indica el esquema.',
    '- No incluyas el número correlativo: lo asigna el sistema al aprobar.',
    '- Si no conoces el valor de una variable, déjala como cadena vacía; no inventes datos ni escribas marcadores como [Nombre].',
    '- Para fechas relativas («hoy», «el lunes») usa la fecha de hoy que se indica arriba.',
    '',
    'Reglas de "body":',
    '- Es la prosa del cuerpo en TEXTO PLANO: nada de JSON, HTML ni marcadores {{...}}.',
    '- Separa los párrafos con una línea en blanco.',
    '- No repitas la cabecera, las tablas de datos ni las firmas: ya están en la hoja.',
    '- No escribas etiquetas de la hoja («FECHA:», «RECIBE:», «ENTREGA:», «ÁREA / DESTINO:», «OBSERVACIONES:») ni vuelvas a enumerar los bienes de la tabla.',
    '- Redacta solo la prosa que va en el cuerpo, como si fuera el texto que sigue a la etiqueta del cuerpo.',
    '- Si hace falta enumerar, usa guiones al principio de la línea.',
    '',
    'Reglas de conversación:',
    '- "reply" es una respuesta breve (1-3 frases) en español que explica qué has cambiado y qué has asumido.',
    '- Si falta un dato importante, añádelo a "questions" pero entrega igualmente una propuesta completa.',
    '- Usa "warnings" para avisar de suposiciones o campos que conviene revisar.',
    '- Si la instrucción pide un cambio puntual, conserva todo lo demás tal y como estaba.',
  ].join('\n');
}

/** Fecha de hoy en ISO (`AAAA-MM-DD`), según la zona del servidor. */
function todayIso(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function buildUserPrompt(input: DraftInput): string {
  const { template, current, messages, examples } = input;
  const bodySlot = resolveBodyVariable(template.schema);

  const schemaLines = template.schema.length
    ? template.schema.map(describeVariable).join('\n')
    : '(La plantilla no define variables; redacta el cuerpo.)';

  const bodySlotRule = bodySlot
    ? [
        `El campo "${bodySlot.key}" («${bodySlot.label}») está marcado como cuerpo redactable.`,
        `Su prosa va en "body"; no en "data".`,
        `Si ya hay texto en el cuerpo, pártelo de él y aplícale el cambio.`,
      ].join(' ')
    : 'No hay un campo marcado como cuerpo redactable: redacta el cuerpo y rellena las variables.';

  // La hoja se envía como esqueleto, no como JSON completo: el modelo no la
  // reescribe, solo necesita conocer su estructura.
  const sheet = skeletonOf(template.body);

  const bodyText = bodySlot ? currentBodyText(current, bodySlot.key) : '';

  return [
    `Plantilla: ${template.name}`,
    `Tipo de documento: ${template.docType}`,
    `Fecha de hoy: ${todayIso()}`,
    template.aiInstructions ? `Instrucciones de la plantilla:\n"""${template.aiInstructions}"""` : '',
    `Perfil de estilo:\n"""${template.aiStyle?.trim() || DEFAULT_STYLE}"""`,
    examples?.length
      ? `Ejemplos de estilo de documentos aprobados (imita el tono, no el contenido):\n"""${examples.join('\n---\n')}"""`
      : '',
    `Esquema de variables:\n${schemaLines}`,
    bodySlotRule,
    `Estructura de la hoja (ya está puesta; no la reescribas):\n${sheet}`,
    bodySlot
      ? `Texto actual del cuerpo:\n"""${bodyText || '(vacío)'}"""`
      : `Documento actual (resumen):\n${skeletonOf(current.content)}`,
    `Datos actuales:\n${dataForPrompt(current.data, template.schema)}`,
    `Título actual: ${current.title || '(sin título)'}`,
    `Descripción actual: ${current.description || '(sin descripción)'}`,
    `Conversación hasta ahora:\n${conversationForPrompt(messages)}`,
    'Genera la siguiente versión siguiendo la última instrucción del usuario.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => truncate(item.trim(), 400))
    .slice(0, max);
}

function replacePlaceholder(content: JSONContent, key: string, text: string): JSONContent {
  const pattern = new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
  const clone = structuredClone(content);

  const walk = (node: JSONContent): void => {
    if (node.text) node.text = node.text.replace(pattern, text);
    node.content?.forEach(walk);
  };

  walk(clone);
  return clone;
}

/* ─────────────────── El cuerpo redactable dentro de la hoja ─────────────────── */

/** Marcador de la variable del cuerpo (`{{clave}}`). */
function bodyMarker(key: string): RegExp {
  return new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function blockText(node: JSONContent): string {
  return normalizeText(plainTextFromContent(node));
}

/** Párrafos TipTap a partir de texto plano: una línea en blanco = un párrafo. */
function paragraphsFromText(text: string): JSONContent[] {
  const parts = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return [{ type: 'paragraph' }];

  return parts.slice(0, 60).map((part) => {
    const content: JSONContent[] = [];
    part.split('\n').forEach((line, index) => {
      if (index > 0) content.push({ type: 'hardBreak' });
      const trimmed = line.trim();
      if (trimmed) content.push({ type: 'text', text: trimmed });
    });
    return { type: 'paragraph', ...(content.length > 0 ? { content } : {}) };
  });
}

interface BodyRegion {
  start: number;
  end: number;
  /** El cuerpo sigue como marcador `{{clave}}` en la hoja. */
  marker: boolean;
}

/**
 * Localiza el cuerpo redactable dentro de la hoja.
 *
 * Primero por el marcador; si ya se integró, por el texto que se escribió la
 * vez anterior (el que se guarda en la variable). Sin esto, cada turno
 * duplicaría la prosa o la perdería.
 */
function locateBody(content: JSONContent, key: string, previous: string): BodyRegion | null {
  const blocks = content.content ?? [];
  const pattern = bodyMarker(key);

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block?.content?.some((child) => child.type === 'text' && pattern.test(child.text ?? ''))) {
      return { start: index, end: index, marker: true };
    }
  }

  const target = normalizeText(previous);
  if (target.length < 8) return null;

  for (let start = 0; start < blocks.length; start += 1) {
    let accumulated = '';
    for (let end = start; end < blocks.length; end += 1) {
      const block = blocks[end];
      if (!block) break;
      const text = blockText(block);
      if (!text) break;
      accumulated = normalizeText(accumulated ? `${accumulated} ${text}` : text);
      if (accumulated === target) return { start, end, marker: false };
      if (accumulated.length > target.length || !target.startsWith(accumulated)) break;
    }
  }

  return null;
}

/** Texto del cuerpo tal y como está hoy en la hoja. */
function currentBodyText(current: DraftInput['current'], key: string): string {
  const stored = typeof current.data[key] === 'string' ? String(current.data[key]) : '';
  const region = locateBody(current.content, key, stored);
  if (!region) return stored;
  if (region.marker) return '';

  const blocks = current.content.content ?? [];
  return blocks
    .slice(region.start, region.end + 1)
    .map(blockText)
    .filter(Boolean)
    .join('\n\n');
}

/** Reemplaza el cuerpo por los párrafos nuevos y conserva el resto de la hoja. */
function replaceBody(
  content: JSONContent,
  key: string,
  text: string,
  previous: string,
): JSONContent | null {
  const region = locateBody(content, key, previous);
  if (!region) return null;

  const blocks = structuredClone(content.content ?? []);
  const pattern = bodyMarker(key);

  // El modelo tiende a repetir líneas fijas de la hoja («En señal de
  // conformidad…»). Se descartan las que ya están fuera del cuerpo para no
  // duplicarlas.
  const sheetTexts = new Set(
    blocks
      .filter((_, index) => index < region.start || index > region.end)
      .map((node) => blockText(node))
      .filter((text) => text.length >= 12),
  );

  const paragraphs = paragraphsFromText(text);
  const withoutEchoes = paragraphs.filter((node) => {
    const block = blockText(node);
    return !block || block.length < 12 || !sheetTexts.has(block);
  });
  const body = withoutEchoes.length > 0 ? withoutEchoes : paragraphs;

  if (!region.marker) {
    blocks.splice(region.start, region.end - region.start + 1, ...body);
    return { ...content, content: blocks };
  }

  // El marcador puede compartir párrafo con su etiqueta («OBSERVACIONES: …»):
  // la etiqueta se queda y la prosa va detrás.
  const block = blocks[region.start];
  if (!block) return null;

  const kept: JSONContent[] = [];
  if (block.type === 'paragraph' || block.type === 'heading') {
    const prefix: JSONContent[] = [];
    let cut = false;

    for (const child of block.content ?? []) {
      if (child.type !== 'text' && child.type !== 'hardBreak') continue;
      if (cut) continue;
      if (child.type === 'text' && pattern.test(child.text ?? '')) {
        cut = true;
        const before = (child.text ?? '').replace(pattern, '');
        if (before.trim()) prefix.push({ type: 'text', text: before });
        continue;
      }
      prefix.push(child);
    }

    if (prefix.some((node) => node.type === 'text' && (node.text ?? '').trim())) {
      kept.push({ type: block.type, ...(block.attrs ? { attrs: block.attrs } : {}), content: prefix });
    }
  }

  blocks.splice(region.start, 1, ...kept, ...body);
  return { ...content, content: blocks };
}

/* ─────────────────────── Salidas estructuradas (B) ─────────────────────── */

/** Tipo JSON de una variable según el esquema de la plantilla. */
function variableSchema(variable: VariableDef | { type?: string; options?: { value: string }[]; columns?: { key: string }[] }): Record<string, unknown> {
  switch (variable.type) {
    case 'number':
    case 'money':
      return { type: 'number' };
    case 'checkbox':
      return { type: 'boolean' };
    case 'select': {
      const values = variable.options?.map((option) => option.value) ?? [];
      return values.length > 0 ? { type: 'string', enum: values } : { type: 'string' };
    }
    case 'multiselect': {
      const values = variable.options?.map((option) => option.value) ?? [];
      return {
        type: 'array',
        ...(values.length > 0 ? { items: { type: 'string', enum: values } } : { items: { type: 'string' } }),
      };
    }
    case 'date':
      return { type: 'string', description: 'Fecha en formato AAAA-MM-DD' };
    case 'table':
      return {
        type: 'array',
        items: {
          type: 'object',
          properties: Object.fromEntries((variable.columns ?? []).map((column) => [column.key, { type: 'string' }])),
          required: (variable.columns ?? []).map((column) => column.key),
        },
      };
    default:
      return { type: 'string' };
  }
}

/** Descripción de una variable para el esquema de salida. */
function variableDescription(variable: VariableDef): string {
  return [variable.label, variable.description, variable.aiHint]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' — ');
}

/**
 * Esquema JSON de la respuesta del redactor.
 *
 * Con Ollama se envía como `format`, así que el modelo queda atado a estas
 * claves y tipos: es lo que evita que devuelva `data` vacío o invente campos.
 * Las claves van marcadas como obligatorias para que el modelo tenga que
 * pronunciarse sobre cada variable (puede dejarla vacía si no la conoce).
 */
function draftSchemaFor(schema: VariableDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const variable of schema) {
    if (isNumberingVariable(variable) || variable.type === 'image' || variable.type === 'user') continue;
    properties[variable.key] = {
      ...variableSchema(variable),
      description: variableDescription(variable),
    };
  }

  return {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Respuesta breve para el usuario' },
      title: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string', description: 'Prosa del cuerpo, en texto plano' },
      data: {
        type: 'object',
        properties,
        required: Object.keys(properties),
      },
      questions: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['reply', 'body', 'data'],
  };
}

/** ¿El valor es un hueco tipo `[Nombre del entregador]` en vez de un dato? */
function looksLikePlaceholder(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  // «[Nombre del entregador]» y «Nombre del Entregador» son huecos, no datos.
  return (
    /^\[.*\]$/.test(text) ||
    /^<.*>$/.test(text) ||
    /^(nombre|cargo|fecha|área|area|descripción|descripcion)\s+(del|de la|de)\b/i.test(text)
  );
}

/** Aplica la respuesta del modelo sobre el estado actual. */
function mergeResult(
  parsed: Record<string, unknown>,
  input: DraftInput,
): {
  content: JSONContent;
  data: VariableValues;
  title: string;
  description: string;
  warnings: string[];
} {
  const { template, current } = input;
  const warnings = stringArray(parsed.warnings, 8);

  const rawDocument =
    parsed.document && typeof parsed.document === 'object' && !Array.isArray(parsed.document)
      ? (parsed.document as Record<string, unknown>)
      : parsed;

  const title =
    typeof rawDocument.title === 'string' && rawDocument.title.trim()
      ? truncate(rawDocument.title.trim(), 240)
      : current.title || template.name;

  const description =
    typeof rawDocument.description === 'string'
      ? truncate(rawDocument.description.trim(), 500)
      : current.description;

  const bodyText = typeof rawDocument.body === 'string' ? rawDocument.body.trim() : '';

  const incoming =
    rawDocument.data && typeof rawDocument.data === 'object' && !Array.isArray(rawDocument.data)
      ? (rawDocument.data as Record<string, unknown>)
      : {};

  const data: VariableValues = { ...current.data };
  const bodySlot = resolveBodyVariable(template.schema);

  for (const variable of template.schema) {
    if (isNumberingVariable(variable)) continue;

    if (variable.bodySlot) {
      // La prosa viaja en "body"; en "data" se guarda el texto plano.
      const value = bodyText || (typeof incoming[variable.key] === 'string' ? String(incoming[variable.key]).trim() : '');
      if (value) data[variable.key] = truncate(value, 20_000);
      continue;
    }

    if (!(variable.key in incoming)) continue;
    const value = coerce(variable, incoming[variable.key]);
    // Un hueco («[Nombre del entregador]») no es un dato: se deja vacío para
    // que el aviso de campo obligatorio siga teniendo sentido.
    if (!isEmpty(value) && !looksLikePlaceholder(value)) data[variable.key] = value;
  }

  delete data[DOCUMENT_NUMBER_VARIABLE];

  // Contenido: la hoja de la plantilla se conserva y solo cambia el cuerpo.
  let content = current.content;
  const explicitContent = rawDocument.content ?? parsed.content;

  if (explicitContent !== undefined) {
    // Camino antiguo: el modelo devolvió el documento TipTap completo.
    content = sanitizeAiContent(explicitContent);
    if (bodySlot && contentHasVariable(content, bodySlot.key)) {
      const fallback = typeof data[bodySlot.key] === 'string' ? String(data[bodySlot.key]) : '';
      if (fallback.trim()) {
        content = replacePlaceholder(content, bodySlot.key, fallback.trim());
        warnings.push(
          `El cuerpo se ha insertado desde el campo «${bodySlot.label}»; revisa el formato porque la IA no lo integró como bloques.`,
        );
      } else {
        warnings.push(`El cuerpo redactable «${bodySlot.label}» quedó como marcador sin contenido.`);
      }
    }
  } else if (bodySlot && bodyText) {
    const previous = typeof current.data[bodySlot.key] === 'string' ? String(current.data[bodySlot.key]) : '';
    const composed =
      replaceBody(current.content, bodySlot.key, bodyText, previous) ??
      // Si la hoja se editó a mano y no se encuentra el cuerpo, se recompone
      // desde la plantilla para no perder la redacción.
      replaceBody(template.body, bodySlot.key, bodyText, '');

    if (composed) {
      content = composed;
    } else {
      warnings.push(
        `No se localizó el cuerpo «${bodySlot.label}» en la hoja; revisa su contenido a mano.`,
      );
    }
  }

  // Avisos por variables obligatorias que siguen vacías.
  for (const variable of template.schema) {
    if (!variable.required || isNumberingVariable(variable)) continue;
    if (variable.bodySlot && !contentHasVariable(content, variable.key)) continue;
    if (isEmpty(data[variable.key])) {
      warnings.push(`El campo obligatorio «${variable.label}» sigue vacío.`);
    }
  }

  return { content, data, title, description, warnings };
}

/** Perfil de estilo deducido de documentos aprobados. */
export interface StyleInput {
  templateName: string;
  docType: string;
  aiInstructions: string | null;
  aiStyle: string | null;
  examples: string[];
}

/**
 * Analiza extractos de documentos aprobados y devuelve un perfil de estilo
 * listo para editar. No guarda nada: el editor de plantillas decide.
 */
export async function deriveStyle(config: AiConfig, input: StyleInput): Promise<string> {
  assertConfigured(config);

  const system = [
    'Eres un editor experto en documentos administrativos en español (Perú).',
    'Tu tarea es describir el estilo de escritura de una institución a partir de ejemplos reales.',
    'Devuelve SOLO el perfil de estilo, en español, sin markdown, sin listas numeradas y sin comentarios.',
  ].join(' ');

  const user = [
    `Plantilla: ${input.templateName} (${input.docType}).`,
    input.aiInstructions ? `Instrucciones actuales:\n"""${input.aiInstructions}"""` : '',
    input.aiStyle ? `Perfil actual (puedes mejorarlo):\n"""${input.aiStyle}"""` : '',
    `Documentos aprobados de referencia:\n"""${input.examples.join('\n---\n')}"""`,
    'Escribe un perfil de 5 a 10 frases que describa: voz y tratamiento, tono, longitud y ritmo de los párrafos, fórmulas de apertura y cierre, uso de tablas y listas, vocabulario preferido y expresiones que deben evitarse.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await chat(
    { ...config, maxTokens: Math.min(Math.max(config.maxTokens, 1_200), 4_000), temperature: 0.3 },
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    false,
  );

  const style = raw
    .replace(/^\s*```(?:text|md)?/i, '')
    .replace(/```\s*$/i, '')
    .trim()
    .slice(0, 4_000);

  if (!style) {
    throw new AppError(502, 'AI_EMPTY', 'La IA no devolvió un perfil de estilo utilizable');
  }

  return style;
}

/**
 * Pide al modelo una nueva versión del documento.
 *
 * La respuesta se sanea y se mezcla con el estado actual: el modelo no puede
 * inventar variables nuevas, ni tocar la numeración, ni colar HTML.
 */
export async function draftDocument(
  config: AiConfig,
  input: DraftInput,
  options: DraftOptions = {},
): Promise<AiDraftResult> {
  if (config.provider === 'none' || (config.provider !== 'ollama' && !config.apiKey)) {
    throw new AppError(
      400,
      'AI_NOT_CONFIGURED',
      'No hay proveedor de IA configurado. Elige uno en Ajustes para redactar con el asistente.',
    );
  }

  const raw = await chat(
    {
      ...config,
      // El redactor ya no devuelve el documento TipTap: solo los datos y la
      // prosa del cuerpo, así que necesita mucho menos espacio de salida. El
      // tope sigue holgado por si el cuerpo es largo.
      maxTokens: Math.min(Math.max(config.maxTokens, 2_000), 8_000),
      temperature: Math.min(Math.max(config.temperature, 0.2), 0.7),
    },
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(input) },
    ],
    true,
    {
      jsonSchema: draftSchemaFor(input.template.schema),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    },
  );

  const parsed = extractJsonObject(raw, 'AI_INVALID_JSON');
  const merged = mergeResult(parsed, input);

  const reply =
    typeof parsed.reply === 'string' && parsed.reply.trim()
      ? truncate(parsed.reply.trim(), 2_000)
      : `He preparado una propuesta de ${input.template.name}. Revísala y dime qué quieres cambiar.`;

  return {
    reply,
    document: {
      title: merged.title,
      description: merged.description,
      content: merged.content,
      data: merged.data,
    },
    questions: stringArray(parsed.questions, 5),
    warnings: merged.warnings.slice(0, 10),
    model: config.model,
  };
}
