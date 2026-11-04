<script setup lang="ts">
import type { ChainedCommands, Editor } from '@tiptap/core';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Eraser,
  Hash,
  Highlighter,
  ImagePlus,
  Italic,
  Layers,
  Link2,
  List,
  ListOrdered,
  Minus,
  PanelLeft,
  PanelRight,
  Quote,
  Redo2,
  SeparatorHorizontal,
  Square,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-vue-next';
import { computed, ref, watchEffect } from 'vue';

import TableInsertMenu from '@/components/editor/TableInsertMenu.vue';
import TableToolbar from '@/components/editor/TableToolbar.vue';
import { INLINE_FONT_OPTIONS } from '@sirpefoffice/shared';

const props = defineProps<{ editor: Editor | null; pageTokens?: boolean }>();
const emit = defineEmits<{ image: [] }>();

const PAGE_TOKEN = '{page}';
const TOTAL_TOKEN = '{total}';
const PAGE_OF_TOTAL = 'Página {page} de {total}';

const fileInput = ref<HTMLInputElement | null>(null);

/**
 * TipTap no vuelve a renderizar en cada transacción, así que el estado del
 * cursor (negrita activa, tabla, alineación…) se refresca con un contador
 * que se incrementa al cambiar la selección o el documento.
 */
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

const fontFamilies = INLINE_FONT_OPTIONS;

const fontSizes = ['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '20', '24', '28', '32'];

const blockTypes = [
  { label: 'Texto normal', value: 'paragraph' },
  { label: 'Título 1', value: 'h1' },
  { label: 'Título 2', value: 'h2' },
  { label: 'Título 3', value: 'h3' },
  { label: 'Título 4', value: 'h4' },
];

const blockValue = computed(() => {
  void tick.value;
  const editor = props.editor;
  if (!editor) return 'paragraph';
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive('heading', { level })) return `h${level}`;
  }
  return 'paragraph';
});

const inlineActive = computed(() => {
  void tick.value;
  return {
    bold: props.editor?.isActive('bold') ?? false,
    italic: props.editor?.isActive('italic') ?? false,
    underline: props.editor?.isActive('underline') ?? false,
    strike: props.editor?.isActive('strike') ?? false,
    code: props.editor?.isActive('code') ?? false,
    bullet: props.editor?.isActive('bulletList') ?? false,
    ordered: props.editor?.isActive('orderedList') ?? false,
    quote: props.editor?.isActive('blockquote') ?? false,
    table: props.editor?.isActive('table') ?? false,
    image: props.editor?.isActive('image') ?? false,
  };
});

const alignActive = computed(() => {
  void tick.value;
  return {
    left: props.editor?.isActive({ textAlign: 'left' }) ?? false,
    center: props.editor?.isActive({ textAlign: 'center' }) ?? false,
    right: props.editor?.isActive({ textAlign: 'right' }) ?? false,
    justify: props.editor?.isActive({ textAlign: 'justify' }) ?? false,
  };
});

const currentColor = computed(() => {
  void tick.value;
  const color = props.editor?.getAttributes('textStyle').color;
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#1a1f26';
});

const currentHighlight = computed(() => {
  void tick.value;
  const color = props.editor?.getAttributes('highlight').color;
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#fff3a3';
});

function run(action: (chain: ChainedCommands) => ChainedCommands): void {
  const editor = props.editor;
  if (!editor) return;
  action(editor.chain().focus()).run();
}

/* ───────────────────────── Controles de imagen ───────────────────────── */

const IMAGE_WIDTH_PRESETS = [
  { label: 'Automático', width: 0 },
  { label: 'Pequeña', width: 180 },
  { label: 'Mediana', width: 320 },
  { label: 'Grande', width: 480 },
  { label: 'Ancho total', width: -1 },
] as const;

const imageState = computed(() => {
  void tick.value;
  const editor = props.editor;
  if (!editor || !editor.isActive('image')) return null;
  const attrs = editor.getAttributes('image');
  return {
    float: (attrs.float ?? 'none') as string,
    align: (attrs.align ?? 'center') as string,
    width: Number(attrs.width) || 0,
    height: Number(attrs.height) || 0,
  };
});

function updateImage(values: Record<string, unknown>): void {
  run((chain) => chain.updateAttributes('image', values));
}

function setImageFloat(float: string): void {
  const editor = props.editor;
  const current = editor?.getAttributes('image') ?? {};
  const height = Number(current.height) || 0;

  // Al pasar a "detrás del texto" conservamos la posición actual en la página.
  if (float === 'behind' && editor) {
    const dom = editor.view.nodeDOM(editor.state.selection.from) as HTMLElement | null;
    const base = editor.view.dom.getBoundingClientRect();
    if (dom) {
      const rect = dom.getBoundingClientRect();
      updateImage({
        float: 'behind',
        offsetX: Math.max(0, Math.round(rect.left - base.left)),
        offsetY: Math.max(0, Math.round(rect.top - base.top)),
        height: height || undefined,
      });
      return;
    }
  }

  // Al pasar a bloque (sin flotar) o salir de "detrás" se limpian los offsets.
  const leavingBehind = current.float === 'behind' && float !== 'behind';
  const offsetX = float === 'none' || leavingBehind ? 0 : Number(current.offsetX) || 0;
  const offsetY = float === 'none' || leavingBehind ? 0 : Number(current.offsetY) || 0;
  updateImage({ float, offsetX, offsetY, height: height || undefined });
}

function setImageWidth(width: number): void {
  const editor = props.editor;
  if (!editor) return;
  if (width === 0) {
    updateImage({ width: null, height: null });
    return;
  }
  const target = width < 0 ? Math.round(editor.view.dom.clientWidth) : width;
  const node =
    editor.state.selection.from >= 0 ? editor.state.doc.nodeAt(editor.state.selection.from) : null;
  const currentW = Number(editor.getAttributes('image').width) || 0;
  const currentH = Number(editor.getAttributes('image').height) || 0;
  let height: number | undefined;
  if (currentW > 0 && currentH > 0) {
    height = Math.round((currentH / currentW) * target); // conserva proporción
  }
  // Si no había tamaño fijo, medimos la imagen en el DOM.
  if (height === undefined && node && node.type.name === 'image') {
    const dom = editor.view.dom.querySelector('img');
    if (dom) {
      const img = dom as HTMLImageElement;
      if (img.naturalWidth > 0) height = Math.round((img.naturalHeight / img.naturalWidth) * target);
    }
  }
  updateImage({ width: target, height: height ?? null });
}

function deleteImage(): void {
  run((chain) => chain.deleteSelection());
}

function insertPageToken(token: string): void {
  run((chain) => chain.insertContent(token));
}

function onImageSizeChange(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  setImageWidth(value);
}

function setBlock(value: string): void {
  const editor = props.editor;
  if (!editor) return;
  const chain = editor.chain().focus();
  if (value === 'paragraph') chain.setParagraph().run();
  else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 }).run();
}

function setFontFamily(value: string): void {
  if (!value) run((chain) => chain.unsetFontFamily());
  else run((chain) => chain.setFontFamily(value));
}

function setFontSize(value: string): void {
  if (!value) run((chain) => chain.unsetFontSize());
  else run((chain) => chain.setFontSize(`${value}pt`));
}

function setColor(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  run((chain) => chain.setColor(value));
}

function setHighlight(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  run((chain) => chain.setHighlight({ color: value }));
}

function toggleLink(): void {
  const editor = props.editor;
  if (!editor) return;
  const previous = editor.getAttributes('link').href as string | undefined;
  const href = window.prompt('Dirección del enlace', previous ?? 'https://');
  if (href === null) return;
  if (href.trim() === '') {
    run((chain) => chain.extendMarkRange('link').unsetLink());
    return;
  }
  run((chain) => chain.extendMarkRange('link').setLink({ href: href.trim() }));
}

function pickImage(): void {
  fileInput.value?.click();
}

function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (file.size > 8 * 1024 * 1024) {
    emit('image');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result ?? '');
    if (src) run((chain) => chain.setImage({ src }));
  };
  reader.readAsDataURL(file);
}

const fontSizeValue = computed(() => {
  void tick.value;
  const size = props.editor?.getAttributes('textStyle').fontSize as string | undefined;
  return size ? size.replace('pt', '') : '';
});

const fontFamilyValue = computed(() => {
  void tick.value;
  const family = props.editor?.getAttributes('textStyle').fontFamily as string | undefined;
  return family ?? '';
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-0.5 border-b border-hairline bg-surface px-2 py-1.5">
    <button type="button" class="tool-btn" :disabled="!editor?.can().undo()" title="Deshacer (Ctrl+Z)" @click="run((c) => c.undo())">
      <Undo2 class="size-4" />
    </button>
    <button type="button" class="tool-btn" :disabled="!editor?.can().redo()" title="Rehacer (Ctrl+Y)" @click="run((c) => c.redo())">
      <Redo2 class="size-4" />
    </button>

    <span class="tool-sep" />

    <select class="tool-select max-w-[130px]" :value="blockValue" @change="setBlock(($event.target as HTMLSelectElement).value)">
      <option v-for="option in blockTypes" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>

    <select class="tool-select max-w-[120px]" :value="fontFamilyValue" @change="setFontFamily(($event.target as HTMLSelectElement).value)">
      <option v-for="family in fontFamilies" :key="family.value" :value="family.value">{{ family.label }}</option>
    </select>

    <select class="tool-select w-[62px]" :value="fontSizeValue" @change="setFontSize(($event.target as HTMLSelectElement).value)">
      <option value="">Auto</option>
      <option v-for="size in fontSizes" :key="size" :value="size">{{ size }}</option>
    </select>

    <span class="tool-sep" />

    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.bold }]" title="Negrita (Ctrl+B)" @click="run((c) => c.toggleBold())">
      <Bold class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.italic }]" title="Cursiva (Ctrl+I)" @click="run((c) => c.toggleItalic())">
      <Italic class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.underline }]" title="Subrayado (Ctrl+U)" @click="run((c) => c.toggleUnderline())">
      <Underline class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.strike }]" title="Tachado" @click="run((c) => c.toggleStrike())">
      <Strikethrough class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.code }]" title="Código en línea" @click="run((c) => c.toggleCode())">
      <Code class="size-4" />
    </button>

    <label class="tool-btn relative cursor-pointer" title="Color de texto">
      <span class="text-[13px] font-bold">A</span>
      <span class="absolute bottom-1 left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full" :style="{ background: currentColor }" />
      <input type="color" class="absolute inset-0 cursor-pointer opacity-0" :value="currentColor" @input="setColor" />
    </label>

    <label class="tool-btn relative cursor-pointer" title="Resaltado">
      <Highlighter class="size-4" />
      <span class="absolute bottom-1 left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full" :style="{ background: currentHighlight }" />
      <input type="color" class="absolute inset-0 cursor-pointer opacity-0" :value="currentHighlight" @input="setHighlight" />
    </label>

    <span class="tool-sep" />

    <button type="button" :class="['tool-btn', { 'is-active': alignActive.left }]" title="Alinear a la izquierda" @click="run((c) => c.setTextAlign('left'))">
      <AlignLeft class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': alignActive.center }]" title="Centrar" @click="run((c) => c.setTextAlign('center'))">
      <AlignCenter class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': alignActive.right }]" title="Alinear a la derecha" @click="run((c) => c.setTextAlign('right'))">
      <AlignRight class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': alignActive.justify }]" title="Justificar" @click="run((c) => c.setTextAlign('justify'))">
      <AlignJustify class="size-4" />
    </button>

    <span class="tool-sep" />

    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.bullet }]" title="Lista con viñetas" @click="run((c) => c.toggleBulletList())">
      <List class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.ordered }]" title="Lista numerada" @click="run((c) => c.toggleOrderedList())">
      <ListOrdered class="size-4" />
    </button>
    <button type="button" :class="['tool-btn', { 'is-active': inlineActive.quote }]" title="Cita" @click="run((c) => c.toggleBlockquote())">
      <Quote class="size-4" />
    </button>

    <span class="tool-sep" />

    <button type="button" class="tool-btn" title="Insertar enlace" @click="toggleLink">
      <Link2 class="size-4" />
    </button>
    <button type="button" class="tool-btn" title="Insertar imagen" @click="pickImage">
      <ImagePlus class="size-4" />
    </button>

    <!-- Controles de imagen -->
    <template v-if="inlineActive.image && imageState">
      <span class="tool-sep" />
      <span class="mr-1 flex items-center gap-1 text-[11px] font-medium text-ink-subtle">
        <ImagePlus class="size-3.5" />
        Imagen
        <ChevronDown class="size-3" />
      </span>

      <!-- Flotación / ajuste de texto -->
      <button
        type="button"
        :class="['tool-btn', { 'is-active': imageState.float === 'none' }]"
        title="En línea (sin ajuste de texto)"
        @click="setImageFloat('none')"
      >
        <Square class="size-4" />
      </button>
      <button
        type="button"
        :class="['tool-btn', { 'is-active': imageState.float === 'left' }]"
        title="Flotar a la izquierda (texto alrededor)"
        @click="setImageFloat('left')"
      >
        <PanelLeft class="size-4" />
      </button>
      <button
        type="button"
        :class="['tool-btn', { 'is-active': imageState.float === 'right' }]"
        title="Flotar a la derecha (texto alrededor)"
        @click="setImageFloat('right')"
      >
        <PanelRight class="size-4" />
      </button>
      <button
        type="button"
        :class="['tool-btn', { 'is-active': imageState.float === 'behind' }]"
        title="Detrás del texto (marca de agua)"
        @click="setImageFloat('behind')"
      >
        <Layers class="size-4" />
      </button>

      <!-- Alineación de bloque (solo cuando no flota) -->
      <template v-if="imageState.float === 'none'">
        <span class="tool-sep" />
        <button
          type="button"
          :class="['tool-btn', { 'is-active': imageState.align === 'left' }]"
          title="Alinear imagen a la izquierda"
          @click="updateImage({ align: 'left' })"
        >
          <AlignLeft class="size-4" />
        </button>
        <button
          type="button"
          :class="['tool-btn', { 'is-active': imageState.align === 'center' }]"
          title="Centrar imagen"
          @click="updateImage({ align: 'center' })"
        >
          <AlignCenter class="size-4" />
        </button>
        <button
          type="button"
          :class="['tool-btn', { 'is-active': imageState.align === 'right' }]"
          title="Alinear imagen a la derecha"
          @click="updateImage({ align: 'right' })"
        >
          <AlignRight class="size-4" />
        </button>
      </template>

      <span class="tool-sep" />

      <!-- Tamaño -->
      <select
        class="field h-7 w-[120px] !text-[11.5px]"
        :value="IMAGE_WIDTH_PRESETS.find((p) => p.width === imageState?.width)?.width ?? imageState?.width ?? 0"
        title="Tamaño de la imagen"
        @change="onImageSizeChange"
      >
        <option
          v-for="preset in IMAGE_WIDTH_PRESETS"
          :key="preset.label"
          :value="preset.width"
        >
          {{ preset.label }}
        </option>
        <option v-if="(imageState?.width ?? 0) > 0 && !IMAGE_WIDTH_PRESETS.some((p) => p.width === imageState?.width)" :value="imageState?.width">
          {{ imageState?.width }} px
        </option>
      </select>

      <span class="tool-sep" />

      <button type="button" class="tool-btn text-danger" title="Eliminar imagen" @click="deleteImage">
        <Trash2 class="size-4" />
      </button>
    </template>
    <TableInsertMenu :editor="editor" />
    <button type="button" class="tool-btn" title="Línea horizontal" @click="run((c) => c.setHorizontalRule())">
      <Minus class="size-4" />
    </button>
    <button
      v-if="editor?.schema.nodes.pageBreak"
      type="button"
      class="tool-btn"
      title="Insertar salto de página (Ctrl+Enter)"
      @click="run((c) => c.insertPageBreak())"
    >
      <SeparatorHorizontal class="size-4" />
    </button>
    <button type="button" class="tool-btn" title="Quitar formato" @click="run((c) => c.unsetAllMarks().clearNodes())">
      <Eraser class="size-4" />
    </button>

    <template v-if="pageTokens">
      <span class="tool-sep" />
      <span class="mr-1 flex items-center gap-1 text-[11px] font-medium text-ink-subtle">
        <Hash class="size-3.5" />
        Página
      </span>
      <button
        type="button"
        class="tool-btn w-auto px-2 text-[11px] font-medium"
        title="Número de página actual"
        @click="insertPageToken(PAGE_TOKEN)"
      >
        N.º
      </button>
      <button
        type="button"
        class="tool-btn w-auto px-2 text-[11px] font-medium"
        title="Total de páginas"
        @click="insertPageToken(TOTAL_TOKEN)"
      >
        Total
      </button>
      <button
        type="button"
        class="tool-btn w-auto px-2 text-[11px] font-medium"
        title="Insertar «Página 1 de 1»"
        @click="insertPageToken(PAGE_OF_TOTAL)"
      >
        Página X de Y
      </button>
    </template>

    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" @change="onFileSelected" />
  </div>

  <TableToolbar v-if="inlineActive.table" :editor="editor" />
</template>
