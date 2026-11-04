<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    sticky?: boolean;
  }>(),
  { sticky: false },
);
</script>

<template>
  <div
    :class="[
      'flex flex-wrap items-end justify-between gap-3 bg-canvas/85 px-5 pb-4 pt-6 backdrop-blur sm:px-8',
      sticky ? 'sticky top-0 z-20 border-b border-hairline' : '',
    ]"
  >
    <div class="min-w-0">
      <h1 class="truncate text-[22px] font-semibold tracking-tight text-ink">{{ title }}</h1>
      <p v-if="subtitle" class="mt-1 text-[13px] text-ink-muted">{{ subtitle }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
