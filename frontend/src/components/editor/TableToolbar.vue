<script setup lang="ts">
import type { ChainedCommands, Editor } from '@tiptap/core';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Columns3,
  Grid3X3,
  Merge,
  PaintBucket,
  Plus,
  Rows3,
  Settings2,
  Split,
  Table2,
  Trash2,
} from 'lucide-vue-next';
import { computed, ref, watchEffect } from 'vue';

import BaseDropdown from '@/components/ui/BaseDropdown.vue';

const props = defineProps<{ editor: Editor | null }>();

const tick = ref(0);

watchEffect((onCleanup) => {
  const editor = props.editor;
  if (!editor) return;
  const bump = () => {
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

const active = computed(() => {
  void tick.value;
  return props.editor?.isActive('table') ?? false;
});

const isHeaderCell = computed(() => {
  void tick.value;
  return props.editor?.isActive('tableHeader') ?? false;
});

const cellAttrs = computed(() => {
  void tick.value;
  const editor = props.editor;
  if (!editor) return {} as Record<string, unknown>;
  return editor.getAttributes(isHeaderCell.value ? 'tableHeader' : 'tableCell') as Record<string, unknown>;
});

const tableAttrs = computed(() => {
  void tick.value;
  return (props.editor?.getAttributes('table') ?? {}) as Record<string, unknown>;
});

const canMerge = computed(() => {
  void tick.value;
  return props.editor?.can().mergeCells() ?? false;
});

const canSplit = computed(() => {
  void tick.value;
  return props.editor?.can().splitCell() ?? false;
});

function normalizeHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

const cellColor = computed(() => normalizeHex(cellAttrs.value.backgroundColor, '#ffffff'));
const tableBorderColor = computed(() => normalizeHex(tableAttrs.value.borderColor, '#c9d2dd'));
const tableBackground = computed(() => normalizeHex(tableAttrs.value.tableBackground, '#ffffff'));
const cellVAlign = computed(() => String(cellAttrs.value.verticalAlign ?? 'top'));
const cellAlign = computed(() => {
  const value = String(cellAttrs.value.align ?? '');
  return ['left', 'center', 'right', 'justify'].includes(value) ? value : 'left';
});
const cellPadding = computed(() => Number(cellAttrs.value.padding ?? tableAttrs.value.cellPadding ?? 7) || 0);
const tableWidth = computed(() => {
  const value = String(tableAttrs.value.tableWidth ?? 'full');
  return value === 'auto' ? 'auto' : 'full';
});
const tableAlign = computed(() => {
  const value = String(tableAttrs.value.tableAlign ?? 'left');
  return ['left', 'center', 'right'].includes(value) ? value : 'left';
});
const borderWidth = computed(() => Number(tableAttrs.value.borderWidth ?? 1) || 0);
const borderStyle = computed(() => {
  const value = String(tableAttrs.value.borderStyle ?? 'solid');
  return ['solid', 'dashed', 'dotted', 'none'].includes(value) ? value : 'solid';
});
const tablePadding = computed(() => Number(tableAttrs.value.cellPadding ?? 7) || 0);

const menuItemClass =
  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40';

function run(action: (chain: ChainedCommands) => ChainedCommands): void {
  const editor = props.editor;
  if (!editor) return;
  action(editor.chain().focus()).run();
}

function setCellAttr(name: string, value: unknown): void {
  run((chain) => chain.setCellAttribute(name, value));
}

function setCellColor(event: Event): void {
  setCellAttr('backgroundColor', (event.target as HTMLInputElement).value);
}

function setCellAlign(value: string): void {
  const editor = props.editor;
  if (!editor) return;
  editor.chain().focus().setCellAttribute('align', value).setTextAlign(value).run();
}

function setCellVAlign(value: string): void {
  setCellAttr('verticalAlign', value);
}

function setCellPadding(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  setCellAttr('padding', Number.isFinite(value) ? value : null);
}

function updateTable(values: Record<string, unknown>): void {
  run((chain) => chain.updateAttributes('table', values));
}

function setTableBorderColor(event: Event): void {
  updateTable({ borderColor: (event.target as HTMLInputElement).value });
}

function setTableBackground(event: Event): void {
  updateTable({ tableBackground: (event.target as HTMLInputElement).value });
}

function setBorderWidth(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  updateTable({ borderWidth: Number.isFinite(value) ? value : 1 });
}

function setBorderStyle(event: Event): void {
  updateTable({ borderStyle: (event.target as HTMLSelectElement).value });
}

function setTablePadding(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  updateTable({ cellPadding: Number.isFinite(value) ? value : 7 });
}

function distributeColumns(): void {
  const editor = props.editor;
  if (!editor) return;
  const { state } = editor;
  const { $from } = state.selection;

  let tablePos = -1;
  let tableNode: typeof state.doc | null = null;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') {
      tablePos = $from.before(depth);
      tableNode = node as never;
      break;
    }
  }
  if (tablePos < 0 || !tableNode) return;

  const tr = state.tr;
  (tableNode as never as { forEach: (fn: (row: any, offset: number) => void) => void }).forEach(
    (row, rowOffset) => {
      row.forEach((cell: any, cellOffset: number) => {
        const pos = tablePos + 2 + rowOffset + cellOffset;
        tr.setNodeMarkup(pos, undefined, { ...cell.attrs, colwidth: null });
      });
    },
  );
  tr.setNodeMarkup(tablePos, undefined, { ...(tableNode as any).attrs, tableWidth: 'full' });
  editor.view.dispatch(tr);
}
</script>

<template>
  <div
    v-if="active"
    data-table-toolbar
    class="flex w-full flex-wrap items-center gap-0.5 border-b border-hairline bg-surface-muted/45 px-2 py-1.5"
  >
    <span class="mr-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
      <Table2 class="size-3.5" />
      Tabla
    </span>

    <button type="button" class="tool-btn relative" title="Añadir fila después" @click="run((c) => c.addRowAfter())">
      <Rows3 class="size-4" />
      <Plus class="absolute size-2.5 translate-x-1.5 translate-y-1.5" />
    </button>
    <button type="button" class="tool-btn relative" title="Añadir columna después" @click="run((c) => c.addColumnAfter())">
      <Columns3 class="size-4" />
      <Plus class="absolute size-2.5 translate-x-1.5 translate-y-1.5" />
    </button>

    <BaseDropdown width="w-52">
      <template #trigger>
        <button type="button" class="tool-btn w-auto gap-1 px-1.5 text-[11px] font-medium" title="Operaciones con filas">
          <Rows3 class="size-3.5" />
          Filas
          <ChevronDown class="size-3" />
        </button>
      </template>
      <template #content>
        <div class="p-1">
          <button type="button" :class="menuItemClass" @click="run((c) => c.addRowBefore())">
            <Rows3 class="size-3.5" /> Añadir fila arriba
          </button>
          <button type="button" :class="menuItemClass" @click="run((c) => c.addRowAfter())">
            <Rows3 class="size-3.5" /> Añadir fila abajo
          </button>
          <button type="button" :class="menuItemClass" @click="run((c) => c.deleteRow())">
            <Trash2 class="size-3.5 text-danger" /> Eliminar fila
          </button>
          <div class="my-1 h-px bg-hairline" />
          <button type="button" :class="menuItemClass" @click="run((c) => c.toggleHeaderRow())">
            <Table2 class="size-3.5" /> Alternar fila de cabecera
          </button>
        </div>
      </template>
    </BaseDropdown>

    <BaseDropdown width="w-56">
      <template #trigger>
        <button type="button" class="tool-btn w-auto gap-1 px-1.5 text-[11px] font-medium" title="Operaciones con columnas">
          <Columns3 class="size-3.5" />
          Columnas
          <ChevronDown class="size-3" />
        </button>
      </template>
      <template #content>
        <div class="p-1">
          <button type="button" :class="menuItemClass" @click="run((c) => c.addColumnBefore())">
            <Columns3 class="size-3.5" /> Añadir columna a la izquierda
          </button>
          <button type="button" :class="menuItemClass" @click="run((c) => c.addColumnAfter())">
            <Columns3 class="size-3.5" /> Añadir columna a la derecha
          </button>
          <button type="button" :class="menuItemClass" @click="run((c) => c.deleteColumn())">
            <Trash2 class="size-3.5 text-danger" /> Eliminar columna
          </button>
          <div class="my-1 h-px bg-hairline" />
          <button type="button" :class="menuItemClass" @click="run((c) => c.toggleHeaderColumn())">
            <Columns3 class="size-3.5" /> Alternar columna de cabecera
          </button>
          <button type="button" :class="menuItemClass" @click="distributeColumns">
            <Grid3X3 class="size-3.5" /> Distribuir anchos por igual
          </button>
        </div>
      </template>
    </BaseDropdown>

    <button
      type="button"
      class="tool-btn w-auto gap-1 px-1.5 text-[11px] font-medium"
      :disabled="!canMerge"
      title="Unir celdas: selecciona varias con Shift + clic o arrastrando"
      @click="run((c) => c.mergeCells())"
    >
      <Merge class="size-3.5" />
      Unir
    </button>
    <button
      type="button"
      class="tool-btn w-auto gap-1 px-1.5 text-[11px] font-medium"
      :disabled="!canSplit"
      title="Dividir la celda combinada"
      @click="run((c) => c.splitCell())"
    >
      <Split class="size-3.5" />
      Dividir
    </button>

    <BaseDropdown width="w-64" :close-on-click="false">
      <template #trigger>
        <button type="button" class="tool-btn w-auto gap-1 px-1.5 text-[11px] font-medium" title="Propiedades de la celda">
          <PaintBucket class="size-3.5" />
          Celda
          <ChevronDown class="size-3" />
        </button>
      </template>
      <template #content>
        <div class="space-y-2 p-2">
          <div class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2 text-[12px] text-ink"><PaintBucket class="size-3.5" /> Fondo</span>
            <input
              type="color"
              class="h-7 w-10 cursor-pointer rounded border border-hairline bg-surface p-0.5"
              :value="cellColor"
              @input="setCellColor"
            />
          </div>
          <button
            type="button"
            :class="menuItemClass"
            @click="setCellAttr('backgroundColor', null)"
          >
            <Trash2 class="size-3.5" /> Quitar fondo
          </button>

          <div class="h-px bg-hairline" />
          <p class="px-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">Texto</p>
          <div class="flex items-center gap-0.5 px-1">
            <button type="button" :class="['tool-btn', { 'is-active': cellAlign === 'left' }]" title="Izquierda" @click="setCellAlign('left')">
              <AlignLeft class="size-4" />
            </button>
            <button type="button" :class="['tool-btn', { 'is-active': cellAlign === 'center' }]" title="Centrar" @click="setCellAlign('center')">
              <AlignCenter class="size-4" />
            </button>
            <button type="button" :class="['tool-btn', { 'is-active': cellAlign === 'right' }]" title="Derecha" @click="setCellAlign('right')">
              <AlignRight class="size-4" />
            </button>
            <button type="button" :class="['tool-btn', { 'is-active': cellAlign === 'justify' }]" title="Justificar" @click="setCellAlign('justify')">
              <AlignJustify class="size-4" />
            </button>
          </div>

          <label class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Alineación vertical</span>
            <select class="tool-select" :value="cellVAlign" @change="setCellVAlign(($event.target as HTMLSelectElement).value)">
              <option value="top">Arriba</option>
              <option value="middle">Medio</option>
              <option value="bottom">Abajo</option>
            </select>
          </label>

          <label class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Padding (px)</span>
            <input
              type="number"
              min="0"
              max="40"
              class="field w-20 !py-1 !text-[12px]"
              :value="cellPadding"
              @change="setCellPadding"
            />
          </label>

          <button type="button" :class="menuItemClass" @click="run((c) => c.toggleHeaderCell())">
            <Table2 class="size-3.5" /> Alternar cabecera de celda
          </button>
        </div>
      </template>
    </BaseDropdown>

    <BaseDropdown width="w-72" :close-on-click="false">
      <template #trigger>
        <button type="button" class="tool-btn w-auto gap-1 px-1.5 text-[11px] font-medium" title="Propiedades de la tabla">
          <Settings2 class="size-3.5" />
          Tabla
          <ChevronDown class="size-3" />
        </button>
      </template>
      <template #content>
        <div class="space-y-2 p-2">
          <label class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Ancho</span>
            <select class="tool-select" :value="tableWidth" @change="updateTable({ tableWidth: ($event.target as HTMLSelectElement).value })">
              <option value="full">100 %</option>
              <option value="auto">Automático</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Alineación</span>
            <select class="tool-select" :value="tableAlign" @change="updateTable({ tableAlign: ($event.target as HTMLSelectElement).value })">
              <option value="left">Izquierda</option>
              <option value="center">Centro</option>
              <option value="right">Derecha</option>
            </select>
          </label>

          <div class="h-px bg-hairline" />
          <p class="px-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">Bordes</p>
          <div class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Color</span>
            <input
              type="color"
              class="h-7 w-10 cursor-pointer rounded border border-hairline bg-surface p-0.5"
              :value="tableBorderColor"
              @input="setTableBorderColor"
            />
          </div>
          <label class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Grosor (px)</span>
            <input type="number" min="0" max="12" class="field w-20 !py-1 !text-[12px]" :value="borderWidth" @change="setBorderWidth" />
          </label>
          <label class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Estilo</span>
            <select class="tool-select" :value="borderStyle" @change="setBorderStyle">
              <option value="solid">Sólido</option>
              <option value="dashed">Discontinuo</option>
              <option value="dotted">Punteado</option>
              <option value="none">Sin bordes</option>
            </select>
          </label>

          <div class="h-px bg-hairline" />
          <div class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Fondo de tabla</span>
            <input
              type="color"
              class="h-7 w-10 cursor-pointer rounded border border-hairline bg-surface p-0.5"
              :value="tableBackground"
              @input="setTableBackground"
            />
          </div>
          <label class="flex items-center justify-between gap-3 px-2 text-[12px] text-ink">
            <span>Padding de celda</span>
            <input type="number" min="0" max="40" class="field w-20 !py-1 !text-[12px]" :value="tablePadding" @change="setTablePadding" />
          </label>

          <button type="button" :class="menuItemClass" @click="distributeColumns">
            <Grid3X3 class="size-3.5" /> Distribuir columnas
          </button>
          <button type="button" :class="menuItemClass" @click="run((c) => c.deleteTable())">
            <Trash2 class="size-3.5 text-danger" /> Eliminar tabla
          </button>
        </div>
      </template>
    </BaseDropdown>

    <button type="button" class="tool-btn text-danger" title="Eliminar tabla" @click="run((c) => c.deleteTable())">
      <Trash2 class="size-4" />
    </button>
  </div>
</template>
