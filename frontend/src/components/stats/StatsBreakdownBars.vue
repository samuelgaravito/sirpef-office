<script setup lang="ts">
import { computed } from 'vue';

import type { StatsBreakdownItem } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    items: StatsBreakdownItem[];
    color?: string;
    clickable?: boolean;
    dark?: boolean;
  }>(),
  { color: '#4e85c8', clickable: false, dark: false },
);

const emit = defineEmits<{ select: [key: string] }>();

const total = computed(() => props.items.reduce((sum, item) => sum + item.count, 0));

function width(count: number): string {
  if (total.value <= 0 || count <= 0) return '0%';
  return `${Math.max(2, Math.round((count / total.value) * 100))}%`;
}
</script>

<template>
  <ul class="space-y-1.5">
    <li v-for="item in items" :key="item.key">
      <button
        type="button"
        :disabled="!clickable"
        :class="[
          'flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors',
          clickable
            ? dark
              ? 'hover:bg-white/10'
              : 'hover:bg-surface-hover'
            : 'cursor-default',
        ]"
        @click="clickable && emit('select', item.key)"
      >
        <span
          :class="[
            'w-28 shrink-0 truncate text-[12px]',
            dark ? 'text-white/70' : 'text-ink-muted',
          ]"
          :title="item.label"
        >
          {{ item.label }}
        </span>
        <span
          :class="['relative h-2 flex-1 overflow-hidden rounded-full', dark ? 'bg-white/10' : 'bg-surface-hover']"
          aria-hidden="true"
        >
          <span
            class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
            :style="{ width: width(item.count), backgroundColor: color }"
          />
        </span>
        <span
          :class="[
            'w-8 shrink-0 text-right text-[12px] font-medium tabular-nums',
            dark ? 'text-white' : 'text-ink',
          ]"
        >
          {{ item.count }}
        </span>
      </button>
    </li>
  </ul>
</template>
