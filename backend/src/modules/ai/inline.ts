import { sanitizeAiContent } from '@sirpefoffice/shared';
import type { AiInlineContext, AiInlineResult, JSONContent } from '@sirpefoffice/shared';

import { chat, type AiConfig } from './providers.js';
import { extractJsonObject } from './values.js';

export interface InlineInput {
  instruction: string;
  context: AiInlineContext;
}

function truncate(value: string, max: number): string {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => truncate(item, 500))
    .slice(0, max);
}

function buildSystemPrompt(): string {
  return [
    'Eres un redactor experto en documentos administrativos en español (Perú).',
    'Trabajas sobre un documento que ya existe. El usuario te pide un fragmento concreto,',
    'no una reescritura completa del documento.',
    '',
    'Devuelves SIEMPRE un único objeto JSON válido, sin markdown ni comentarios:',
    '{"reply":"...","content":{"type":"doc","content":[...]},"questions":[],"warnings":[]}',
    '',
    'Reglas de "content":',
    '- Contiene SOLO el fragmento solicitado, listo para insertar o reemplazar.',
    '- Puede usar párrafos, títulos, listas, citas y tablas si la instrucción lo pide.',
    '- No repitas la cabecera, el pie ni el resto del documento.',
    '- No inventes datos verificables; si falta un dato, deja un hueco o pregunta.',
    '- Mantén un tono formal, claro y conciso.',
    '- Si la instrucción pide mejorar, resumir, traducir o cambiar el tono, devuelve la',
    '  versión transformada de la selección, no un comentario sobre ella.',
    '- Si la instrucción pide continuar o insertar, devuelve un fragmento coherente con el',
    '  texto anterior y posterior.',
    '',
    'Reglas de "reply": una o dos frases en español que expliquen qué has redactado.',
    'Usa "questions" para datos imprescindibles y "warnings" para suposiciones.',
  ].join('\n');
}

function quote(value: string | undefined): string {
  return value && value.trim() ? `"""${truncate(value, 6_000)}"""` : '(sin texto)';
}

function buildUserPrompt(input: InlineInput): string {
  const { context, instruction } = input;
  return [
    `Tipo de documento: ${context.docType ?? 'documento administrativo'}`,
    context.templateName ? `Plantilla: ${context.templateName}` : '',
    context.title ? `Título actual: ${context.title}` : '',
    `Selección actual: ${quote(context.selection)}`,
    `Texto anterior: ${quote(context.before)}`,
    `Texto posterior: ${quote(context.after)}`,
    `Instrucción del usuario: """${truncate(instruction, 4_000)}"""`,
    'Devuelve el fragmento que corresponde a la instrucción.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function paragraphsFromText(text: string): JSONContent {
  const parts = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    type: 'doc',
    content: parts.slice(0, 40).map((part) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: part.slice(0, 8_000) }],
    })),
  };
}

function contentFrom(raw: unknown): JSONContent {
  if (typeof raw === 'string') return sanitizeAiContent(paragraphsFromText(raw));
  return sanitizeAiContent(raw);
}

/** Genera un fragmento inline y lo devuelve ya saneado. */
export async function inlineText(config: AiConfig, input: InlineInput): Promise<AiInlineResult> {
  const raw = await chat(
    { ...config, maxTokens: Math.min(config.maxTokens, 1_500) },
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(input) },
    ],
    true,
  );

  const parsed = extractJsonObject(raw, 'AI_INLINE_INVALID_JSON');
  const content = contentFrom(parsed.content ?? raw);
  const reply =
    typeof parsed.reply === 'string' && parsed.reply.trim()
      ? truncate(parsed.reply, 800)
      : 'He preparado el fragmento. Revísalo antes de insertarlo.';

  return {
    reply,
    content,
    questions: stringArray(parsed.questions, 6),
    warnings: stringArray(parsed.warnings, 6),
    model: config.model,
  };
}
