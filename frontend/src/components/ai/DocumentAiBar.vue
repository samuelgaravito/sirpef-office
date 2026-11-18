<script setup lang="ts">
import type { AiInlineResult, DocType } from '@sirpefoffice/shared';
import { DOC_TYPE_LABELS } from '@sirpefoffice/shared';
import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Settings2,
  Sparkles,
  Table2,
  Wand2,
} from 'lucide-vue-next';
import { computed, nextTick, ref, watch } from 'vue';

import AiInlinePreview from '@/components/ai/AiInlinePreview.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';

interface Chip {
  label: string;
  instruction: string;
  mode: 'insert' | 'replace';
  focus?: boolean;
}

const props = withDefaults(
  defineProps<{
    enabled: boolean;
    disabledReason?: string;
    docType?: DocType | null;
    templateName?: string | null;
    hasSelection?: boolean;
    selectionPreview?: string;
    busy?: boolean;
    error?: string;
    result?: AiInlineResult | null;
    previewHtml?: string;
    showAssistant?: boolean;
    showGenerate?: boolean;
  }>(),
  {
    disabledReason: '',
    docType: null,
    templateName: null,
    hasSelection: false,
    selectionPreview: '',
    busy: false,
    error: '',
    result: null,
    previewHtml: '',
    showAssistant: true,
    showGenerate: true,
  },
);

const emit = defineEmits<{
  submit: [payload: { instruction: string; mode: 'insert' | 'replace' }];
  apply: [action: 'insert' | 'replace'];
  retry: [];
  discard: [];
  'open-assistant': [prompt: string];
  generate: [];
  'insert-table': [];
  'open-settings': [];
}>();

const input = ref('');
const field = ref<HTMLTextAreaElement | null>(null);
const modeOverride = ref<'insert' | 'replace' | null>(null);

const mode = computed<'insert' | 'replace'>(
  () => modeOverride.value ?? (props.hasSelection ? 'replace' : 'insert'),
);

watch(
  () => props.hasSelection,
  () => {
    modeOverride.value = null;
  },
);

const fixedChips = computed<Chip[]>(() => [
  ...(props.templateName
    ? [
        {
          label: 'Usar el formato del documento',
          instruction:
            'Redacta el contenido siguiendo el formato, la estructura y el estilo del documento.',
          mode: 'insert' as const,
        },
      ]
    : []),
  {
    label: 'Continuar el documento',
    instruction:
      'Continúa el documento a partir del cursor manteniendo el tono, el estilo y la estructura.',
    mode: 'insert',
  },
  {
    label: 'Añadir un párrafo',
    instruction: 'Escribe un párrafo sobre ',
    mode: 'insert',
    focus: true,
  },
]);

const contextChips = computed<Chip[]>(() => {
  if (props.hasSelection) {
    return [
      {
        label: 'Mejorar redacción',
        instruction:
          'Mejora la redacción de la selección: más clara, formal y concisa, sin cambiar el significado.',
        mode: 'replace',
      },
      {
        label: 'Resumir',
        instruction: 'Resume la selección en un párrafo breve y claro.',
        mode: 'replace',
      },
      {
        label: 'Cambiar tono',
        instruction:
          'Reescribe la selección con un tono más cercano y profesional, manteniendo el contenido.',
        mode: 'replace',
      },
      {
        label: 'Traducir',
        instruction: 'Traduce la selección al inglés manteniendo el tono formal.',
        mode: 'replace',
      },
    ];
  }

  switch (props.docType) {
    case 'meeting_minutes':
      return [
        {
          label: 'Redactar acuerdos',
          instruction: 'Redacta los acuerdos y compromisos de la reunión.',
          mode: 'insert',
        },
        {
          label: 'Resumir la reunión',
          instruction: 'Resume los puntos principales y las decisiones de la reunión.',
          mode: 'insert',
        },
      ];
    case 'memorandum':
      return [
        {
          label: 'Redactar antecedentes',
          instruction: 'Redacta los antecedentes del memorándum de forma breve y formal.',
          mode: 'insert',
        },
        {
          label: 'Añadir conclusión',
          instruction: 'Añade una conclusión formal que cierre el memorándum.',
          mode: 'insert',
        },
      ];
    case 'certificate':
      return [
        {
          label: 'Redactar la certificación',
          instruction: 'Redacta el texto de certificación con el tono institucional del documento.',
          mode: 'insert',
        },
      ];
    case 'delivery_note':
      return [
        {
          label: 'Redactar observaciones',
          instruction: 'Redacta las observaciones de la nota de entrega.',
          mode: 'insert',
        },
      ];
    case 'report':
      return [
        {
          label: 'Redactar introducción',
          instruction: 'Redacta la introducción del informe.',
          mode: 'insert',
        },
        {
          label: 'Añadir conclusiones',
          instruction: 'Añade las conclusiones del informe.',
          mode: 'insert',
        },
      ];
    case 'letter':
      return [
        {
          label: 'Redactar el cuerpo de la carta',
          instruction: 'Redacta el cuerpo de la carta con un tono formal.',
          mode: 'insert',
        },
      ];
    default:
      return [];
  }
});

const placeholder = computed(() =>
  props.hasSelection
    ? 'Mejora, resume o cambia el tono de la selección…'
    : 'Escribe un párrafo sobre…',
);

const canReplace = computed(() => props.hasSelection);
const docTypeLabel = computed(() =>
  props.docType ? DOC_TYPE_LABELS[props.docType] : null,
);

function resize(): void {
  const element = field.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
}

function applyChip(chip: Chip): void {
  input.value = chip.instruction;
  modeOverride.value = chip.mode;
  void nextTick(() => {
    field.value?.focus({ preventScroll: true });
    resize();
  });
}

function submit(): void {
  const instruction = input.value.trim();
  if (!instruction || props.busy || !props.enabled) return;
  emit('submit', { instruction, mode: mode.value });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}

function setMode(next: 'insert' | 'replace'): void {
  modeOverride.value = next;
}

function openAssistant(): void {
  emit('open-assistant', input.value.trim());
}
</script>

<template>
  <div
    data-ai-bar
    class="shrink-0 border-t border-hairline bg-surface/95 px-3 py-2.5 backdrop-blur"
  >
    <div class="mx-auto w-full max-w-[760px]">
      <div v-if="!enabled" class="flex items-center gap-2 rounded-xl border border-hairline bg-surface-muted/40 px-3 py-2">
        <Sparkles class="size-4 text-ink-subtle" />
        <p class="min-w-0 flex-1 text-[12px] text-ink-muted">
          {{ disabledReason || 'El asistente de IA no está disponible.' }}
        </p>
        <button type="button" class="btn btn-outline btn-sm" @click="emit('open-settings')">
          <Settings2 class="size-3.5" />
          Ajustes
        </button>
      </div>

      <template v-else>
        <div class="mb-1.5 flex items-center gap-1.5">
          <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              v-for="chip in fixedChips"
              :key="chip.label"
              type="button"
              class="shrink-0 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-muted transition-colors hover:border-accent/40 hover:bg-accent-soft/50 hover:text-ink"
              @click="applyChip(chip)"
            >
              {{ chip.label }}
            </button>
          </div>
          <BaseDropdown width="w-56" align="left">
            <template #trigger>
              <button
                type="button"
                class="shrink-0 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-muted transition-colors hover:border-accent/40 hover:bg-accent-soft/50 hover:text-ink"
              >
                Más
                <ChevronDown class="ml-0.5 inline size-3" />
              </button>
            </template>
            <template #content>
              <div class="p-1">
                <button
                  v-if="showAssistant"
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-surface-hover"
                  @click="openAssistant"
                >
                  <Sparkles class="size-3.5 text-accent" />
                  Abrir asistente completo
                </button>
                <button
                  v-if="showGenerate"
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-surface-hover"
                  @click="emit('generate')"
                >
                  <Wand2 class="size-3.5 text-accent" />
                  Rellenar campos con IA
                </button>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-surface-hover"
                  @click="emit('insert-table')"
                >
                  <Table2 class="size-3.5 text-accent" />
                  Insertar una tabla
                </button>
                <button
                  v-if="result"
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-danger hover:bg-danger-soft/60"
                  @click="emit('discard')"
                >
                  Descartar propuesta
                </button>
              </div>
            </template>
          </BaseDropdown>
        </div>

        <div
          v-if="contextChips.length"
          class="mb-1.5 flex items-center gap-1.5 overflow-x-auto pb-0.5"
        >
          <button
            v-for="chip in contextChips"
            :key="chip.label"
            type="button"
            class="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/15"
            @click="applyChip(chip)"
          >
            {{ chip.label }}
          </button>
        </div>

        <AiInlinePreview
          v-if="result"
          :reply="result.reply"
          :preview-html="previewHtml"
          :warnings="result.warnings"
          :questions="result.questions"
          :can-replace="canReplace"
          :busy="busy"
          class="mb-2"
          @apply="(action) => emit('apply', action)"
          @retry="emit('retry')"
          @discard="emit('discard')"
        />

        <div
          class="flex items-end gap-1.5 rounded-2xl border border-hairline bg-surface p-1.5 shadow-card focus-within:border-accent"
        >
          <span class="mb-1 grid size-7 shrink-0 place-items-center text-accent" aria-hidden="true">
            <Sparkles class="size-4" />
          </span>
          <textarea
            ref="field"
            v-model="input"
            rows="1"
            maxlength="4000"
            class="max-h-24 min-h-7 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none"
            :placeholder="placeholder"
            :disabled="busy"
            @input="resize"
            @keydown="onKeydown"
          />

          <div
            v-if="hasSelection"
            class="mb-0.5 hidden shrink-0 items-center rounded-full border border-hairline p-0.5 sm:flex"
            role="group"
            aria-label="Acción de la IA"
          >
            <button
              type="button"
              class="rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors"
              :class="mode === 'replace' ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-hover'"
              :aria-pressed="mode === 'replace'"
              @click="setMode('replace')"
            >
              Reemplazar
            </button>
            <button
              type="button"
              class="rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors"
              :class="mode === 'insert' ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-hover'"
              :aria-pressed="mode === 'insert'"
              @click="setMode('insert')"
            >
              Insertar
            </button>
          </div>

          <button
            type="button"
            class="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="busy || !input.trim()"
            aria-label="Enviar instrucción a la IA"
            @click="submit"
          >
            <Loader2 v-if="busy" class="size-4 animate-spin" />
            <ArrowUp v-else class="size-4" />
          </button>
        </div>

        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1">
          <p v-if="error" class="text-[11px] font-medium text-danger">{{ error }}</p>
          <p v-else-if="hasSelection" class="truncate text-[11px] text-ink-subtle">
            Selección: «{{ selectionPreview.slice(0, 80) }}{{ selectionPreview.length > 80 ? '…' : '' }}»
          </p>
          <p v-else class="text-[11px] text-ink-subtle">
            <template v-if="docTypeLabel">{{ docTypeLabel }} · </template>
            Enter envía · Shift+Enter salto de línea
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
