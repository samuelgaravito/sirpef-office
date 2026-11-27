<script setup lang="ts">
import { renderToHTMLString } from '@tiptap/static-renderer';
import { computed } from 'vue';

import { bandImageStyleMm } from '@/lib/band-images';
import { chromeBandHeightMm, clampChromeWidth, editorExtensions, interpolateSimpleContent, withEmptyParagraphHeights } from '@sirpefoffice/shared';
import type { ChromeConfig, ChromeKind, VariableValues } from '@sirpefoffice/shared';

const props = defineProps<{
  kind: ChromeKind;
  config: ChromeConfig;
  pageNumber: number;
  pageCount: number;
  values?: VariableValues;
}>();

const width = computed(() => clampChromeWidth(props.config.widthPercent));
const images = computed(() => (props.config.enabled ? (props.config.images ?? []) : []));

/**
 * Render estático de una banda para las páginas que no están en edición.
 * Sustituye los tokens de numeración por la página real.
 */
const html = computed(() => {
  if (!props.config.enabled) return '';

  const rendered = renderToHTMLString({
    content: interpolateSimpleContent(props.config.content, props.values ?? {}) as never,
    extensions: editorExtensions,
  });

  return withEmptyParagraphHeights(
    rendered
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/\son\w+='[^']*'/gi, '')
      .replace(/href="javascript:[^"]*"/gi, 'href="#"')
      .replace(/\{page\}/g, String(props.pageNumber))
      .replace(/\{total\}/g, String(props.pageCount)),
  );
});
</script>

<template>
  <section
    v-if="config.enabled"
    :class="['wp-chrome-band', `wp-chrome-band--${kind}`, 'is-preview']"
  >
    <div
      class="wp-chrome-band__surface"
      :style="{
        minHeight: `${chromeBandHeightMm(config, kind)}mm`,
        width: `${width}%`,
        marginLeft: 'auto',
        marginRight: 'auto',
      }"
    >
      <div class="tiptap" v-html="html" />
      <img
        v-for="image in images"
        :key="image.id"
        :src="image.src"
        alt=""
        class="pointer-events-none"
        :style="bandImageStyleMm(image)"
      />
    </div>
  </section>
</template>
