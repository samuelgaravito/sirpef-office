<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(
  defineProps<{
    icon?: Component;
    title: string;
    description?: string;
    compact?: boolean;
  }>(),
  { compact: false },
);
</script>

<template>
  <div
    :class="[
      'flex flex-col items-center justify-center rounded-card border border-dashed border-hairline-strong bg-surface/60 text-center',
      compact ? 'px-4 py-8' : 'px-6 py-14',
    ]"
  >
    <span v-if="icon" class="mb-3 grid size-11 place-items-center rounded-full bg-surface-muted text-ink-subtle">
      <component :is="icon" class="size-5" />
    </span>
    <p class="text-[14px] font-medium text-ink">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-[12.5px] text-ink-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
