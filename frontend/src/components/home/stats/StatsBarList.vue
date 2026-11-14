<script setup lang="ts">
import { computed } from 'vue';

import type { StatsBarItem } from './types';

const props = withDefaults(
  defineProps<{
    items: StatsBarItem[];
    emptyText?: string;
    /** Convierte cada fila en un botón que emite `select`. */
    interactive?: boolean;
  }>(),
  { emptyText: 'Sin datos en este periodo', interactive: false },
);

const emit = defineEmits<{ select: [key: string] }>();

const total = computed(() => props.items.reduce((sum, item) => sum + item.count, 0));

function percent(count: number): number {
  if (total.value <= 0) return 0;
  return Math.round((count / total.value) * 100);
}

function width(count: number): string {
  if (total.value <= 0 || count <= 0) return '0%';
  return `${Math.max(2, Math.round((count / total.value) * 100))}%`;
}
</script>

<template>
  <div>
    <ul v-if="items.length > 0" class="space-y-2.5">
      <li v-for="item in items" :key="item.key">
        <component
          :is="interactive ? 'button' : 'div'"
          :type="interactive ? 'button' : undefined"
          class="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md text-left"
          :class="
            interactive
              ? 'group -mx-1 cursor-pointer px-1 py-0.5 transition-colors hover:bg-surface-muted/70'
              : ''
          "
          :aria-label="interactive ? `Ver los documentos de ${item.label}` : undefined"
          @click="interactive && emit('select', item.key)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="size-2 shrink-0 rounded-full"
              :style="{ backgroundColor: item.color }"
              aria-hidden="true"
            />
            <span
              class="truncate text-[13px] text-ink-muted transition-colors group-hover:text-accent"
            >
              {{ item.label }}
            </span>
            <span
              v-if="item.badge"
              class="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10.5px] font-medium text-ink-subtle"
            >
              {{ item.badge }}
            </span>
          </span>
          <span class="flex items-baseline justify-end gap-2 tabular-nums">
            <span class="min-w-[2ch] text-right text-[12.5px] font-semibold text-ink">
              {{ item.count }}
            </span>
            <span class="min-w-[3.5ch] text-right text-[11.5px] font-medium text-ink-subtle">
              {{ percent(item.count) }} %
            </span>
          </span>
          <span
            class="col-span-2 mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-muted"
            aria-hidden="true"
          >
            <span
              class="bar block h-full rounded-full"
              :style="{ width: width(item.count), backgroundColor: item.color }"
            />
          </span>
        </component>
      </li>
    </ul>
    <p v-else class="text-description">{{ emptyText }}</p>
  </div>
</template>

<style scoped>
.bar {
  transition: width 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .bar {
    transition: none;
  }
}
</style>
