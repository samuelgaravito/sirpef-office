import {
  DOC_TYPE_LABELS,
  type AiTemplateChoice,
  type DocType,
} from '@sirpefoffice/shared';

import { AppError } from '../../lib/errors.js';
import { chat, type AiConfig } from './providers.js';
import { extractJsonObject } from './values.js';

/** Datos mínimos de una plantilla para poder clasificarla. */
export interface TemplateCandidate {
  id: string;
  name: string;
  docType: DocType;
  description: string;
  aiInstructions: string | null;
  updatedAt: Date;
}

/** Tope de plantillas que se envían al modelo en una sola consulta. */
export const MAX_TEMPLATE_CANDIDATES = 40;

/** Palabras que delatan el tipo de documento aunque el nombre no lo diga. */
const DOC_TYPE_HINTS: Record<DocType, string[]> = {
  memorandum: ['memo', 'memorandum', 'memorando', 'comunicacion interna', 'aviso interno'],
  delivery_note: ['nota de entrega', 'entrega de equipos', 'constancia de entrega', 'cargo de entrega'],
  report: ['informe', 'reporte', 'report', 'resultados', 'balance de gestion'],
  meeting_minutes: ['acta', 'reunion', 'acuerdos', 'sesion', 'minuta'],
  evaluation_plan: ['plan de evaluacion', 'evaluacion', 'cronograma de evaluacion', 'indicadores'],
  resume: ['curriculum', 'cv', 'hoja de vida', 'experiencia laboral', 'perfil profesional'],
  letter: ['carta', 'oficio', 'solicitud', 'invitacion', 'comunicacion externa'],
  certificate: ['certificado', 'constancia', 'certificacion', 'acreditacion'],
  blank: ['documento libre', 'hoja en blanco', 'sin formato'],
};

const STOPWORDS = new Set([
  'a', 'al', 'algo', 'algun', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes', 'como',
  'con', 'contra', 'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'dos', 'el', 'ella', 'ellas',
  'ellos', 'en', 'entre', 'era', 'es', 'esa', 'ese', 'eso', 'esta', 'este', 'esto', 'estos', 'fue',
  'ha', 'hacer', 'hacia', 'hasta', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi',
  'mis', 'mucho', 'muy', 'necesito', 'no', 'nos', 'o', 'otra', 'otro', 'para', 'pero', 'poco', 'por',
  'porque', 'que', 'quiero', 'se', 'sea', 'ser', 'si', 'sin', 'sobre', 'su', 'sus', 'te', 'tiene',
  'todo', 'todos', 'tu', 'tus', 'un', 'una', 'unas', 'uno', 'unos', 'y', 'ya', 'yo',
]);

/** Minúsculas y sin tildes: «Memorándum» y «memorandum» deben coincidir. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9ñ]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Plantilla que se usa cuando no hay ninguna pista útil en el encargo. */
function mostRecent(candidates: TemplateCandidate[]): TemplateCandidate {
  return [...candidates].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]!;
}

/** Puntúa cada plantilla por tipo, nombre y descripción frente al encargo. */
function heuristicChoice(
  prompt: string,
  candidates: TemplateCandidate[],
): { candidate: TemplateCandidate; matched: boolean } {
  const text = normalize(prompt);
  const words = new Set(tokens(prompt));

  let best: TemplateCandidate | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    let score = 0;

    const typeLabel = normalize(DOC_TYPE_LABELS[candidate.docType] ?? '');
    if (typeLabel && text.includes(typeLabel)) score += 8;

    for (const hint of DOC_TYPE_HINTS[candidate.docType]) {
      if (hint.includes(' ') ? text.includes(hint) : words.has(hint)) score += 6;
    }

    const nameMatches = tokens(candidate.name).filter((token) => words.has(token)).length;
    score += Math.min(nameMatches, 4) * 3;

    const descriptionTokens = new Set(tokens(candidate.description ?? ''));
    const descriptionMatches = [...words].filter((word) => descriptionTokens.has(word)).length;
    score += Math.min(descriptionMatches, 5);

    // Con empate gana la plantilla actualizada más recientemente.
    if (
      score > bestScore ||
      (score === bestScore && score > 0 && best && candidate.updatedAt > best.updatedAt)
    ) {
      best = candidate;
      bestScore = score;
    }
  }

  return best
    ? { candidate: best, matched: true }
    : { candidate: mostRecent(candidates), matched: false };
}

function heuristicReason(candidate: TemplateCandidate, matched: boolean): string {
  if (!matched) {
    return `Es la plantilla activa más reciente; revísala antes de redactar.`;
  }
  const label = DOC_TYPE_LABELS[candidate.docType] ?? candidate.docType;
  return `El encargo encaja con el tipo «${label}» y el contenido de esta plantilla.`;
}

function buildSystemPrompt(): string {
  return [
    'Eres el clasificador de plantillas de SirpefOffice, un editor de documentos administrativos en español (Perú).',
    'Recibes un encargo del usuario y la lista de plantillas activas que puede usar.',
    'Eliges la plantilla que mejor sirva de molde para redactar ese documento.',
    'Devuelves SIEMPRE un único objeto JSON válido, sin markdown ni comentarios, con esta forma exacta:',
    '{"templateId":"<id exacto de la lista>","reason":"<frase breve en español>"}',
    '',
    'Reglas:',
    '- Usa exactamente uno de los identificadores de la lista; nunca inventes uno.',
    '- Prioriza el tipo de documento y el propósito descritos en el encargo.',
    '- Si varias encajan, elige la más específica; si ninguna destaca, la de uso más general.',
    '- "reason" explica la elección en una frase (máximo 20 palabras) y no repite el encargo.',
  ].join('\n');
}

function buildUserPrompt(prompt: string, candidates: TemplateCandidate[]): string {
  const list = candidates
    .map((candidate) => {
      const lines = [
        `- id: ${candidate.id}`,
        `  nombre: ${candidate.name}`,
        `  tipo: ${DOC_TYPE_LABELS[candidate.docType] ?? candidate.docType} (${candidate.docType})`,
      ];
      if (candidate.description.trim()) {
        lines.push(`  descripción: ${truncate(candidate.description.trim(), 240)}`);
      }
      if (candidate.aiInstructions?.trim()) {
        lines.push(`  instrucciones: ${truncate(candidate.aiInstructions.trim(), 240)}`);
      }
      return lines.join('\n');
    })
    .join('\n');

  return [
    `Encargo del usuario:\n"""${truncate(prompt.trim(), 2_000)}"""`,
    `Plantillas disponibles:\n${list}`,
  ].join('\n\n');
}

function toChoice(
  candidate: TemplateCandidate,
  reason: string,
  source: AiTemplateChoice['source'],
): AiTemplateChoice {
  return {
    templateId: candidate.id,
    templateName: candidate.name,
    docType: candidate.docType,
    reason: truncate(reason.trim(), 240),
    source,
  };
}

/**
 * Elige la plantilla que mejor encaja con el encargo.
 *
 * Con una sola plantilla activa no se consulta al modelo. Si el proveedor está
 * apagado o devuelve un JSON inutilizable se usa un empate por palabras clave:
 * el usuario siempre llega al editor con una plantilla razonable.
 */
export async function chooseTemplate(
  config: AiConfig,
  prompt: string,
  candidates: TemplateCandidate[],
): Promise<AiTemplateChoice> {
  if (candidates.length === 0) {
    throw new AppError(
      400,
      'AI_NO_TEMPLATES',
      'No hay plantillas activas para redactar. Crea una en Plantillas o pide a un administrador que active alguna.',
    );
  }

  if (candidates.length === 1) {
    const only = candidates[0]!;
    return toChoice(only, 'Es la única plantilla activa disponible.', 'unica');
  }

  const ready =
    config.provider !== 'none' && (config.provider === 'ollama' || config.apiKey.length > 0);

  if (!ready) {
    const { candidate, matched } = heuristicChoice(prompt, candidates);
    return toChoice(candidate, heuristicReason(candidate, matched), 'heuristica');
  }

  try {
    const raw = await chat(
      { ...config, temperature: 0.1, maxTokens: Math.min(Math.max(config.maxTokens, 400), 800) },
      [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(prompt, candidates) },
      ],
      true,
    );

    const parsed = extractJsonObject(raw);
    const id = typeof parsed.templateId === 'string' ? parsed.templateId.trim() : '';
    const candidate = candidates.find((item) => item.id === id);

    if (candidate) {
      const reason =
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason
          : heuristicReason(candidate, true);
      return toChoice(candidate, reason, 'ia');
    }
  } catch (error) {
    // Un JSON roto o una respuesta vacía no deben bloquear la creación: se
    // resuelve con la heurística. Los fallos de red sí se propagan.
    const recoverable =
      error instanceof AppError && (error.code === 'AI_INVALID_JSON' || error.code === 'AI_EMPTY');
    if (!recoverable) throw error;
  }

  const { candidate, matched } = heuristicChoice(prompt, candidates);
  return toChoice(candidate, heuristicReason(candidate, matched), 'heuristica');
}
