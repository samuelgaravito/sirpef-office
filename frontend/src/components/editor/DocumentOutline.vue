<script setup lang="ts">
import { FileText, ListTree, PanelLeftClose } from 'lucide-vue-next';

interface OutlineItem {
  pos: number;
  level: number;
  text: string;
}

const props = withDefaults(
  defineProps<{
    title?: string;
    headings: OutlineItem[];
    activePos?: number | null;
    pageCount?: number;
  }>(),
  {
    title: '',
    activePos: null,
    pageCount: 0,
  },
);

const emit = defineEmits<{
  navigate: [pos: number];
  close: [];
}>();

</script>

<template>
  <div data-outline class="flex h-full min-h-0 flex-col bg-surface">
    <header class="flex items-start gap-2 border-b border-hairline px-3 py-3">
      <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <ListTree class="size-3.5" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Estructura
        </p>
        <p class="mt-0.5 truncate text-[12.5px] font-medium text-ink" :title="props.title">
          {{ props.title || 'Documento sin título' }}
        </p>
        <p v-if="pageCount > 0" class="text-[11px] text-ink-subtle">
          {{ pageCount }} {{ pageCount === 1 ? 'página' : 'páginas' }}
        </p>
      </div>
      <button
        type="button"
        class="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        title="Ocultar estructura"
        aria-label="Ocultar estructura"
        @click="emit('close')"
      >
        <PanelLeftClose class="size-3.5" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <p class="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-subtle">
        Títulos
      </p>
      <button
        v-for="heading in headings"
        :key="`${heading.pos}-${heading.text}`"
        type="button"
        class="flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] leading-snug transition-colors hover:bg-surface-hover"
        :class="
          activePos === heading.pos
            ? 'bg-accent-soft font-medium text-accent'
            : 'text-ink-muted hover:text-ink'
        "
        :style="{ paddingLeft: `${8 + Math.max(0, Math.min(heading.level - 1, 3)) * 12}px` }"
        :title="heading.text"
        @click="emit('navigate', heading.pos)"
      >
        <FileText class="mt-0.5 size-3 shrink-0 opacity-60" />
        <span class="min-w-0 truncate">{{ heading.text || 'Sin título' }}</span>
      </button>

      <p v-if="headings.length === 0" class="px-2 py-2 text-[11.5px] leading-snug text-ink-subtle">
        Añade títulos al documento para navegar por su estructura.
      </p>
    </div>
  </div>
</template>
