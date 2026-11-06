<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue';
import { useRouter } from 'vue-router';

import { PANEL_CLOSE, PANEL_MODE } from '@/lib/panel';

defineProps<{ label?: string }>();

const router = useRouter();
const root = ref<HTMLElement | null>(null);
let previousActive: Element | null = null;

function close(): void {
  void router.push({ name: 'home' });
}

provide(PANEL_MODE, true);
provide(PANEL_CLOSE, close);

const title = computed(() => 'Módulo');

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }

  // Foco atrapado dentro del panel mientras está abierto.
  if (event.key !== 'Tab' || !root.value) return;
  const focusables = root.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!first || !last) return;
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}

onMounted(() => {
  previousActive = document.activeElement;
  window.addEventListener('keydown', onKeydown);
  document.body.style.overflow = 'hidden';
  const dialog = root.value?.closest<HTMLElement>('[role="dialog"]');
  dialog?.focus();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
  if (previousActive instanceof HTMLElement) previousActive.focus();
});
</script>

<template>
  <div
    class="fixed inset-0 z-[120] flex items-stretch justify-center bg-navy/45 backdrop-blur-[3px] sm:items-center sm:p-6"
    @mousedown.self="close"
  >
    <div
      class="panel-in relative flex h-full w-full max-w-[1180px] flex-col overflow-hidden border border-hairline bg-canvas shadow-[0_30px_80px_rgb(4_30_66/0.35)] outline-none sm:h-[min(88vh,900px)] sm:rounded-xl"
      role="dialog"
      aria-modal="true"
      :aria-label="label || title"
      tabindex="-1"
      @click.stop
    >
      <span
        class="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-gradient-to-r from-navy via-accent to-mint"
      />
      <div ref="root" class="flex min-h-0 flex-1 flex-col">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-in {
  animation: panel-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .panel-in {
    animation: none;
  }
}
</style>
