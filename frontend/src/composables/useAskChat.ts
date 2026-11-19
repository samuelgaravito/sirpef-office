import { computed, ref } from 'vue';

import { api } from '@/api/client';
import { errorMessage } from '@/lib/error-message';
import type {
  AiAskFilters,
  AiAskPlan,
  AiAskResult,
  AiConversation,
  SavedChart,
} from '@sirpefoffice/shared';

export interface AskChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  result?: AiAskResult;
  error?: string;
  createdAt?: string;
}

type AskResponse = AiAskResult & { conversationId: string };

interface AskRequest {
  question: string;
  plan?: AiAskPlan;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Conversación del modo consulta.
 *
 * El historial vive en el servidor: aquí solo se mantiene el hilo visible.
 * Los chips y las barras reenvían el plan ya resuelto, sin llamar al modelo.
 */
export function useAskChat() {
  const messages = ref<AskChatMessage[]>([]);
  const sending = ref(false);
  const loading = ref(false);
  const conversationId = ref<string | null>(null);
  const title = ref('');
  const hasMore = ref(false);
  const lastRequest = ref<AskRequest | null>(null);

  const hasThread = computed(() => messages.value.length > 0);

  function reset(): void {
    messages.value = [];
    conversationId.value = null;
    title.value = '';
    hasMore.value = false;
    lastRequest.value = null;
  }

  /** Carga una conversación y reconstruye sus respuestas con permisos actuales. */
  async function open(id: string): Promise<void> {
    loading.value = true;
    lastRequest.value = null;
    try {
      const data = await api.get<AiConversation>(`/ai/conversations/${id}`);
      conversationId.value = data.id;
      title.value = data.title;
      hasMore.value = data.hasMore;
      messages.value = data.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        ...(message.result ? { result: message.result } : {}),
      }));
    } catch (error) {
      reset();
      messages.value = [
        {
          id: newId(),
          role: 'assistant',
          text: errorMessage(error, 'No se pudo abrir la conversación'),
          error: 'load',
        },
      ];
    } finally {
      loading.value = false;
    }
  }

  /** Trae los mensajes anteriores de la conversación abierta. */
  async function loadOlder(): Promise<void> {
    const id = conversationId.value;
    const first = messages.value[0];
    if (!id || !hasMore.value || !first?.createdAt || loading.value) return;

    loading.value = true;
    try {
      const data = await api.get<AiConversation>(
        `/ai/conversations/${id}?before=${encodeURIComponent(first.createdAt)}`,
      );
      const older = data.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        ...(message.result ? { result: message.result } : {}),
      }));
      messages.value = [...older, ...messages.value];
      hasMore.value = data.hasMore;
    } finally {
      loading.value = false;
    }
  }

  async function run(
    question: string,
    plan: AiAskPlan | undefined,
    appendUser: boolean,
  ): Promise<AskResponse | null> {
    if (!question || sending.value) return null;

    if (appendUser) {
      messages.value.push({ id: newId(), role: 'user', text: question });
    }
    lastRequest.value = { question, ...(plan ? { plan } : {}) };
    sending.value = true;

    try {
      const result = await api.post<AskResponse>('/ai/ask', {
        question,
        ...(conversationId.value ? { conversationId: conversationId.value } : {}),
        ...(plan ? { plan } : {}),
      });
      conversationId.value = result.conversationId;
      if (!title.value) title.value = question.slice(0, 80);
      messages.value.push({
        id: newId(),
        role: 'assistant',
        text: result.answer,
        result,
      });
      return result;
    } catch (error) {
      messages.value.push({
        id: newId(),
        role: 'assistant',
        text: errorMessage(error, 'No se pudo consultar tus documentos'),
        error: 'ask',
      });
      return null;
    } finally {
      sending.value = false;
    }
  }

  async function send(
    input: string,
    options: { plan?: AiAskPlan } = {},
  ): Promise<AskResponse | null> {
    return run(input.trim(), options.plan, true);
  }

  /** Último plan aplicado, base para refinar sin volver al modelo. */
  function lastPlan(): AiAskPlan | null {
    for (let index = messages.value.length - 1; index >= 0; index -= 1) {
      const result = messages.value[index]?.result;
      if (result) return result.plan;
    }
    return null;
  }

  /** Aplica un cambio de filtros conservando métrica, dimensión y gráfico. */
  async function refine(patch: Partial<AiAskFilters>, label: string): Promise<void> {
    const base = lastPlan();
    if (!base) return;

    const plan: AiAskPlan = {
      ...base,
      filters: { ...base.filters, ...patch },
      limit: patch.limit ?? base.limit,
    };

    // «Ver esos documentos» cambia a lista, no a un conteo.
    if (patch.intent === 'list' || patch.intent === 'find') {
      plan.mode = patch.intent === 'find' ? 'search' : 'list';
      plan.dimensions = [];
      plan.chart = 'table';
      plan.limit = plan.filters.limit;
    }

    await send(label, { plan });
  }

  async function retry(): Promise<void> {
    const request = lastRequest.value;
    if (!request || sending.value) return;
    const last = messages.value[messages.value.length - 1];
    if (last?.role === 'assistant' && last.error) messages.value.pop();
    await run(request.question, request.plan, false);
  }

  /** Guarda un gráfico concreto (no necesariamente el último del hilo). */
  async function saveChart(plan: AiAskPlan, titleOverride?: string): Promise<SavedChart> {
    return api.post<SavedChart>('/stats/charts', {
      title: titleOverride?.trim() || 'Gráfico de consulta',
      plan,
    });
  }

  return {
    messages,
    sending,
    loading,
    conversationId,
    title,
    hasMore,
    hasThread,
    open,
    loadOlder,
    send,
    refine,
    retry,
    reset,
    saveChart,
    lastPlan,
  };
}
