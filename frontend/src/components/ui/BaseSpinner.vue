<script setup lang="ts">
withDefaults(defineProps<{ label?: string; size?: 'sm' | 'md' }>(), { size: 'md' });
</script>

<template>
  <span class="inline-flex items-center gap-2 text-[13px] text-ink-muted">
    <span
      :class="[
        'animate-spin rounded-full border-2 border-hairline-strong border-t-accent',
        size === 'sm' ? 'size-3.5' : 'size-4',
      ]"
    />
    <span v-if="label">{{ label }}</span>
  </span>
</template>
