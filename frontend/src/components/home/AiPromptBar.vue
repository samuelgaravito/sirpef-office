<script setup lang="ts">
import { ArrowUp, Loader2, Sparkles } from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref } from 'vue';

import { useAuthStore } from '@/stores/auth';

/**
 * Barra para pedirle un documento a la IA desde el panel de trabajo.
 *
 * Inspirada en la pantalla inicial de un chat: una píldora única, sin ruido,
 * donde se describe el encargo. La IA elige la plantilla y el editor abre el
 * asistente con ese primer mensaje ya enviado.
 */
const props = withDefaults(
  defineProps<{
    configured: boolean;
    checking?: boolean;
    model?: string | null;
    busy?: boolean;
    error?: string;
  }>(),
  { checking: false, model: null, busy: false, error: '' },
);

const emit = defineEmits<{ submit: [text: string] }>();

const auth = useAuthStore();
const text = ref('');
const field = ref<HTMLTextAreaElement | null>(null);
const inputId = 'home-ai-prompt';
const hintId = 'home-ai-prompt-hint';

const canSubmit = computed(
  () => props.configured && !props.busy && text.value.trim().length >= 3,
);

const placeholder = 'Pídele un documento a la IA…';

/** El campo crece con el texto hasta unas tres líneas. */
function resize(): void {
  const element = field.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 116)}px`;
}

function submit(): void {
  if (!canSubmit.value) return;
  emit('submit', text.value.trim());
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}

onMounted(() => {
  // El foco inicial deja la barra lista sin abrir el teclado en móvil.
  if (window.matchMedia('(min-width: 1024px)').matches) {
    void nextTick(() => field.value?.focus({ preventScroll: true }));
  }
});
</script>

<template>
  <div class="relative">
    <!-- Halo azul detrás de la píldora, como la pantalla de Gemini. -->
    <span class="ai-prompt-glow" aria-hidden="true" />

    <form
      class="ai-prompt"
      :aria-busy="busy"
      @submit.prevent="submit"
    >
      <Sparkles class="size-4 shrink-0 text-[#a9d1ff]" aria-hidden="true" />

      <label :for="inputId" class="sr-only">Describe el documento que necesitas</label>
      <textarea
        :id="inputId"
        ref="field"
        v-model="text"
        rows="1"
        class="ai-prompt__input"
        :placeholder="placeholder"
        maxlength="2000"
        enterkeyhint="send"
        :disabled="!configured || busy"
        :aria-describedby="hintId"
        @input="resize"
        @keydown="onKeydown"
      />

      <span
        v-if="model && configured"
        class="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.12] px-2.5 py-1 text-[11.5px] text-white/80 md:inline-flex"
        :title="`Proveedor de IA configurado: ${model}`"
      >
        <span class="size-1.5 rounded-full bg-[#06e3bd]" aria-hidden="true" />
        IA · {{ model }}
      </span>

      <button
        type="submit"
        class="grid size-9 shrink-0 place-items-center rounded-full bg-[#06e3bd] text-navy shadow-[0_0_26px_-6px_rgba(6,227,189,0.75)] transition-colors hover:bg-[#3af0cd] disabled:bg-white/12 disabled:text-white/40 disabled:shadow-none"
        :disabled="!canSubmit"
        :aria-label="busy ? 'Eligiendo la plantilla' : 'Redactar con IA'"
      >
        <Loader2 v-if="busy" class="size-4 animate-spin" />
        <ArrowUp v-else class="size-4" />
      </button>
    </form>

    <div
      :id="hintId"
      class="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11.5px] leading-snug text-white/65"
      aria-live="polite"
    >
      <p v-if="checking" class="text-white/75">Comprobando la IA…</p>
      <p v-else-if="!configured" class="flex flex-wrap items-center gap-2 text-white/75">
        <span>La IA no está configurada.</span>
        <RouterLink
          v-if="auth.isAdmin"
          :to="{ name: 'settings' }"
          class="inline-flex items-center gap-1 rounded-full border border-[#06e3bd]/40 bg-[#06e3bd]/10 px-2 py-0.5 font-medium text-[#7df3dd] transition-colors hover:bg-[#06e3bd]/20 hover:text-white"
        >
          Configurar IA
        </RouterLink>
        <span v-else class="text-white/55">Pide a un administrador que la active.</span>
      </p>
      <p v-else-if="busy" class="text-white/80">Eligiendo la plantilla y preparando el editor…</p>
      <p v-else-if="error" class="text-[#ffb4ab]" role="alert">{{ error }}</p>
      <p v-else>
        La IA elige la plantilla y redacta; tú revisas.
        <span class="text-white/40">Ej.: «acta del lunes con los acuerdos».</span>
      </p>

      <span v-if="configured && !error && !busy" class="hidden items-center gap-1 sm:flex">
        <kbd class="rounded border border-white/20 bg-white/10 px-1 text-[10px] font-semibold text-white/70">Enter</kbd>
        envía
      </span>
    </div>
  </div>
</template>

<style scoped>
.ai-prompt-glow {
  position: absolute;
  inset: -60% 2% -90%;
  z-index: 0;
  border-radius: 999px;
  background:
    radial-gradient(55% 100% at 50% 65%, rgb(78 133 200 / 0.5), transparent 72%),
    radial-gradient(32% 70% at 82% 70%, rgb(6 227 189 / 0.18), transparent 70%);
  filter: blur(26px);
  pointer-events: none;
}

.ai-prompt {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgb(255 255 255 / 0.3);
  border-top-color: rgb(255 255 255 / 0.42);
  border-radius: 22px;
  background: linear-gradient(180deg, rgb(12 32 60 / 0.94), rgb(4 16 34 / 0.96));
  padding: 6px 6px 6px 14px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.12),
    0 24px 60px -28px rgb(0 0 0 / 0.95),
    0 0 46px -12px rgb(78 133 200 / 0.55);
  backdrop-filter: blur(10px);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.ai-prompt:focus-within {
  border-color: rgb(255 255 255 / 0.5);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.16),
    0 24px 60px -28px rgb(0 0 0 / 0.95),
    0 0 0 3px rgb(78 133 200 / 0.28),
    0 0 56px -10px rgb(78 133 200 / 0.7);
}

.ai-prompt__input {
  min-height: 36px;
  max-height: 116px;
  flex: 1 1 auto;
  resize: none;
  border: 0;
  background: transparent;
  padding: 8px 0;
  font-size: 14.5px;
  line-height: 1.5;
  color: #fff;
  outline: none;
}

.ai-prompt__input::placeholder {
  color: rgb(255 255 255 / 0.6);
}

@media (prefers-reduced-motion: reduce) {
  .ai-prompt {
    transition: none;
  }
}
</style>
