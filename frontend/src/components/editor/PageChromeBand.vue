<script setup lang="ts">
import { EditorContent, type Editor } from '@tiptap/vue-3';
import { PanelBottom, PanelTop, RotateCcw } from 'lucide-vue-next';
import { computed } from 'vue';

import { bandImageStyleMm } from '@/lib/band-images';
import { clampChromeWidth } from '@sirpefoffice/shared';
import type { ChromeConfig, ChromeSource } from '@sirpefoffice/shared';

const props = defineProps<{
  kind: 'header' | 'footer';
  editor: Editor | null;
  config: ChromeConfig | null;
  source: ChromeSource;
  /** La banda está personalizada en el nivel que se está editando. */
  own?: boolean;
  editable: boolean;
  active: boolean;
  /**
   * Muestra la barra de controles. En documentos y plantillas se oculta
   * cuando no se está editando la cabecera/pie, pero la banda sigue visible.
   */
  showBar?: boolean;
}>();

const emit = defineEmits<{
  toggle: [enabled: boolean];
  height: [heightMm: number];
  width: [widthPercent: number];
  reset: [];
}>();

const label = computed(() => (props.kind === 'header' ? 'Cabecera' : 'Pie de página'));
const barVisible = computed(() => props.showBar !== false);
const isOwn = computed(() => props.own ?? props.source === 'document');
const sourceLabel = computed(() =>
  isOwn.value
    ? 'Personalizado'
    : `Heredado de ${props.source === 'template' ? 'la plantilla' : 'el diseño'}`,
);
const heightValue = computed(() => Math.round((props.config?.heightMm ?? 16) * 10) / 10);
const widthValue = computed(() => clampChromeWidth(props.config?.widthPercent));

function onHeight(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  emit('height', Number.isFinite(value) ? value : 16);
}

function onWidth(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  emit('width', clampChromeWidth(Number.isFinite(value) ? value : 100));
}
</script>

<template>
  <section
    :class="[
      'wp-chrome-band',
      `wp-chrome-band--${kind}`,
      { 'is-active': active, 'is-preview': !barVisible },
    ]"
  >
    <div v-if="barVisible" class="wp-chrome-band__bar">
      <span class="wp-chrome-band__title">
        <component :is="kind === 'header' ? PanelTop : PanelBottom" class="size-3.5" />
        {{ label }}
      </span>

      <span :class="['wp-chrome-band__source', isOwn ? 'is-own' : '']">
        {{ sourceLabel }}
      </span>

      <label class="wp-chrome-band__check" title="Mostrar u ocultar esta banda en la exportación">
        <input
          type="checkbox"
          :checked="config?.enabled ?? false"
          :disabled="!editable"
          @change="emit('toggle', ($event.target as HTMLInputElement).checked)"
        />
        Mostrar
      </label>

      <label class="wp-chrome-band__height" title="Alto reservado en la página">
        Alto
        <input
          type="number"
          min="5"
          max="80"
          step="1"
          :value="heightValue"
          :disabled="!editable"
          @change="onHeight"
        />
        mm
      </label>

      <label
        class="wp-chrome-band__width"
        title="Ancho de la banda respecto al ancho de la página (100 % = toda la hoja)"
      >
        Ancho
        <input
          type="range"
          min="20"
          max="100"
          step="1"
          :value="widthValue"
          :disabled="!editable"
          @input="onWidth"
        />
        <span>{{ widthValue }}%</span>
      </label>

      <button
        v-if="isOwn"
        type="button"
        class="wp-chrome-band__reset"
        :disabled="!editable"
        title="Quitar la personalización y volver a heredar"
        @click.stop="emit('reset')"
      >
        <RotateCcw class="size-3" />
        Usar el heredado
      </button>
    </div>

    <div
      :class="['wp-chrome-band__surface', { 'is-disabled': !config?.enabled }]"
      :style="{
        position: 'relative',
        minHeight: `${config?.heightMm ?? 16}mm`,
        width: `${widthValue}%`,
        marginLeft: 'auto',
        marginRight: 'auto',
      }"
    >
      <EditorContent :editor="editor ?? undefined" />
      <img
        v-for="image in config?.enabled ? (config.images ?? []) : []"
        :key="image.id"
        :src="image.src"
        alt=""
        class="pointer-events-none"
        :style="bandImageStyleMm(image)"
      />
      <p v-if="!config?.enabled" class="wp-chrome-band__off">Banda oculta</p>
    </div>
  </section>
</template>
