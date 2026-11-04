<script setup lang="ts">
import type { Editor } from '@tiptap/core';
import { Table2 } from 'lucide-vue-next';
import { ref } from 'vue';

import BaseDropdown from '@/components/ui/BaseDropdown.vue';

const props = defineProps<{ editor: Editor | null }>();

const hoverRows = ref(3);
const hoverCols = ref(3);
const withHeader = ref(true);

function preview(rows: number, cols: number): void {
  hoverRows.value = rows;
  hoverCols.value = cols;
}

function insert(rows: number, cols: number): void {
  props.editor
    ?.chain()
    .focus()
    .insertTable({ rows, cols, withHeaderRow: withHeader.value })
    .run();
}
</script>

<template>
  <BaseDropdown width="w-64">
    <template #trigger>
      <button type="button" class="tool-btn" title="Insertar tabla" :disabled="!editor">
        <Table2 class="size-4" />
      </button>
    </template>

    <template #content>
      <div class="p-2">
        <div class="mb-2 flex items-center justify-between gap-2">
          <p class="text-[12px] font-semibold text-ink">Insertar tabla</p>
          <span class="text-[11px] tabular-nums text-ink-subtle">{{ hoverRows }} × {{ hoverCols }}</span>
        </div>

        <div class="grid grid-cols-8 gap-1" @mouseleave="preview(3, 3)">
          <button
            v-for="cell in 64"
            :key="cell"
            type="button"
            class="size-5 rounded-[3px] border transition-colors"
            :class="
              Math.ceil(cell / 8) <= hoverRows && ((cell - 1) % 8) + 1 <= hoverCols
                ? 'border-accent bg-accent/20'
                : 'border-hairline bg-surface-muted/50 hover:border-accent/50'
            "
            :title="`${Math.ceil(cell / 8)} filas × ${((cell - 1) % 8) + 1} columnas`"
            @mouseenter="preview(Math.ceil(cell / 8), ((cell - 1) % 8) + 1)"
            @click="insert(Math.ceil(cell / 8), ((cell - 1) % 8) + 1)"
          />
        </div>

        <label class="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-ink-muted">
          <input v-model="withHeader" type="checkbox" class="accent-[var(--color-accent)]" />
          Primera fila como cabecera
        </label>
        <p class="mt-2 text-[11px] leading-snug text-ink-subtle">
          Pulsa una celda para insertar la tabla de ese tamaño.
        </p>
      </div>
    </template>
  </BaseDropdown>
</template>
