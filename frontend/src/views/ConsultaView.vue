<script setup lang="ts">
import {
  ArrowLeft,
  ArrowUp,
  ExternalLink,
  Loader2,
  PanelLeftOpen,
  RotateCcw,
  Sparkles,
} from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import AskAnswer from '@/components/consult/AskAnswer.vue';
import ConversationList from '@/components/consult/ConversationList.vue';
import TypingDots from '@/components/consult/TypingDots.vue';
import { useAiStatus } from '@/composables/useAiStatus';
import { useAskChat } from '@/composables/useAskChat';
import { useToast } from '@/composables/useToast';
import type { AiAskFilters, AiAskPlan } from '@sirpefoffice/shared';

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { status: aiStatus, load: loadAiStatus } = useAiStatus();
const {
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
} = useAskChat();

const text = ref('');
const thread = ref<HTMLElement | null>(null);
const field = ref<HTMLTextAreaElement | null>(null);
const inputId = 'consulta-prompt';
const sidebarOpen = ref(false);
const refreshKey = ref(0);

const configured = computed(() => aiStatus.value?.configured === true);
const canSend = computed(() => configured.value && !sending.value && text.value.trim().length >= 3);

const routeId = computed(() =>
  typeof route.params.id === 'string' ? route.params.id : null,
);

const headerTitle = computed(() => title.value || 'Consulta');

const examples = [
  '¿Cuáles son mis últimos 5 documentos?',
  '¿Cuántos documentos por tipo hice este mes?',
  'Evolución mensual de certificados',
  'Tiempo medio de aprobación por plantilla',
];

const newTabHref = computed(() => router.resolve({ name: 'consulta' }).href);

function scrollToBottom(): void {
  void nextTick(() => {
    const element = thread.value;
    if (element) element.scrollTop = element.scrollHeight;
  });
}

watch(messages, scrollToBottom, { deep: true });
watch(sending, scrollToBottom);

function resize(): void {
  const element = field.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
}

/** Envía y sincroniza la URL con la conversación creada por el servidor. */
async function ask(question: string): Promise<void> {
  const result = await send(question);
  if (result?.conversationId && routeId.value !== result.conversationId) {
    await router.replace({ name: 'consulta-chat', params: { id: result.conversationId } });
  }
  refreshKey.value += 1;
  scrollToBottom();
}

function submit(): void {
  const question = text.value.trim();
  if (!canSend.value || !question) return;
  text.value = '';
  resize();
  void ask(question);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}

function useExample(example: string): void {
  if (!configured.value) return;
  text.value = example;
  void nextTick(() => {
    resize();
    submit();
  });
}

function onRefine(patch: Partial<AiAskFilters>, label: string): void {
  void refine(patch, label).then(() => {
    refreshKey.value += 1;
    scrollToBottom();
  });
}

function onRetry(): void {
  void retry().then(() => {
    refreshKey.value += 1;
    scrollToBottom();
  });
}

function openDocument(id: string): void {
  void router.push({ name: 'document', params: { id } });
}

async function onSave(plan: AiAskPlan, chartTitle: string): Promise<void> {
  try {
    await saveChart(plan, chartTitle);
    toast.success('Gráfico guardado en Informes');
  } catch (error) {
    toast.failure(error, 'No se pudo guardar el gráfico');
  }
}

async function loadPrevious(): Promise<void> {
  const element = thread.value;
  const previousHeight = element?.scrollHeight ?? 0;
  await loadOlder();
  void nextTick(() => {
    if (!element) return;
    element.scrollTop += element.scrollHeight - previousHeight;
  });
}

function newConversation(): void {
  if (sending.value) return;
  sidebarOpen.value = false;
  if (routeId.value) void router.push({ name: 'consulta' });
  else reset();
  void nextTick(() => field.value?.focus({ preventScroll: true }));
}

function selectConversation(id: string): void {
  if (sending.value || id === conversationId.value) {
    sidebarOpen.value = false;
    return;
  }
  sidebarOpen.value = false;
  void router.push({ name: 'consulta-chat', params: { id } });
}

function onDeleted(id: string): void {
  if (id === conversationId.value) newConversation();
}

async function syncRoute(id: string | null): Promise<void> {
  if (!id) {
    if (!sending.value) reset();
    return;
  }
  if (id === conversationId.value) return;
  await open(id);
  scrollToBottom();
}

watch(
  () => route.params.id,
  (id) => {
    if (sending.value) return;
    void syncRoute(typeof id === 'string' ? id : null);
  },
);

onMounted(async () => {
  void loadAiStatus();

  const id = routeId.value;
  if (id) {
    await syncRoute(id);
    return;
  }

  const question = typeof route.query.q === 'string' ? route.query.q.trim() : '';
  if (question.length >= 3) {
    await loadAiStatus();
    // La URL deja de llevar la pregunta para que recargar no la reenvíe.
    await router.replace({ name: 'consulta' });
    await ask(question);
    return;
  }

  field.value?.focus({ preventScroll: true });
});
</script>

<template>
  <AppShell>
    <div class="consulta">
      <span class="consulta-glow" aria-hidden="true" />

      <div class="relative mx-auto flex h-[calc(100svh-4rem)] w-full max-w-[1280px] gap-4 px-3 sm:px-6">
        <!-- Historial de conversaciones -->
        <aside class="hidden w-64 shrink-0 border-r border-white/10 py-3 pr-2 lg:block">
          <ConversationList
            :active-id="conversationId"
            :refresh-key="refreshKey"
            @select="selectConversation"
            @create="newConversation"
            @deleted="onDeleted"
          />
        </aside>

        <div class="mx-auto flex min-w-0 max-w-[900px] flex-1 flex-col">
          <!-- Cabecera -->
          <header class="flex shrink-0 items-center gap-2 py-3">
            <RouterLink
              :to="{ name: 'home' }"
              class="grid size-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/65 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white"
              aria-label="Volver al panel"
            >
              <ArrowLeft class="size-4" />
            </RouterLink>

            <button
              type="button"
              class="grid size-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/65 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white lg:hidden"
              aria-label="Abrir historial"
              @click="sidebarOpen = true"
            >
              <PanelLeftOpen class="size-4" />
            </button>

            <div class="min-w-0 flex-1">
              <h1 class="truncate text-[15px] font-semibold text-white">{{ headerTitle }}</h1>
              <p class="truncate text-[11.5px] text-white/50">
                Pregunta por tus documentos; las cifras salen de la base
              </p>
            </div>

            <span
              v-if="aiStatus?.model && configured"
              class="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/70 sm:inline-flex"
              :title="`Proveedor de IA configurado: ${aiStatus.model}`"
            >
              <span class="size-1.5 rounded-full bg-[#06e3bd]" aria-hidden="true" />
              {{ aiStatus.model }}
            </span>

            <button
              v-if="hasThread"
              type="button"
              class="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/12 px-3 text-[11.5px] text-white/65 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white"
              :disabled="sending"
              @click="newConversation"
            >
              <RotateCcw class="size-3.5" aria-hidden="true" />
              <span class="hidden sm:inline">Nueva consulta</span>
            </button>

            <a
              :href="newTabHref"
              target="_blank"
              rel="noopener"
              class="grid size-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/65 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white"
              aria-label="Abrir la consulta en una pestaña nueva"
              title="Abrir en una pestaña nueva"
            >
              <ExternalLink class="size-4" />
            </a>
          </header>

          <!-- Hilo -->
          <div ref="thread" class="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 pr-0.5" aria-live="polite">
            <div v-if="loading && messages.length === 0" class="flex h-full items-center justify-center gap-2 text-[12.5px] text-white/50">
              <Loader2 class="size-4 animate-spin" />
              Abriendo la conversación…
            </div>

            <div v-else-if="!hasThread && !sending" class="flex h-full flex-col items-center justify-center py-10 text-center">
              <span class="grid size-12 place-items-center rounded-2xl border border-white/12 bg-white/[0.06]">
                <Sparkles class="size-5 text-[#a9d1ff]" aria-hidden="true" />
              </span>
              <h2 class="mt-4 text-[19px] font-semibold text-white">Pregúntale a tus documentos</h2>
              <p class="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/55">
                Responde con documentos enlazados o con el gráfico que mejor explique la cifra.
                Nada se inventa: la IA elige el plan y el servidor consulta la base.
              </p>

              <div class="mt-5 grid w-full max-w-lg gap-2 sm:grid-cols-2">
                <button
                  v-for="example in examples"
                  :key="example"
                  type="button"
                  class="rounded-xl border border-white/12 bg-white/[0.05] px-3.5 py-2.5 text-left text-[12.5px] text-white/75 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white disabled:opacity-50"
                  :disabled="!configured"
                  @click="useExample(example)"
                >
                  {{ example }}
                </button>
              </div>

              <p v-if="!configured && aiStatus" class="mt-4 text-[12px] text-[#ffb4ab]">
                La IA no está configurada.
                <RouterLink :to="{ name: 'settings' }" class="underline underline-offset-2">
                  Configúrala en Ajustes
                </RouterLink>
                para empezar.
              </p>
              <p v-else-if="!aiStatus" class="mt-4 text-[12px] text-white/45">Comprobando la IA…</p>
            </div>

            <button
              v-if="hasMore"
              type="button"
              class="mx-auto block rounded-full border border-white/12 px-3 py-1 text-[11px] text-white/50 hover:border-white/25 hover:text-white"
              :disabled="loading"
              @click="loadPrevious"
            >
              {{ loading ? 'Cargando…' : 'Cargar mensajes anteriores' }}
            </button>

            <TransitionGroup name="msg" tag="div" class="space-y-3">
              <div v-for="message in messages" :key="message.id">
                <!-- Pregunta -->
                <div v-if="message.role === 'user'" class="flex justify-end">
                  <p class="max-w-[85%] rounded-2xl rounded-br-md bg-[#4e85c8] px-3.5 py-2 text-[13.5px] leading-relaxed text-white shadow-[0_10px_30px_-16px_rgb(78_133_200/0.9)]">
                    {{ message.text }}
                  </p>
                </div>

                <!-- Respuesta -->
                <div v-else class="flex justify-start">
                  <div class="w-full max-w-[92%] rounded-2xl rounded-bl-md border border-white/12 bg-white/[0.055] px-3.5 py-3 backdrop-blur">
                    <AskAnswer
                      v-if="message.result"
                      :result="message.result"
                      @refine="onRefine"
                      @ask="ask"
                      @open="openDocument"
                      @save="onSave"
                    />
                    <div v-else class="flex items-start gap-2">
                      <p class="flex-1 text-[13px] leading-relaxed text-[#ffb4ab]">{{ message.text }}</p>
                      <button
                        type="button"
                        class="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30 hover:text-white"
                        @click="onRetry"
                      >
                        Reintentar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </TransitionGroup>

            <div v-if="sending" class="flex justify-start">
              <div class="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/12 bg-white/[0.055] px-3.5 py-3">
                <Loader2 class="size-3.5 animate-spin text-[#7df3dd]" aria-hidden="true" />
                <TypingDots />
                <span class="text-[12px] text-white/55">Consultando tus documentos…</span>
              </div>
            </div>
          </div>

          <!-- Composer -->
          <form class="shrink-0 pb-4" @submit.prevent="submit">
            <div class="consulta-composer">
              <label :for="inputId" class="sr-only">Pregunta sobre tus documentos</label>
              <textarea
                :id="inputId"
                ref="field"
                v-model="text"
                rows="1"
                class="consulta-input"
                placeholder="¿Cuántos memorándums hice este mes?"
                maxlength="500"
                enterkeyhint="send"
                :disabled="!configured || sending"
                @input="resize"
                @keydown="onKeydown"
              />
              <button
                type="submit"
                class="grid size-9 shrink-0 place-items-center rounded-full bg-[#06e3bd] text-navy shadow-[0_0_26px_-6px_rgba(6,227,189,0.75)] transition-colors hover:bg-[#3af0cd] disabled:bg-white/12 disabled:text-white/40 disabled:shadow-none"
                :disabled="!canSend"
                :aria-label="sending ? 'Consultando' : 'Enviar consulta'"
              >
                <Loader2 v-if="sending" class="size-4 animate-spin" />
                <ArrowUp v-else class="size-4" />
              </button>
            </div>
            <p class="mt-2 px-1 text-[11px] text-white/45">
              Enter envía · Shift + Enter salta de línea · El historial queda guardado
            </p>
          </form>
        </div>
      </div>

      <!-- Historial en móvil -->
      <div v-if="sidebarOpen" class="fixed inset-0 z-50 lg:hidden">
        <div class="absolute inset-0 bg-black/60" @click="sidebarOpen = false" />
        <div class="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-white/10 bg-[#081428] p-3 shadow-2xl">
          <ConversationList
            :active-id="conversationId"
            :refresh-key="refreshKey"
            @select="selectConversation"
            @create="newConversation"
            @deleted="onDeleted"
          />
        </div>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.consulta {
  position: relative;
  min-height: 100%;
  background:
    radial-gradient(55% 42% at 50% 22%, rgb(58 106 176 / 0.26) 0%, transparent 74%),
    radial-gradient(32% 24% at 78% 12%, rgb(6 227 189 / 0.05) 0%, transparent 70%),
    linear-gradient(180deg, #05080f 0%, #081428 46%, #04070d 100%);
}

.consulta-glow {
  position: absolute;
  inset-inline: 0;
  top: 6%;
  height: 44%;
  background: radial-gradient(50% 60% at 50% 45%, rgb(64 116 190 / 0.2), transparent 74%);
  filter: blur(10px);
  pointer-events: none;
}

.consulta-composer {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgb(255 255 255 / 0.28);
  border-radius: 22px;
  background: linear-gradient(180deg, rgb(12 32 60 / 0.94), rgb(4 16 34 / 0.96));
  padding: 6px 6px 6px 14px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.1),
    0 20px 50px -30px rgb(0 0 0 / 0.95),
    0 0 40px -14px rgb(78 133 200 / 0.45);
  backdrop-filter: blur(10px);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.consulta-composer:focus-within {
  border-color: rgb(255 255 255 / 0.48);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.14),
    0 20px 50px -30px rgb(0 0 0 / 0.95),
    0 0 0 3px rgb(78 133 200 / 0.25),
    0 0 50px -12px rgb(78 133 200 / 0.6);
}

.consulta-input {
  min-height: 36px;
  max-height: 160px;
  flex: 1 1 auto;
  resize: none;
  border: 0;
  background: transparent;
  padding: 8px 0;
  font-size: 14px;
  line-height: 1.5;
  color: #fff;
  outline: none;
}

.consulta-input::placeholder {
  color: rgb(255 255 255 / 0.55);
}

.msg-enter-active {
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .msg-enter-active {
    transition: none;
  }
  .consulta-composer {
    transition: none;
  }
}
</style>
