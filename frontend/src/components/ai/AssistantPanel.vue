<script setup lang="ts">
import { HelpCircle, Loader2, Send, Sparkles, TriangleAlert, X } from 'lucide-vue-next';
import { nextTick, ref, watch } from 'vue';

import type { AiDraftMessage } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    messages: AiDraftMessage[];
    busy?: boolean;
    error?: string;
    warnings?: string[];
    questions?: string[];
    model?: string | null;
    templateName?: string | null;
    /** Hay plantilla y proveedor configurado. */
    enabled?: boolean;
    /** Motivo por el que no se puede usar el asistente. */
    disabledReason?: string;
    /** Identificador único del campo de texto (hay dos paneles: escritorio y móvil). */
    inputId?: string;
  }>(),
  {
    busy: false,
    error: '',
    warnings: () => [],
    questions: () => [],
    model: null,
    templateName: null,
    enabled: true,
    disabledReason: '',
    inputId: 'assistant-input',
  },
);

const emit = defineEmits<{
  close: [];
  send: [text: string];
}>();

const input = ref('');
const list = ref<HTMLElement | null>(null);

const suggestions = [
  'Redacta el documento con un tono formal y breve.',
  'Añade una tabla con los datos principales.',
  'Hazlo más cercano, sin perder el formato.',
];

function scrollToBottom(): void {
  void nextTick(() => {
    const element = list.value;
    if (element) element.scrollTop = element.scrollHeight;
  });
}

watch(
  () => [props.messages.length, props.busy],
  () => scrollToBottom(),
);

function submit(): void {
  const text = input.value.trim();
  if (!text || props.busy || !props.enabled) return;
  input.value = '';
  emit('send', text);
}

function useSuggestion(text: string): void {
  input.value = text;
  void nextTick(() => document.getElementById(props.inputId)?.focus());
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  submit();
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface">
    <header class="flex shrink-0 items-start gap-2 border-b border-hairline px-4 py-3">
      <div class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Sparkles class="size-4" />
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="text-[14.5px] font-semibold leading-tight">Asistente de redacción</h2>
        <p class="mt-0.5 truncate text-[11.5px] text-ink-muted">
          <template v-if="templateName">{{ templateName }}</template>
          <template v-else>Documento sin plantilla</template>
          <template v-if="model"> · {{ model }}</template>
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        aria-label="Cerrar asistente"
        @click="emit('close')"
      >
        <X class="size-4" />
      </button>
    </header>

    <div ref="list" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <div v-if="messages.length === 0" class="space-y-3">
        <div class="rounded-xl border border-hairline bg-surface-muted/40 p-3">
          <p class="text-[13px] font-medium text-ink">Cuéntame qué documento necesitas</p>
          <p class="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            Por ejemplo: «Quiero un memo para la jefa Ana sobre el retraso de los equipos,
            pidiendo un plan de recuperación antes del viernes».
          </p>
        </div>
        <div class="space-y-1.5">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            class="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-left text-[12.5px] text-ink-muted transition-colors hover:border-accent/40 hover:bg-accent-soft/40 hover:text-ink"
            @click="useSuggestion(suggestion)"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <template v-for="(message, index) in messages" :key="index">
        <div :class="['flex', message.role === 'user' ? 'justify-end' : 'justify-start']">
          <div
            :class="[
              'max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
              message.role === 'user'
                ? 'rounded-br-md bg-accent text-white'
                : 'rounded-bl-md border border-hairline bg-surface-muted/60 text-ink',
            ]"
          >
            {{ message.content }}
          </div>
        </div>
      </template>

      <div v-if="busy" class="flex items-center gap-2 rounded-xl border border-hairline bg-surface-muted/40 px-3 py-2.5 text-[12.5px] text-ink-muted">
        <Loader2 class="size-3.5 animate-spin text-accent" />
        Redactando la propuesta…
      </div>

      <div v-if="questions.length" class="rounded-xl border border-warning/30 bg-warning-soft/50 px-3 py-2.5">
        <p class="flex items-center gap-1.5 text-[12px] font-semibold text-warning">
          <HelpCircle class="size-3.5" />
          Confírmame estos datos
        </p>
        <ul class="mt-1 space-y-0.5 text-[12.5px] text-ink-muted">
          <li v-for="question in questions" :key="question">· {{ question }}</li>
        </ul>
      </div>

      <div v-if="warnings.length" class="rounded-xl border border-hairline bg-surface-muted/40 px-3 py-2.5">
        <p class="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
          <TriangleAlert class="size-3.5" />
          Para revisar
        </p>
        <ul class="mt-1 space-y-0.5 text-[12px] text-ink-muted">
          <li v-for="warning in warnings" :key="warning">· {{ warning }}</li>
        </ul>
      </div>

      <p v-if="error" class="rounded-xl border border-danger/20 bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
        {{ error }}
      </p>
    </div>

    <div class="shrink-0 border-t border-hairline p-3">
      <template v-if="enabled">
        <div class="rounded-xl border border-hairline bg-surface focus-within:border-accent">
          <textarea
            :id="inputId"
            v-model="input"
            class="min-h-[64px] w-full resize-none rounded-t-xl bg-transparent px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none"
            placeholder="Escribe la instrucción o el cambio que quieres…"
            maxlength="8000"
            :disabled="busy"
            @keydown="onKeydown"
          />
          <div class="flex items-center justify-between gap-2 px-2 pb-2 pl-3">
            <span class="text-[11px] text-ink-subtle">Enter envía · Shift+Enter salto de línea</span>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="busy || !input.trim()"
              @click="submit"
            >
              <Loader2 v-if="busy" class="size-3.5 animate-spin" />
              <Send v-else class="size-3.5" />
              Enviar
            </button>
          </div>
        </div>
        <p class="mt-1.5 text-[11px] leading-snug text-ink-subtle">
          La propuesta se aplica a la hoja. Revisa el resultado antes de guardar.
        </p>
      </template>

      <p v-else class="rounded-xl border border-hairline bg-surface-muted/40 px-3 py-2.5 text-[12.5px] leading-snug text-ink-muted">
        {{ disabledReason || 'El asistente no está disponible en este documento.' }}
      </p>
    </div>
  </div>
</template>
