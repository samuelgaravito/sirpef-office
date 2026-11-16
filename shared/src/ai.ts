/**
 * Contrato compartido del asistente de redacción.
 *
 * El asistente es **sin estado en el servidor**: el cliente envía el historial
 * de la conversación y el estado actual del documento en cada turno. Así la
 * conexión con el proveedor (OpenAI, Anthropic, Gemini u Ollama) queda
 * desacoplada y no hace falta una tabla de conversaciones para empezar.
 */

import type { DocType, JSONContent, VariableDef, VariableValues } from './types.js';

/** Límites que comparten la validación del servidor y la interfaz. */
export const AI_DRAFT_MAX_MESSAGES = 24;
export const AI_DRAFT_MAX_MESSAGE_CHARS = 8_000;
export const AI_DRAFT_MAX_NODES = 3_000;
export const AI_DRAFT_MAX_DEPTH = 14;
export const AI_DRAFT_MAX_TEXT_CHARS = 120_000;

export interface AiDraftMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Estado del documento que el asistente usa como punto de partida. */
export interface AiDraftCurrent {
  title?: string;
  description?: string;
  content?: JSONContent;
  data?: VariableValues;
}

export interface AiDraftDocument {
  title: string;
  description: string;
  content: JSONContent;
  data: VariableValues;
}

export interface AiDraftResult {
  /** Respuesta breve para el chat, en español. */
  reply: string;
  document: AiDraftDocument;
  /** Preguntas opcionales cuando falta un dato importante. */
  questions: string[];
  /** Avisos sobre suposiciones o campos incompletos. */
  warnings: string[];
  /** Modelo que generó la propuesta (para mostrarlo en la interfaz). */
  model: string;
}

/** Elección de plantilla a partir de un encargo escrito en lenguaje natural. */
export interface AiTemplateChoice {
  templateId: string;
  templateName: string;
  docType: DocType;
  /** Explicación breve, en español, de por qué encaja esa plantilla. */
  reason: string;
  /** Origen de la elección: única plantilla, el modelo o la heurística. */
  source: 'unica' | 'ia' | 'heuristica';
}

/* ────────────────────── Saneado del contenido TipTap ─────────────────── */

const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',
  'hardBreak',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
]);

const ALLOWED_MARKS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'highlight',
  'superscript',
  'subscript',
]);

/** Atributos permitidos por nodo: evita que el modelo cuele estilos o URLs. */
const ALLOWED_ATTRS: Record<string, string[]> = {
  heading: ['level', 'textAlign'],
  paragraph: ['textAlign'],
  orderedList: ['start', 'type'],
  tableCell: ['colspan', 'rowspan'],
  tableHeader: ['colspan', 'rowspan'],
};

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

interface SanitizeState {
  nodes: number;
  chars: number;
}

function safeText(value: unknown, state: SanitizeState): string {
  if (typeof value !== 'string') return '';
  const remaining = AI_DRAFT_MAX_TEXT_CHARS - state.chars;
  if (remaining <= 0) return '';
  const text = value.slice(0, remaining);
  state.chars += text.length;
  return text;
}

function sanitizeAttrs(type: string, attrs: unknown): Record<string, unknown> | undefined {
  const allowed = ALLOWED_ATTRS[type];
  if (!allowed || !attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return undefined;

  const clean: Record<string, unknown> = {};
  const source = attrs as Record<string, unknown>;

  for (const key of allowed) {
    const value = source[key];
    if (value === undefined || value === null) continue;

    if (key === 'level') {
      const level = Number(value);
      if (Number.isInteger(level) && level >= 1 && level <= 3) clean.level = level;
      continue;
    }
    if (key === 'textAlign') {
      if (typeof value === 'string' && ALIGNMENTS.has(value)) clean.textAlign = value;
      continue;
    }
    if (key === 'start') {
      const start = Number(value);
      if (Number.isInteger(start) && start >= 1 && start <= 10_000) clean.start = start;
      continue;
    }
    if (key === 'colspan' || key === 'rowspan') {
      const span = Number(value);
      if (Number.isInteger(span) && span >= 1 && span <= 20) clean[key] = span;
      continue;
    }
    if (key === 'type' && typeof value === 'string' && value.length <= 20) {
      clean.type = value;
    }
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

function sanitizeMarks(marks: unknown): JSONContent['marks'] | undefined {
  if (!Array.isArray(marks)) return undefined;

  const clean: NonNullable<JSONContent['marks']> = [];
  for (const mark of marks) {
    if (!mark || typeof mark !== 'object') continue;
    const type = (mark as { type?: unknown }).type;
    if (typeof type !== 'string' || !ALLOWED_MARKS.has(type)) continue;
    clean.push({ type });
  }
  return clean.length > 0 ? clean : undefined;
}

function sanitizeNode(raw: unknown, depth: number, state: SanitizeState): JSONContent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (depth > AI_DRAFT_MAX_DEPTH || state.nodes >= AI_DRAFT_MAX_NODES) return null;

  const node = raw as JSONContent;
  const type = typeof node.type === 'string' ? node.type : '';

  // Nodo de texto: sin hijos y con `text` obligatorio.
  if (type === 'text') {
    const text = safeText(node.text, state);
    if (!text) return null;
    state.nodes += 1;
    const marks = sanitizeMarks(node.marks);
    return {
      type: 'text',
      text,
      ...(marks ? { marks } : {}),
    };
  }

  if (!ALLOWED_NODES.has(type)) {
    // Un nodo desconocido no se cuela: su texto se conserva como párrafo.
    const text = safeText(node.text, state);
    if (!text) return null;
    state.nodes += 1;
    return { type: 'paragraph', content: [{ type: 'text', text }] };
  }

  state.nodes += 1;
  const content: JSONContent[] = [];

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const clean = sanitizeNode(child, depth + 1, state);
      if (clean) content.push(clean);
      if (state.nodes >= AI_DRAFT_MAX_NODES) break;
    }
  }

  const attrs = sanitizeAttrs(type, node.attrs);

  return {
    type,
    ...(attrs ? { attrs } : {}),
    ...(content.length > 0 || type === 'paragraph' ? { content } : {}),
  };
}

/**
 * Normaliza la respuesta del modelo a un documento TipTap seguro.
 *
 * - Solo admite los nodos y marcas que el editor sabe renderizar.
 * - Recorta profundidad, número de nodos y longitud del texto.
 * - Si no queda nada utilizable, devuelve un párrafo vacío.
 */
export function sanitizeAiContent(raw: unknown): JSONContent {
  let value = raw;

  if (typeof value === 'string') {
    const text = value;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: text.slice(0, AI_DRAFT_MAX_TEXT_CHARS) }],
          },
        ],
      };
    }
  }

  if (Array.isArray(value)) value = { type: 'doc', content: value };

  const state: SanitizeState = { nodes: 0, chars: 0 };
  const clean = sanitizeNode(value, 0, state);

  if (!clean) return { type: 'doc', content: [{ type: 'paragraph' }] };
  if (clean.type === 'doc') {
    return {
      type: 'doc',
      content: clean.content && clean.content.length > 0 ? clean.content : [{ type: 'paragraph' }],
    };
  }

  return { type: 'doc', content: [clean] };
}

/** Texto plano de un documento TipTap, útil para avisos y ejemplos de estilo. */
export function plainTextFromContent(content: JSONContent): string {
  const parts: string[] = [];

  const walk = (node: JSONContent): void => {
    if (node.type === 'text') {
      parts.push(node.text ?? '');
    } else if (node.type === 'hardBreak') {
      parts.push('\n');
    }

    node.content?.forEach(walk);

    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') {
      parts.push('\n');
    } else if (node.type === 'tableCell' || node.type === 'tableHeader') {
      parts.push(' | ');
    } else if (node.type === 'tableRow') {
      parts.push('\n');
    }
  };

  walk(content);

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resuelve qué campo hace de **cuerpo redactable**.
 *
 * Prioriza la marca explícita (`bodySlot`). Si la plantilla es anterior a esa
 * marca, usa el campo de texto largo llamado `cuerpo`/`body`/`contenido` o, si
 * solo hay uno, ese único texto largo. Así las plantillas ya existentes
 * funcionan sin migrar sus datos.
 */
export function resolveBodyVariable(schema: VariableDef[]): VariableDef | undefined {
  const explicit = schema.find((variable) => variable.bodySlot);
  if (explicit) return explicit;

  const named = schema.find(
    (variable) =>
      variable.type === 'longtext' &&
      ['cuerpo', 'body', 'contenido', 'content'].includes(variable.key.toLowerCase()),
  );
  if (named) return named;

  const longtexts = schema.filter((variable) => variable.type === 'longtext');
  return longtexts.length === 1 ? longtexts[0] : undefined;
}

/** ¿El documento conserva el marcador `{{clave}}` de una variable? */
export function contentHasVariable(content: JSONContent, key: string): boolean {
  const pattern = new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`);
  let found = false;

  const walk = (node: JSONContent): void => {
    if (found) return;
    if (node.text && pattern.test(node.text)) {
      found = true;
      return;
    }
    node.content?.forEach(walk);
  };

  walk(content);
  return found;
}
