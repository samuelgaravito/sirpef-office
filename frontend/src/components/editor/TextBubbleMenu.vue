<script setup lang="ts">
import type { ChainedCommands, Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import {
  Bold,
  Code,
  Eraser,
  Highlighter,
  Italic,
  Link2,
  Strikethrough,
  Underline,
  Unlink,
} from 'lucide-vue-next';
import { computed, ref, watchEffect } from 'vue';

const props = defineProps<{ editor: Editor | null }>();

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

const active = computed(() => {
  void tick.value;
  const editor = props.editor;
  return {
    bold: editor?.isActive('bold') ?? false,
    italic: editor?.isActive('italic') ?? false,
    underline: editor?.isActive('underline') ?? false,
    strike: editor?.isActive('strike') ?? false,
    code: editor?.isActive('code') ?? false,
    highlight: editor?.isActive('highlight') ?? false,
    link: editor?.isActive('link') ?? false,
  };
});

const currentColor = computed(() => {
  void tick.value;
  const value = props.editor?.getAttributes('textStyle').color;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#1a1f26';
});

const currentHighlight = computed(() => {
  void tick.value;
  const value = props.editor?.getAttributes('highlight').color;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#fff3a3';
});

function run(action: (chain: ChainedCommands) => ChainedCommands): void {
  const editor = props.editor;
  if (!editor) return;
  action(editor.chain().focus()).run();
}

function setColor(event: Event): void {
  run((chain) => chain.setColor((event.target as HTMLInputElement).value));
}

function setHighlight(event: Event): void {
  run((chain) => chain.setHighlight({ color: (event.target as HTMLInputElement).value }));
}

function toggleLink(): void {
  const editor = props.editor;
  if (!editor) return;
  const previous = editor.getAttributes('link').href as string | undefined;
  const href = window.prompt('Dirección del enlace', previous ?? 'https://');
  if (href === null) return;
  if (!href.trim()) {
    run((chain) => chain.extendMarkRange('link').unsetLink());
    return;
  }
  run((chain) => chain.extendMarkRange('link').setLink({ href: href.trim() }));
}

function shouldShow({ editor }: { editor: Editor }): boolean {
  if (!editor.isEditable) return false;
  const { selection } = editor.state;
  if (selection.empty) return false;
  if (selection instanceof NodeSelection) return false;
  if (selection instanceof CellSelection) return false;
  return true;
}

const buttonClass =
  'tool-btn h-7 w-7 rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink';
</script>

<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    plugin-key="textBubbleMenu"
    :should-show="shouldShow"
    :options="{ placement: 'top', offset: 8 }"
    class="pointer-events-auto"
  >
    <div
      data-text-bubble
      class="flex items-center gap-0.5 rounded-lg border border-hairline bg-surface p-1 shadow-pop"
    >
      <button
        type="button"
        :class="[buttonClass, { 'is-active': active.bold }]"
        title="Negrita (Ctrl+B)"
        @mousedown.prevent
        @click="run((chain) => chain.toggleBold())"
      >
        <Bold class="size-3.5" />
      </button>
      <button
        type="button"
        :class="[buttonClass, { 'is-active': active.italic }]"
        title="Cursiva (Ctrl+I)"
        @mousedown.prevent
        @click="run((chain) => chain.toggleItalic())"
      >
        <Italic class="size-3.5" />
      </button>
      <button
        type="button"
        :class="[buttonClass, { 'is-active': active.underline }]"
        title="Subrayado (Ctrl+U)"
        @mousedown.prevent
        @click="run((chain) => chain.toggleUnderline())"
      >
        <Underline class="size-3.5" />
      </button>
      <button
        type="button"
        :class="[buttonClass, { 'is-active': active.strike }]"
        title="Tachado"
        @mousedown.prevent
        @click="run((chain) => chain.toggleStrike())"
      >
        <Strikethrough class="size-3.5" />
      </button>
      <button
        type="button"
        :class="[buttonClass, { 'is-active': active.code }]"
        title="Código en línea"
        @mousedown.prevent
        @click="run((chain) => chain.toggleCode())"
      >
        <Code class="size-3.5" />
      </button>

      <span class="mx-1 h-4 w-px bg-hairline" />

      <label class="tool-btn relative h-7 w-7 cursor-pointer rounded-md" title="Color de texto">
        <span class="text-[13px] font-bold">A</span>
        <span
          class="absolute bottom-1 left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full"
          :style="{ background: currentColor }"
        />
        <input
          type="color"
          class="absolute inset-0 cursor-pointer opacity-0"
          :value="currentColor"
          @input="setColor"
        />
      </label>
      <label
        :class="[buttonClass, 'relative cursor-pointer', { 'is-active': active.highlight }]"
        title="Resaltado"
      >
        <Highlighter class="size-3.5" />
        <span
          class="absolute bottom-1 left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full"
          :style="{ background: currentHighlight }"
        />
        <input
          type="color"
          class="absolute inset-0 cursor-pointer opacity-0"
          :value="currentHighlight"
          @input="setHighlight"
        />
      </label>

      <span class="mx-1 h-4 w-px bg-hairline" />

      <button
        type="button"
        :class="[buttonClass, { 'is-active': active.link }]"
        title="Editar enlace"
        @mousedown.prevent
        @click="toggleLink"
      >
        <Link2 class="size-3.5" />
      </button>
      <button
        v-if="active.link"
        type="button"
        :class="buttonClass"
        title="Quitar enlace"
        @mousedown.prevent
        @click="run((chain) => chain.extendMarkRange('link').unsetLink())"
      >
        <Unlink class="size-3.5" />
      </button>
      <button
        type="button"
        :class="buttonClass"
        title="Limpiar formato"
        @mousedown.prevent
        @click="run((chain) => chain.unsetAllMarks())"
      >
        <Eraser class="size-3.5" />
      </button>
    </div>
  </BubbleMenu>
</template>
