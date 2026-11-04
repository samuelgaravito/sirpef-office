<script setup lang="ts">
import { CheckCircle2, Info, X, XCircle } from 'lucide-vue-next';

import { useToast } from '@/composables/useToast';

const { items, dismiss } = useToast();

const styles = {
  success: 'border-success/25 bg-success-soft text-success',
  error: 'border-danger/25 bg-danger-soft text-danger',
  info: 'border-accent/20 bg-accent-soft text-accent',
} as const;
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-for="toast in items"
        :key="toast.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-pop"
      >
        <span :class="['mt-0.5 shrink-0 rounded-full p-1', styles[toast.kind]]">
          <CheckCircle2 v-if="toast.kind === 'success'" class="size-4" />
          <XCircle v-else-if="toast.kind === 'error'" class="size-4" />
          <Info v-else class="size-4" />
        </span>
        <p class="flex-1 text-[13px] leading-snug text-ink">{{ toast.message }}</p>
        <button
          type="button"
          class="rounded p-1 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
          aria-label="Cerrar notificación"
          @click="dismiss(toast.id)"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
