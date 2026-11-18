<script setup lang="ts">
import { Check, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    reply: string;
    previewHtml: string;
    warnings?: string[];
    questions?: string[];
    canReplace?: boolean;
    busy?: boolean;
  }>(),
  {
    warnings: () => [],
    questions: () => [],
    canReplace: false,
    busy: false,
  },
);

const emit = defineEmits<{
  apply: [action: 'insert' | 'replace'];
  retry: [];
  discard: [];
}>();
</script>

<template>
  <div
    data-ai-preview
    class="rounded-2xl border border-accent/30 bg-surface p-3 shadow-pop"
  >
    <header class="flex items-start gap-2">
      <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Sparkles class="size-3.5" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[12px] font-semibold text-ink">Propuesta de la IA</p>
        <p v-if="reply" class="mt-0.5 text-[12px] leading-snug text-ink-muted">{{ reply }}</p>
      </div>
      <button
        type="button"
        class="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        aria-label="Descartar propuesta"
        @click="emit('discard')"
      >
        <X class="size-3.5" />
      </button>
    </header>

    <div
      v-if="previewHtml"
      class="ai-inline-preview tiptap mt-2 max-h-64 overflow-y-auto rounded-lg border border-hairline bg-surface-muted/20 px-3 py-2"
      v-html="previewHtml"
    />

    <div v-if="questions.length" class="mt-2 rounded-lg border border-warning/30 bg-warning-soft/50 px-2.5 py-2">
      <p class="flex items-center gap-1.5 text-[11.5px] font-semibold text-warning">
        <TriangleAlert class="size-3.5" />
        Confírmame estos datos
      </p>
      <ul class="mt-1 space-y-0.5 text-[11.5px] text-ink-muted">
        <li v-for="question in questions" :key="question">· {{ question }}</li>
      </ul>
    </div>

    <div v-if="warnings.length" class="mt-2 rounded-lg border border-hairline bg-surface-muted/40 px-2.5 py-2">
      <p class="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-muted">
        <TriangleAlert class="size-3.5" />
        Para revisar
      </p>
      <ul class="mt-1 space-y-0.5 text-[11.5px] text-ink-muted">
        <li v-for="warning in warnings" :key="warning">· {{ warning }}</li>
      </ul>
    </div>

    <footer class="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="busy"
        @click="emit('apply', 'insert')"
      >
        <Check class="size-3.5" />
        Insertar en el cursor
      </button>
      <button
        v-if="canReplace"
        type="button"
        class="btn btn-outline btn-sm"
        :disabled="busy"
        @click="emit('apply', 'replace')"
      >
        <Check class="size-3.5" />
        Reemplazar selección
      </button>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="emit('retry')">
        <RefreshCw class="size-3.5" />
        Reintentar
      </button>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="emit('discard')">
        Descartar
      </button>
    </footer>
  </div>
</template>
