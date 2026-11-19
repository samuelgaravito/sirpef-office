/**
 * Contrato compartido del asistente de redacción.
 *
 * El asistente es **sin estado en el servidor**: el cliente envía el historial
 * de la conversación y el estado actual del documento en cada turno. Así la
 * conexión con el proveedor (OpenAI, Anthropic, Gemini u Ollama) queda
 * desacoplada y no hace falta una tabla de conversaciones para empezar.
 */

import type {
  DocType,
  DocumentStatus,
  JSONContent,
  StatsPanel,
  VariableDef,
  VariableValues,
} from './types.js';

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

/** Límites del asistente inline de la barra inferior. */
export const AI_INLINE_MAX_INSTRUCTION_CHARS = 4_000;
export const AI_INLINE_MAX_CONTEXT_CHARS = 12_000;

/** Contexto que acompaña a una instrucción inline. */
export interface AiInlineContext {
  selection?: string;
  before?: string;
  after?: string;
  docType?: DocType;
  title?: string;
  templateName?: string;
}

/** Petición de un fragmento de texto para insertar o reemplazar. */
export interface AiInlineRequest {
  documentId?: string;
  templateId?: string;
  instruction: string;
  mode?: 'insert' | 'replace';
  context?: AiInlineContext;
}

/** Respuesta del asistente inline. */
export interface AiInlineResult {
  reply: string;
  content: JSONContent;
  warnings: string[];
  questions: string[];
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
 * Coloca cada nodo donde el esquema de TipTap lo admite.
 *
 * El modelo a veces anida un bloque (una tabla, una lista, otro párrafo)
 * dentro de un párrafo. `sanitizeNode` no lo detecta —todos los tipos son
 * permitidos— pero `setContent` lanzaba «Invalid content for node type
 * paragraph» y la hoja se quedaba con la plantilla sin aplicar. Aquí los
 * bloques mal anidados suben al nivel de su padre en vez de perderse.
 */
function normalizeStructure(nodes: JSONContent[]): JSONContent[] {
  const isInline = (node: JSONContent): boolean =>
    node.type === 'text' || node.type === 'hardBreak';

  /** Envuelve texto suelto en párrafos: celdas, citas y elementos de lista. */
  const requireBlock = (children: JSONContent[]): JSONContent[] => {
    const blocks: JSONContent[] = [];
    let inline: JSONContent[] = [];

    for (const child of children) {
      if (isInline(child)) {
        inline.push(child);
        continue;
      }
      if (inline.length > 0) {
        blocks.push({ type: 'paragraph', content: inline });
        inline = [];
      }
      blocks.push(child);
    }
    if (inline.length > 0) blocks.push({ type: 'paragraph', content: inline });
    if (blocks.length === 0) blocks.push({ type: 'paragraph' });
    return blocks;
  };

  const out: JSONContent[] = [];

  for (const node of nodes) {
    const children = normalizeStructure(node.content ?? []);

    switch (node.type) {
      case 'paragraph':
      case 'heading': {
        // Solo texto y saltos dentro; lo demás sube detrás del párrafo.
        out.push({ ...node, content: children.filter(isInline) });
        out.push(...children.filter((child) => !isInline(child)));
        continue;
      }
      case 'table':
        out.push({ ...node, content: children.filter((child) => child.type === 'tableRow') });
        continue;
      case 'tableRow':
        out.push({
          ...node,
          content: children.filter(
            (child) => child.type === 'tableCell' || child.type === 'tableHeader',
          ),
        });
        continue;
      case 'bulletList':
      case 'orderedList':
        out.push({ ...node, content: children.filter((child) => child.type === 'listItem') });
        continue;
      case 'listItem':
      case 'tableCell':
      case 'tableHeader':
      case 'blockquote':
        out.push({ ...node, content: requireBlock(children) });
        continue;
      default:
        out.push(children.length > 0 ? { ...node, content: children } : { ...node });
    }
  }

  return out;
}

/**
 * Normaliza la respuesta del modelo a un documento TipTap seguro.
 *
 * - Solo admite los nodos y marcas que el editor sabe renderizar.
 * - Recorta profundidad, número de nodos y longitud del texto.
 * - Reubica los bloques mal anidados (el editor rechaza un `table` dentro de
 *   un `paragraph`).
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

  const body = clean.type === 'doc' ? (clean.content ?? []) : [clean];
  const content = normalizeStructure(body);
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
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

/* ───────────────────────── Modo consulta (A8.6) ───────────────────────── */

/** Turno previo de la conversación, para resolver seguimientos. */
export interface AiAskHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Filtros que el modelo extrae de una pregunta en lenguaje natural.
 *
 * El modelo **no escribe SQL**: solo rellena estos campos. La consulta la
 * ejecuta el servidor con las mismas reglas de visibilidad que el listado, y
 * las cifras de la respuesta salen de la base, nunca del texto del modelo.
 */
export interface AiAskFilters {
  intent: 'count' | 'list' | 'find';
  /** Agrupación del conteo; `none` devuelve un total. */
  groupBy: 'none' | 'docType' | 'status';
  scope: 'mine' | 'all';
  docTypes: DocType[];
  statuses: DocumentStatus[];
  /** Nombre de la plantilla, si la pregunta la menciona. */
  templateName: string;
  /** Persona a la que va dirigido el documento. */
  recipient: string;
  /** Texto libre para buscar en título, descripción y datos. */
  text: string;
  /** Rango de fechas en ISO (`AAAA-MM-DD`); vacío = sin límite. */
  from: string;
  to: string;
  /** Campo de fecha al que se aplica el rango: «hice» es creado. */
  dateField: 'created' | 'updated';
  /** Documentos que el usuario aprobó como revisor. */
  approvedByMe: boolean;
  limit: number;
}

/** Un grupo del conteo (por tipo o por estado). */
export interface AiAskGroup {
  key: string;
  label: string;
  count: number;
}

/* ───────────────────── Plan analítico (A8.6) ───────────────────── */

export const AI_ASK_MODES = ['count', 'list', 'search', 'aggregate', 'compare', 'clarify'] as const;
export type AiAskMode = (typeof AI_ASK_MODES)[number];

export const AI_ASK_METRICS = ['count', 'approval_hours', 'approval_rate'] as const;
export type AiAskMetric = (typeof AI_ASK_METRICS)[number];

export const AI_ASK_DIMENSIONS = [
  'docType',
  'status',
  'template',
  'recipient',
  'month',
  'week',
  'owner',
] as const;
export type AiAskDimension = (typeof AI_ASK_DIMENSIONS)[number];

export const AI_CHART_KINDS = ['kpi', 'bar', 'line', 'donut', 'comparison', 'table'] as const;
export type AiChartKind = (typeof AI_CHART_KINDS)[number];

export const AI_COMPARE_PRESETS = ['previous_period', 'previous_month', 'previous_year'] as const;
export type AiComparePreset = (typeof AI_COMPARE_PRESETS)[number];

export type AiTimeBucket = 'day' | 'week' | 'month';

/**
 * Plan que produce el modelo para responder una consulta.
 *
 * Sigue sin escribir SQL: elige **qué** contar (métrica), **cómo** agrupar
 * (dimensión) y **qué gráfico** quiere. El servidor valida la combinación y
 * construye la consulta con los permisos del usuario.
 */
export interface AiAskPlan {
  mode: AiAskMode;
  filters: AiAskFilters;
  metrics: AiAskMetric[];
  dimensions: AiAskDimension[];
  bucket: AiTimeBucket | null;
  compare: AiComparePreset | null;
  chart: AiChartKind;
  sort: { by: 'value' | 'label'; dir: 'asc' | 'desc' };
  limit: number;
  clarification: { question: string; options: string[] } | null;
}

/** Gráfico ya materializado por el servidor: el cliente solo lo pinta. */
export interface AiChart {
  kind: AiChartKind;
  title: string;
  unit: 'documents' | 'hours' | 'percent';
  categories: string[];
  /** Claves internas alineadas con `categories` (para refinar sin ambigüedad). */
  keys?: string[];
  series: { label: string; values: number[] }[];
}


/** Documento devuelto por el modo consulta. */
export interface AiAskRow {
  id: string;
  title: string;
  docType: DocType;
  status: DocumentStatus;
  docNumber: string | null;
  updatedAt: string;
}

export interface AiAskResult {
  /** Respuesta en español, construida a partir del resultado real. */
  answer: string;
  /** Filtros aplicados, en lenguaje legible. */
  filters: string;
  /** Filtros validados, para pintar chips y poder refinarlos sin el modelo. */
  applied: AiAskFilters;
  /** Plan completo, base para repetir la respuesta sin llamar al modelo. */
  plan: AiAskPlan;
  /** `dashboard` cuando la pregunta pide cifras; `list` cuando pide documentos. */
  view: 'list' | 'dashboard';
  total: number;
  groups: AiAskGroup[];
  results: AiAskRow[];
  /** Panel estadístico del conjunto filtrado; `null` en las listas. */
  dashboard: StatsPanel | null;
  /** Gráfico elegido por el plan y rellenado por el servidor. */
  chart: AiChart | null;
  /** Lecturas cortas y deterministas del resultado. */
  insights: string[];
  /** Pregunta de aclaración cuando el plan no es concluyente. */
  clarification: { question: string; options: string[] } | null;
  /** Preguntas cortas para continuar la conversación. */
  suggestions: string[];
}

/* ─────────────────── Conversaciones e informes ─────────────────── */

export interface AiConversationSummary {
  id: string;
  title: string;
  /** Última pregunta o respuesta, recortada para la lista. */
  preview: string;
  messageCount: number;
  updatedAt: string;
}

export interface AiConversationsPage {
  items: AiConversationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AiConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Respuesta reconstruida con los permisos actuales; `null` en preguntas. */
  result: AiAskResult | null;
  createdAt: string;
}

export interface AiConversation {
  id: string;
  title: string;
  messages: AiConversationMessage[];
  hasMore: boolean;
  updatedAt: string;
}

/** Gráfico guardado: se almacena el plan, no las cifras. */
export interface SavedChart {
  id: string;
  title: string;
  plan: AiAskPlan;
  position: number;
  createdAt: string;
  updatedAt: string;
}
