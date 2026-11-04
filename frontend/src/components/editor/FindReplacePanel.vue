<script setup lang="ts">
import type { Editor } from '@tiptap/core';
import { ArrowDown, ArrowUp, CaseSensitive, Replace, ReplaceAll, X } from 'lucide-vue-next';
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps<{ editor: Editor | null; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const term = ref('');
const replacement = ref('');
const caseSensitive = ref(false);
const matches = ref<{ from: number; to: number }[]>([]);
const current = ref(-1);
const searchInput = ref<HTMLInputElement | null>(null);

const total = computed(() => matches.value.length);
const position = computed(() => (total.value === 0 ? 0 : current.value + 1));

function collect(): void {
  const editor = props.editor;
  const needle = term.value;
  matches.value = [];
  current.value = -1;

  if (!editor || needle.length === 0) return;

  const haystackTransform = (value: string) => (caseSensitive.value ? value : value.toLowerCase());
  const needleTransformed = haystackTransform(needle);
  const found: { from: number; to: number }[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = haystackTransform(node.text);
    let index = text.indexOf(needleTransformed);

    while (index !== -1) {
      found.push({ from: pos + index, to: pos + index + needle.length });
      index = text.indexOf(needleTransformed, index + Math.max(1, needle.length));
    }
  });

  matches.value = found;
  // No se selecciona nada mientras se escribe: mover el foco al editor
  // haría que el resto de la búsqueda se escribiera en el documento.
  if (found.length > 0) current.value = 0;
}

function select(index: number): void {
  const editor = props.editor;
  const match = matches.value[index];
  if (!editor || !match) return;

  editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();
}

function step(delta: number): void {
  if (total.value === 0) return;
  const base = current.value === -1 ? (delta > 0 ? -1 : 0) : current.value;
  const next = (base + delta + total.value) % total.value;
  current.value = next;
  select(next);
}

function replaceOne(): void {
  const editor = props.editor;
  const index = current.value === -1 ? 0 : current.value;
  const match = matches.value[index];
  if (!editor || !match) return;

  editor
    .chain()
    .focus()
    .insertContentAt({ from: match.from, to: match.to }, replacement.value)
    .run();

  collect();
}

function replaceAll(): void {
  const editor = props.editor;
  if (!editor || matches.value.length === 0) return;

  const chain = editor.chain().focus();
  // De atrás hacia delante para que las posiciones anteriores sigan siendo válidas.
  for (let index = matches.value.length - 1; index >= 0; index -= 1) {
    const match = matches.value[index]!;
    chain.insertContentAt({ from: match.from, to: match.to }, replacement.value);
  }
  chain.run();
  collect();
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick();
      searchInput.value?.focus();
      searchInput.value?.select();
      collect();
    }
  },
);

watch(term, () => collect());
watch(caseSensitive, () => collect());

defineExpose({ focus: () => searchInput.value?.focus() });
</script>

<template>
  <Transition
    enter-active-class="transition duration-120"
    enter-from-class="-translate-y-1 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-100"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="absolute right-4 top-2 z-40 w-[330px] rounded-xl border border-hairline bg-surface p-3 shadow-pop"
      role="dialog"
      aria-label="Buscar y reemplazar"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[12px] font-semibold">Buscar y reemplazar</span>
        <button type="button" class="rounded p-1 text-ink-subtle hover:bg-surface-hover hover:text-ink" @click="emit('close')">
          <X class="size-3.5" />
        </button>
      </div>

      <div class="relative">
        <input
          ref="searchInput"
          v-model="term"
          class="field h-8 pr-20 !text-[12.5px]"
          placeholder="Buscar…"
          @keydown.enter.prevent="step(1)"
          @keydown.esc.prevent="emit('close')"
        />
        <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <button
            type="button"
            :class="['rounded p-1 hover:bg-surface-hover', caseSensitive ? 'text-accent' : 'text-ink-subtle']"
            :title="caseSensitive ? 'Distingue mayúsculas' : 'Ignora mayúsculas'"
            @click="caseSensitive = !caseSensitive"
          >
            <CaseSensitive class="size-3.5" />
          </button>
          <span class="px-1 text-[10.5px] tabular-nums text-ink-subtle">{{ position }}/{{ total }}</span>
        </div>
      </div>

      <input
        v-model="replacement"
        class="field mt-2 h-8 !text-[12.5px]"
        placeholder="Reemplazar con…"
        @keydown.enter.prevent="replaceOne"
        @keydown.esc.prevent="emit('close')"
      />

      <div class="mt-2.5 flex items-center gap-1">
        <button type="button" class="tool-btn" title="Anterior" :disabled="total === 0" @click="step(-1)">
          <ArrowUp class="size-4" />
        </button>
        <button type="button" class="tool-btn" title="Siguiente" :disabled="total === 0" @click="step(1)">
          <ArrowDown class="size-4" />
        </button>
        <span class="flex-1" />
        <button type="button" class="btn btn-outline btn-sm" :disabled="total === 0" @click="replaceOne">
          <Replace class="size-3.5" />
          Reemplazar
        </button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="total === 0" @click="replaceAll">
          <ReplaceAll class="size-3.5" />
          Todo
        </button>
      </div>
    </div>
  </Transition>
</template>
