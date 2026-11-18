<script setup lang="ts">
import type { ChainedCommands, Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ImagePlus,
  Layers,
  PanelLeft,
  PanelRight,
  Square,
  Trash2,
} from 'lucide-vue-next';
import { computed, ref, watchEffect } from 'vue';

import { useToast } from '@/composables/useToast';

const props = defineProps<{ editor: Editor | null }>();

const toast = useToast();
const fileInput = ref<HTMLInputElement | null>(null);
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

const imageState = computed(() => {
  void tick.value;
  const editor = props.editor;
  if (!editor || !(editor.state.selection instanceof NodeSelection)) return null;
  if (editor.state.selection.node.type.name !== 'image') return null;
  const attrs = editor.getAttributes('image');
  return {
    float: String(attrs.float ?? 'none'),
    align: String(attrs.align ?? 'center'),
    width: Number(attrs.width) || 0,
    height: Number(attrs.height) || 0,
    alt: String(attrs.alt ?? ''),
  };
});

const IMAGE_WIDTH_PRESETS = [
  { label: 'Automático', width: 0 },
  { label: 'Pequeña', width: 180 },
  { label: 'Mediana', width: 320 },
  { label: 'Grande', width: 480 },
  { label: 'Ancho total', width: -1 },
] as const;

function run(action: (chain: ChainedCommands) => ChainedCommands): void {
  const editor = props.editor;
  if (!editor) return;
  action(editor.chain().focus()).run();
}

function updateImage(values: Record<string, unknown>): void {
  run((chain) => chain.updateAttributes('image', values));
}

function setImageFloat(float: string): void {
  const editor = props.editor;
  if (!editor) return;
  const current = editor.getAttributes('image') ?? {};
  const height = Number(current.height) || 0;

  if (float === 'behind') {
    const dom = editor.view.nodeDOM(editor.state.selection.from) as HTMLElement | null;
    const base = editor.view.dom.getBoundingClientRect();
    if (dom) {
      const rect = dom.getBoundingClientRect();
      updateImage({
        float,
        offsetX: Math.max(0, Math.round(rect.left - base.left)),
        offsetY: Math.max(0, Math.round(rect.top - base.top)),
        height: height || undefined,
      });
      return;
    }
  }

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
  const attrs = editor.getAttributes('image');
  const currentW = Number(attrs.width) || 0;
  const currentH = Number(attrs.height) || 0;
  let height: number | undefined;
  if (currentW > 0 && currentH > 0) {
    height = Math.round((currentH / currentW) * target);
  }
  updateImage({ width: target, height: height ?? null });
}

function editAlt(): void {
  const editor = props.editor;
  if (!editor) return;
  const current = String(editor.getAttributes('image').alt ?? '');
  const alt = window.prompt('Texto alternativo de la imagen', current);
  if (alt === null) return;
  updateImage({ alt: alt.trim() || null });
}

function pickReplacement(): void {
  fileInput.value?.click();
}

function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    toast.error('La imagen supera el máximo de 8 MB');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result ?? '');
    if (src) updateImage({ src });
  };
  reader.readAsDataURL(file);
}

function deleteImage(): void {
  run((chain) => chain.deleteSelection());
}

function shouldShow({ editor }: { editor: Editor }): boolean {
  if (!editor.isEditable) return false;
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === 'image';
}

const buttonClass =
  'tool-btn h-7 w-7 rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink';
</script>

<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    plugin-key="imageBubbleMenu"
    :should-show="shouldShow"
    :options="{ placement: 'top', offset: 8 }"
    class="pointer-events-auto"
  >
    <div
      v-if="imageState"
      data-image-bubble
      class="flex flex-col gap-1 rounded-lg border border-hairline bg-surface p-1.5 shadow-pop"
    >
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          :class="[buttonClass, { 'is-active': imageState.float === 'none' }]"
          title="En línea (sin ajuste de texto)"
          @mousedown.prevent
          @click="setImageFloat('none')"
        >
          <Square class="size-3.5" />
        </button>
        <button
          type="button"
          :class="[buttonClass, { 'is-active': imageState.float === 'left' }]"
          title="Flotar a la izquierda"
          @mousedown.prevent
          @click="setImageFloat('left')"
        >
          <PanelLeft class="size-3.5" />
        </button>
        <button
          type="button"
          :class="[buttonClass, { 'is-active': imageState.float === 'right' }]"
          title="Flotar a la derecha"
          @mousedown.prevent
          @click="setImageFloat('right')"
        >
          <PanelRight class="size-3.5" />
        </button>
        <button
          type="button"
          :class="[buttonClass, { 'is-active': imageState.float === 'behind' }]"
          title="Detrás del texto"
          @mousedown.prevent
          @click="setImageFloat('behind')"
        >
          <Layers class="size-3.5" />
        </button>

        <template v-if="imageState.float === 'none'">
          <span class="mx-1 h-4 w-px bg-hairline" />
          <button
            type="button"
            :class="[buttonClass, { 'is-active': imageState.align === 'left' }]"
            title="Alinear a la izquierda"
            @mousedown.prevent
            @click="updateImage({ align: 'left' })"
          >
            <AlignLeft class="size-3.5" />
          </button>
          <button
            type="button"
            :class="[buttonClass, { 'is-active': imageState.align === 'center' }]"
            title="Centrar imagen"
            @mousedown.prevent
            @click="updateImage({ align: 'center' })"
          >
            <AlignCenter class="size-3.5" />
          </button>
          <button
            type="button"
            :class="[buttonClass, { 'is-active': imageState.align === 'right' }]"
            title="Alinear a la derecha"
            @mousedown.prevent
            @click="updateImage({ align: 'right' })"
          >
            <AlignRight class="size-3.5" />
          </button>
        </template>
      </div>

      <div class="flex items-center gap-1">
        <select
          class="tool-select h-7 w-[112px]"
          :value="IMAGE_WIDTH_PRESETS.find((preset) => preset.width === imageState?.width)?.width ?? imageState?.width ?? 0"
          title="Tamaño de la imagen"
          @change="setImageWidth(Number(($event.target as HTMLSelectElement).value))"
        >
          <option
            v-for="preset in IMAGE_WIDTH_PRESETS"
            :key="preset.label"
            :value="preset.width"
          >
            {{ preset.label }}
          </option>
          <option
            v-if="(imageState?.width ?? 0) > 0 && !IMAGE_WIDTH_PRESETS.some((preset) => preset.width === imageState?.width)"
            :value="imageState?.width"
          >
            {{ imageState?.width }} px
          </option>
        </select>
        <input
          type="number"
          min="20"
          max="1600"
          class="field h-7 w-[72px] !py-0 !text-[11px]"
          :value="imageState?.width || ''"
          placeholder="Ancho"
          title="Ancho exacto en píxeles"
          @change="setImageWidth(Number(($event.target as HTMLInputElement).value) || 0)"
        />
        <button
          type="button"
          :class="buttonClass"
          title="Texto alternativo"
          @mousedown.prevent
          @click="editAlt"
        >
          <ImagePlus class="size-3.5" />
        </button>
        <button
          type="button"
          :class="buttonClass"
          title="Reemplazar imagen"
          @mousedown.prevent
          @click="pickReplacement"
        >
          <ImagePlus class="size-3.5" />
        </button>
        <button
          type="button"
          :class="[buttonClass, 'text-danger']"
          title="Eliminar imagen"
          @mousedown.prevent
          @click="deleteImage"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        class="hidden"
        @change="onFileSelected"
      />
    </div>
  </BubbleMenu>
</template>
