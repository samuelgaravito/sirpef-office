<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name?: string;
    src?: string | null;
    size?: 'xs' | 'sm' | 'md' | 'lg';
  }>(),
  { size: 'md' },
);

const sizes = {
  xs: 'size-6 text-[10px]',
  sm: 'size-7 text-[11px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const;

const initials = computed(() =>
  (props.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join(''),
);
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none',
      sizes[size],
      src ? 'bg-surface-hover' : 'bg-accent-soft text-accent',
    ]"
    :title="name"
  >
    <img v-if="src" :src="src" :alt="name ?? 'Avatar'" class="size-full object-cover" />
    <template v-else>{{ initials || '?' }}</template>
  </span>
</template>
