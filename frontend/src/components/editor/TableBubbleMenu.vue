<script setup lang="ts">
import type { ChainedCommands, Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import {
  Columns3,
  Merge,
  PaintBucket,
  Rows3,
  Settings2,
  Split,
  Table2,
  Trash2,
} from 'lucide-vue-next';
import { computed, ref, watchEffect } from 'vue';

import TableToolbar from '@/components/editor/TableToolbar.vue';

const props = defineProps<{ editor: Editor | null }>();

const showOptions = ref(false);
const tick = ref(0);

watchEffect((onCleanup) => {
  const editor = props.editor;
  if (!editor) return;
  const bump = (): void => {
    tick.value += 1;
  };
  editor.on('transaction', bump);
  editor.on('selectionUpdate', bump);
  bump();
  onCleanup(() => {
    editor.off('transaction', bump);
    editor.off('selectionUpdate', bump);
  });
});

const canMerge = computed(() => {
  void tick.value;
  return props.editor?.can().mergeCells() ?? false;
});

const canSplit = computed(() => {
  void tick.value;
  return props.editor?.can().splitCell() ?? false;
});

function run(action: (chain: ChainedCommands) => ChainedCommands): void {
  const editor = props.editor;
  if (!editor) return;
  action(editor.chain().focus()).run();
}

function setCellColor(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  run((chain) => chain.setCellAttribute('backgroundColor', value));
}

function setInstitutionalColor(color: string): void {
  run((chain) => chain.setCellAttribute('backgroundColor', color));
}

function shouldShow({ editor }: { editor: Editor }): boolean {
  if (!editor.isEditable) return false;
  const { selection } = editor.state;
  if (selection instanceof CellSelection) return true;
  if (selection instanceof NodeSelection) {
    return selection.node.type.name === 'table' || editor.isActive('table');
  }
  return selection.empty && editor.isActive('table');
}

const buttonClass =
  'tool-btn h-7 w-7 rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink';
</script>

<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    plugin-key="tableBubbleMenu"
    :should-show="shouldShow"
    :options="{ placement: 'top', offset: 8 }"
    class="pointer-events-auto"
  >
    <div
      data-table-bubble
      class="flex flex-col gap-1 rounded-lg border border-hairline bg-surface p-1 shadow-pop"
    >
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          :class="buttonClass"
          title="Añadir fila debajo"
          @mousedown.prevent
          @click="run((chain) => chain.addRowAfter())"
        >
          <Rows3 class="size-3.5" />
        </button>
        <button
          type="button"
          :class="buttonClass"
          title="Añadir columna a la derecha"
          @mousedown.prevent
          @click="run((chain) => chain.addColumnAfter())"
        >
          <Columns3 class="size-3.5" />
        </button>
        <button
          type="button"
          :class="buttonClass"
          title="Eliminar fila"
          @mousedown.prevent
          @click="run((chain) => chain.deleteRow())"
        >
          <Trash2 class="size-3.5 text-danger" />
        </button>
        <button
          type="button"
          :class="buttonClass"
          title="Eliminar columna"
          @mousedown.prevent
          @click="run((chain) => chain.deleteColumn())"
        >
          <Trash2 class="size-3.5 text-danger" />
        </button>

        <span class="mx-1 h-4 w-px bg-hairline" />

        <button
          type="button"
          :class="buttonClass"
          title="Unir celdas seleccionadas"
          :disabled="!canMerge"
          @mousedown.prevent
          @click="run((chain) => chain.mergeCells())"
        >
          <Merge class="size-3.5" />
        </button>
        <button
          type="button"
          :class="buttonClass"
          title="Dividir la celda combinada"
          :disabled="!canSplit"
          @mousedown.prevent
          @click="run((chain) => chain.splitCell())"
        >
          <Split class="size-3.5" />
        </button>
        <button
          type="button"
          :class="buttonClass"
          title="Alternar fila de cabecera"
          @mousedown.prevent
          @click="run((chain) => chain.toggleHeaderRow())"
        >
          <Table2 class="size-3.5" />
        </button>

        <span class="mx-1 h-4 w-px bg-hairline" />

        <button
          v-for="color in ['#e8eef5', '#eef2f7', '#f8fafc', '#fdeceb']"
          :key="color"
          type="button"
          class="size-5 rounded border border-hairline"
          :style="{ background: color }"
          :title="`Fondo de celda ${color}`"
          @mousedown.prevent
          @click="setInstitutionalColor(color)"
        />

        <label class="tool-btn relative h-7 w-7 cursor-pointer rounded-md" title="Color de fondo de la celda">
          <PaintBucket class="size-3.5" />
          <input
            type="color"
            class="absolute inset-0 cursor-pointer opacity-0"
            value="#e8eef5"
            @input="setCellColor"
          />
        </label>

        <span class="mx-1 h-4 w-px bg-hairline" />

        <button
          type="button"
          :class="[buttonClass, 'w-auto gap-1 px-1.5 text-[11px] font-medium', { 'is-active': showOptions }]"
          title="Opciones de la tabla"
          @mousedown.prevent
          @click="showOptions = !showOptions"
        >
          <Settings2 class="size-3.5" />
          Opciones
        </button>

        <button
          type="button"
          :class="[buttonClass, 'text-danger']"
          title="Eliminar tabla"
          @mousedown.prevent
          @click="run((chain) => chain.deleteTable())"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>

      <div
        v-if="showOptions"
        data-table-options
        class="max-h-[70vh] w-[360px] overflow-y-auto rounded-md border border-hairline bg-surface"
      >
        <TableToolbar :editor="editor" />
      </div>
    </div>
  </BubbleMenu>
</template>
