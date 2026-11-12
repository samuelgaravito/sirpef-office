<script setup lang="ts">
import { Bell, BellOff, BellRing, X } from 'lucide-vue-next';

import { useNotifications } from '@/composables/useNotifications';
import type { BellTone } from '@/composables/useNotifications';

const {
  bellVisible,
  bellCount,
  bellTitle,
  bellDetail,
  bellTone,
  permission,
  muted,
  supported,
  pause,
  resume,
  dismiss,
  openInbox,
  requestPermission,
  toggleMuted,
} = useNotifications();

const toneStyles: Record<BellTone, string> = {
  info: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
};
</script>

<template>
  <Transition
    enter-active-class="transition duration-250 ease-out"
    enter-from-class="-translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-3 opacity-0"
  >
    <div
      v-if="bellVisible"
      class="fixed right-4 top-[76px] z-[145] w-[min(92vw,340px)] sm:right-6"
      role="status"
      aria-live="polite"
      @mouseenter="pause"
      @mouseleave="resume"
      @focusin="pause"
      @focusout="resume"
    >
      <div
        class="flex items-start gap-3 rounded-2xl border border-hairline bg-surface/95 p-3.5 shadow-pop backdrop-blur-md"
      >
        <span
          :class="[
            'relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-full',
            toneStyles[bellTone],
          ]"
        >
          <Bell class="size-4" />
          <span
            v-if="bellCount > 1"
            class="absolute -right-1 -top-1 grid min-w-[16px] place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-[16px] text-white ring-2 ring-surface"
          >
            {{ bellCount > 9 ? '9+' : bellCount }}
          </span>
        </span>

        <button type="button" class="min-w-0 flex-1 text-left" @click="openInbox">
          <p class="truncate text-[13px] font-semibold text-ink">{{ bellTitle }}</p>
          <p class="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-muted">
            {{ bellDetail }}
          </p>
        </button>

        <button
          type="button"
          class="rounded p-1 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
          aria-label="Cerrar aviso"
          @click="dismiss"
        >
          <X class="size-3.5" />
        </button>
      </div>

      <div v-if="supported" class="mt-1.5 flex justify-end">
        <button
          v-if="permission === 'default'"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-hover"
          @click="requestPermission"
        >
          <BellRing class="size-3" />
          Activar avisos del sistema
        </button>
        <button
          v-else-if="permission === 'granted'"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-hover"
          @click="toggleMuted"
        >
          <component :is="muted ? BellOff : Bell" class="size-3" />
          {{ muted ? 'Reactivar avisos' : 'Silenciar avisos' }}
        </button>
        <span v-else class="text-[11px] text-ink-subtle">
          Avisos del sistema bloqueados en este navegador
        </span>
      </div>
    </div>
  </Transition>
</template>
