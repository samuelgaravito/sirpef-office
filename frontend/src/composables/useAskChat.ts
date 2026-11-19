import { computed, ref } from 'vue';

import { api } from '@/api/client';
import { errorMessage } from '@/lib/error-message';
import type {
  AiAskFilters,
  AiAskHistoryMessage,
  AiAskResult,
} from '@sirpefoffice/shared';

/** El hilo vive en la pestaña: al volver de un documento sigue intacto. */
const STORAGE_KEY = 'sirpef.consulta.thread';

export interface AskChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  result?: AiAskResult;
  error?: string;
}

interface AskRequest {
  question: string;
  filters?: AiAskFilters;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function restore(): AskChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AskChatMessage =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as AskChatMessage).id === 'string' &&
        ((item as AskChatMessage).role === 'user' || (item as AskChatMessage).role === 'assistant') &&
        typeof (item as AskChatMessage).text === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Conversación del modo consulta.
 *
 * El servidor es sin estado: cada envío lleva los últimos turnos y, cuando el
 * usuario pulsa un chip o una barra, los filtros ya resueltos. Así el hilo se
 * puede retomar en la misma pestaña sin guardar nada en la base.
 */
export function useAskChat() {
  const messages = ref<AskChatMessage[]>(restore());
  const sending = ref(false);
  const lastRequest = ref<AskRequest | null>(null);

  const hasThread = computed(() => messages.value.length > 0);

  function persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.value));
    } catch {
      // La sesión puede estar llena o bloqueada; el hilo sigue en memoria.
    }
  }

  /** Turnos recientes para resolver referencias («¿y el mes pasado?»). */
  function historyOf(list: AskChatMessage[]): AiAskHistoryMessage[] {
    return list
      .filter((message) => !message.error)
      .slice(-4)
      .map((message) => ({
        role: message.role,
        content: message.role === 'assistant' ? (message.result?.answer ?? message.text) : message.text,
      }));
  }

  /**
   * Envía una pregunta.
   *
   * Sin `filters` la interpreta el modelo; con `filters` se aplica de forma
   * determinista (chips y barras) sin gastar una llamada al proveedor.
   */
  async function run(
    question: string,
    filters: AiAskFilters | undefined,
    appendUser: boolean,
  ): Promise<void> {
    if (!question || sending.value) return;

    // Un reintento no repite la burbuja: el turno del usuario ya está.
    const previous = appendUser ? messages.value : messages.value.slice(0, -1);
    const turns = historyOf(previous);
    lastRequest.value = { question, ...(filters ? { filters } : {}) };

    if (appendUser) messages.value.push({ id: newId(), role: 'user', text: question });
    sending.value = true;
    persist();

    try {
      const result = await api.post<AiAskResult>('/ai/ask', {
        question,
        history: turns,
        ...(filters ? { filters } : {}),
      });
      messages.value.push({
        id: newId(),
        role: 'assistant',
        text: result.answer,
        result,
      });
    } catch (error) {
      messages.value.push({
        id: newId(),
        role: 'assistant',
        text: errorMessage(error, 'No se pudo consultar tus documentos'),
        error: 'ask',
      });
    } finally {
      sending.value = false;
      persist();
    }
  }

  async function send(input: string, options: { filters?: AiAskFilters } = {}): Promise<void> {
    await run(input.trim(), options.filters, true);
  }

  /** Últimos filtros aplicados, base para refinar sin volver al modelo. */
  function lastFilters(): AiAskFilters | null {
    for (let index = messages.value.length - 1; index >= 0; index -= 1) {
      const result = messages.value[index]?.result;
      if (result) return result.applied;
    }
    return null;
  }

  /** Aplica un cambio de filtro sobre la última respuesta. */
  async function refine(patch: Partial<AiAskFilters>, label: string): Promise<void> {
    const base = lastFilters();
    if (!base) return;
    await send(label, { filters: { ...base, ...patch } });
  }

  /** Repite la última petición sin duplicar la burbuja del usuario. */
  async function retry(): Promise<void> {
    const request = lastRequest.value;
    if (!request || sending.value) return;
    const last = messages.value[messages.value.length - 1];
    if (last?.role === 'assistant' && last.error) messages.value.pop();
    await run(request.question, request.filters, false);
  }

  function reset(): void {
    messages.value = [];
    lastRequest.value = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Sin sesión disponible, basta con vaciar la memoria.
    }
  }

  return { messages, sending, hasThread, send, refine, retry, reset, lastFilters };
}
