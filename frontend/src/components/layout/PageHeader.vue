<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { inject } from 'vue';

import { PANEL_CLOSE, PANEL_MODE } from '@/lib/panel';

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    sticky?: boolean;
  }>(),
  { sticky: false },
);

const embedded = inject(PANEL_MODE, false);
const closePanel = inject(PANEL_CLOSE, null);
</script>

<template>
  <div
    :class="[
      'flex flex-wrap items-end justify-between gap-3 bg-canvas/85 px-5 pb-4 pt-6 backdrop-blur sm:px-8',
      sticky || embedded ? 'sticky top-0 z-20 border-b border-hairline' : '',
    ]"
  >
    <div class="min-w-0">
      <h1 class="truncate text-[22px] font-semibold tracking-tight text-ink">{{ title }}</h1>
      <p v-if="subtitle" class="text-description mt-1">{{ subtitle }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
      <button
        v-if="embedded && closePanel"
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-field border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        aria-label="Cerrar panel"
        @click="closePanel()"
      >
        <X class="size-4" />
      </button>
    </div>
  </div>
</template>
