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

const DEFAULT_STYLE =
  'Tono institucional, claro y directo. Frases y párrafos cortos. Español de Perú, sin ' +
  'florituras ni muletillas. Estructura explícita: situación, detalle y solicitud o decisión.';

/** Máximo de caracteres del esqueleto que se envía al modelo. */
const MAX_PROMPT_DOC_CHARS = 18_000;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Descripción compacta del documento cuando el JSON completo es muy grande. */
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
 * Copia del documento apta para el prompt: fuera imágenes (pueden ser data
 * URLs enormes) y atributos que no aportan a la redacción.
 */
function promptSafeContent(content: JSONContent): JSONContent {
  if (content.type === 'image') {
    return { type: 'paragraph', content: [{ type: 'text', text: '[imagen]' }] };
  }

  const attrs =
    content.type === 'heading'
      ? content.attrs?.level !== undefined
        ? { level: content.attrs.level }
        : undefined
      : content.type === 'orderedList'
        ? content.attrs?.start !== undefined
          ? { start: content.attrs.start }
          : undefined
        : content.type === 'tableCell' || content.type === 'tableHeader'
          ? {
              ...(content.attrs?.colspan !== undefined ? { colspan: content.attrs.colspan } : {}),
              ...(content.attrs?.rowspan !== undefined ? { rowspan: content.attrs.rowspan } : {}),
            }
          : undefined;

  return {
    ...content,
    ...(attrs && Object.keys(attrs).length > 0 ? { attrs } : { attrs: undefined }),
    ...(content.content ? { content: content.content.map(promptSafeContent) } : {}),
  };
}

function documentForPrompt(content: JSONContent, label: string): string {
  const json = JSON.stringify(promptSafeContent(content));
  if (json.length <= MAX_PROMPT_DOC_CHARS) {
    return `${label} (JSON TipTap):\n${json}`;
  }
  return `${label} (esqueleto; el JSON es demasiado largo):\n${skeletonOf(content)}`;
}

function dataForPrompt(data: VariableValues, schema: VariableDef[]): string {
  const clean: VariableValues = {};

  for (const variable of schema) {
    if (variable.key === DOCUMENT_NUMBER_VARIABLE) continue;
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
    .slice(-8)
    .map((message) => `${message.role === 'user' ? 'Usuario' : 'Asistente'}: ${truncate(message.content, 2_000)}`)
    .join('\n');
}

function buildSystemPrompt(): string {
  return [
    'Eres un redactor experto en documentos administrativos en español (Perú).',
    'Trabajas dentro de un editor de documentos: cada respuesta construye o corrige el documento completo.',
    'Escribes con un tono formal, claro y conciso, y no inventas datos verificables que no se te den.',
    '',
    'Devuelves SIEMPRE un único objeto JSON válido, sin markdown ni comentarios, con esta forma exacta:',
    '{"reply":"...","title":"...","description":"...","content":<documento TipTap>,"data":{...},"questions":["..."],"warnings":["..."]}',
    '',
    'Reglas de "content":',
    '- Es un documento TipTap completo: {"type":"doc","content":[...]}.',
    '- Nodos permitidos: paragraph, heading (nivel 1-3), bulletList, orderedList, listItem, blockquote, horizontalRule, hardBreak, table, tableRow, tableCell, tableHeader.',
    '- Marcas permitidas: bold, italic, underline, strike, code, highlight, superscript, subscript.',
    '- No incluyas imágenes, HTML, enlaces, atributos de estilo ni nodos desconocidos.',
    '- Conserva los marcadores {{clave}} de las variables que no sean el cuerpo redactable.',
    '- No escribas el número correlativo: el sistema lo asigna al aprobar. Deja {{numero_documento}} o {{numero}} si la plantilla lo usa.',
    '- Mantén la estructura fija de la plantilla (tablas de destinatario, firmas, etc.) salvo que la instrucción pida cambiarla.',
    '- Si el documento actual ya tiene contenido, parte de él y aplícale los cambios; no vuelvas a insertar marcadores que ya se hayan integrado.',
    '',
    'Reglas de "data":',
    '- Incluye valores para las variables del esquema que puedas deducir o redactar.',
    '- Respeta el tipo: fechas ISO (AAAA-MM-DD), números sin símbolos, tablas como arrays de objetos.',
    '- No incluyas la clave reservada del número de documento.',
    '- Para el campo marcado como cuerpo redactable, deja un resumen en texto plano o vacío: la prosa rica va en "content".',
    '',
    'Reglas de conversación:',
    '- "reply" es una respuesta breve (1-3 frases) en español que explica qué has cambiado y qué has asumido.',
    '- Si falta un dato importante, añádelo a "questions" pero entrega igualmente una propuesta completa.',
    '- Usa "warnings" para avisar de suposiciones, campos vacíos o partes que conviene revisar.',
    '- Devuelve el documento COMPLETO en cada turno, no un fragmento ni un parche.',
  ].join('\n');
}

function buildUserPrompt(input: DraftInput): string {
  const { template, current, messages, examples } = input;
  const bodySlot = resolveBodyVariable(template.schema);

  const schemaLines = template.schema.length
    ? template.schema.map(describeVariable).join('\n')
    : '(La plantilla no define variables; redacta el contenido directamente.)';

  const bodySlotRule = bodySlot
    ? [
        `El campo "${bodySlot.key}" está marcado como cuerpo redactable.`,
        `Sustituye el bloque que contiene {{${bodySlot.key}}} por varios bloques TipTap (párrafos, listas o tablas).`,
        `No dejes el marcador {{${bodySlot.key}}} en "content".`,
        `Si el documento actual ya no contiene {{${bodySlot.key}}}, el cuerpo ya está integrado: no lo vuelvas a insertar.`,
      ].join(' ')
    : 'No hay un campo marcado como cuerpo redactable: conserva la estructura y redacta dentro de los bloques existentes.';

  return [
    `Plantilla: ${template.name}`,
    `Tipo de documento: ${template.docType}`,
    template.aiInstructions ? `Instrucciones de la plantilla:\n"""${template.aiInstructions}"""` : '',
    `Perfil de estilo:\n"""${template.aiStyle?.trim() || DEFAULT_STYLE}"""`,
    examples?.length
      ? `Ejemplos de estilo de documentos aprobados (imita el tono, no el contenido):\n"""${examples.join('\n---\n')}"""`
      : '',
    `Esquema de variables:\n${schemaLines}`,
    bodySlotRule,
    documentForPrompt(template.body, 'Cuerpo base de la plantilla'),
    documentForPrompt(current.content, 'Documento actual'),
    `Datos actuales:\n${dataForPrompt(current.data, template.schema)}`,
    `Título actual: ${current.title || '(sin título)'}`,
    `Descripción actual: ${current.description || '(sin descripción)'}`,
    `Conversación hasta ahora:\n${conversationForPrompt(messages)}`,
    'Genera la siguiente versión completa del documento siguiendo la última instrucción del usuario.',
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

  let content = sanitizeAiContent(rawDocument.content ?? parsed.content ?? current.content);

  const title =
    typeof rawDocument.title === 'string' && rawDocument.title.trim()
      ? truncate(rawDocument.title.trim(), 240)
      : current.title || template.name;

  const description =
    typeof rawDocument.description === 'string'
      ? truncate(rawDocument.description.trim(), 500)
      : current.description;

  const incoming =
    rawDocument.data && typeof rawDocument.data === 'object' && !Array.isArray(rawDocument.data)
      ? (rawDocument.data as Record<string, unknown>)
      : {};

  const data: VariableValues = { ...current.data };
  const bodySlot = resolveBodyVariable(template.schema);

  for (const variable of template.schema) {
    if (variable.key === DOCUMENT_NUMBER_VARIABLE) continue;
    if (!(variable.key in incoming)) continue;

    if (variable.bodySlot) {
      // La prosa del cuerpo vive en `content`; guardamos solo un resumen.
      const value = incoming[variable.key];
      if (typeof value === 'string' && value.trim()) {
        data[variable.key] = truncate(value.trim(), 20_000);
      }
      continue;
    }

    const value = coerce(variable, incoming[variable.key]);
    if (!isEmpty(value)) data[variable.key] = value;
  }

  delete data[DOCUMENT_NUMBER_VARIABLE];

  // Fallback: si el modelo dejó el marcador del cuerpo, se rellena con el
  // texto que haya devuelto en `data` para no perder la redacción.
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
  } else if (bodySlot && !contentHasVariable(content, bodySlot.key)) {
    // El cuerpo ya está integrado en la hoja: conservamos un texto plano para
    // búsquedas y para el panel de datos.
    data[bodySlot.key] = truncate(plainTextFromContent(content), 20_000);
  }

  // Avisos por variables obligatorias que siguen vacías.
  for (const variable of template.schema) {
    if (!variable.required || variable.key === DOCUMENT_NUMBER_VARIABLE) continue;
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
export async function draftDocument(config: AiConfig, input: DraftInput): Promise<AiDraftResult> {
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
      // Un documento completo necesita más espacio de salida que un
      // formulario; se respeta el máximo del administrador si ya es mayor.
      maxTokens: Math.min(Math.max(config.maxTokens, 6_000), 16_000),
      temperature: Math.min(Math.max(config.temperature, 0.2), 0.7),
    },
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(input) },
    ],
    true,
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
