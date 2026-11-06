<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue';
import { animate } from 'motion';
import { useRouter } from 'vue-router';

import { PANEL_CLOSE, PANEL_MODE } from '@/lib/panel';
import {
  enterSurface,
  prefersReducedMotion,
  projectMomentum,
  relativeOrigin,
  rubberband,
  springSnappy,
  type Point,
} from '@/lib/motion';

const props = defineProps<{ label?: string; origin?: Point | null }>();

const router = useRouter();
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const backdrop = ref<HTMLElement | null>(null);
let previousActive: Element | null = null;
let closing = false;

function goHome(): void {
  void router.push({ name: 'home' });
}

/** Cierra con una salida simétrica a la entrada antes de desmontar la ruta. */
function close(): void {
  if (closing) return;
  closing = true;

  const el = panel.value;
  const scrim = backdrop.value;
  if (!el || prefersReducedMotion()) {
    goHome();
    return;
  }

  const tasks: Promise<unknown>[] = [];
  if (scrim) tasks.push(animate(scrim, { opacity: 0 }, { duration: 0.16, ease: 'easeIn' }).finished);
  tasks.push(animate(el, { opacity: 0, scale: 0.96 }, springSnappy).finished);

  void Promise.allSettled(tasks).then(goHome);
}

provide(PANEL_MODE, true);
provide(PANEL_CLOSE, close);

const title = computed(() => 'Módulo');

/* ── Arrastrar hacia abajo para cerrar (móvil) ─────────────────────────── */

let dragging = false;
let pointerId = -1;
let startY = 0;
let currentY = 0;
let lastY = 0;
let lastTime = 0;
let velocity = 0;

function onGrabDown(event: PointerEvent): void {
  if (prefersReducedMotion() || !panel.value) return;
  dragging = true;
  pointerId = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  startY = event.clientY;
  currentY = 0;
  lastY = event.clientY;
  lastTime = performance.now();
  velocity = 0;
}

function onGrabMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== pointerId || !panel.value) return;

  const target = panel.value;
  const height = target.offsetHeight || 600;
  const raw = Math.max(0, event.clientY - startY);
  // 1:1 hasta 90px; a partir de ahí entra la goma elástica.
  currentY = raw <= 90 ? raw : 90 + rubberband(raw - 90, height);

  target.style.transform = `translate3d(0, ${currentY}px, 0)`;
  if (backdrop.value) {
    backdrop.value.style.opacity = String(Math.max(0.06, 1 - currentY / (height * 0.8)));
  }

  const now = performance.now();
  const delta = now - lastTime;
  if (delta > 0) velocity = (event.clientY - lastY) / delta; // px/ms
  lastY = event.clientY;
  lastTime = now;
}

function settleBack(): void {
  if (!panel.value) return;
  animate(panel.value, { y: [currentY, 0] }, { type: 'spring', bounce: 0, duration: 0.32 });
  if (backdrop.value) {
    backdrop.value.style.opacity = '';
    animate(backdrop.value, { opacity: 1 }, { duration: 0.18, ease: 'easeOut' });
  }
}

function dismissFromDrag(): void {
  if (!panel.value || closing) return;
  closing = true;
  const target = panel.value;
  const height = target.offsetHeight || 600;

  const tasks: Promise<unknown>[] = [
    animate(
      target,
      { y: [currentY, height] },
      { type: 'spring', bounce: 0.12, duration: 0.3, velocity: velocity * 1000 },
    ).finished,
  ];
  if (backdrop.value) {
    tasks.push(animate(backdrop.value, { opacity: 0 }, { duration: 0.18 }).finished);
  }

  void Promise.allSettled(tasks).then(goHome);
}

function onGrabUp(event: PointerEvent): void {
  if (!dragging || event.pointerId !== pointerId) return;
  dragging = false;

  const height = panel.value?.offsetHeight || 600;
  const projected = currentY + Math.max(0, projectMomentum(velocity * 1000));
  const shouldClose =
    currentY > height * 0.22 || projected > height * 0.5 || velocity > 0.55;

  if (shouldClose) dismissFromDrag();
  else settleBack();
}

function onGrabCancel(): void {
  if (!dragging) return;
  dragging = false;
  settleBack();
}

/* ── Teclado, foco y ciclo de vida ─────────────────────────────────────── */

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

function onBackdropPointer(event: PointerEvent): void {
  if (event.target === backdrop.value) close();
}

onMounted(() => {
  previousActive = document.activeElement;
  window.addEventListener('keydown', onKeydown);
  document.body.style.overflow = 'hidden';

  const el = panel.value;
  const scrim = backdrop.value;

  if (scrim) {
    if (prefersReducedMotion()) scrim.style.opacity = '1';
    else {
      scrim.style.opacity = '0';
      animate(scrim, { opacity: 1 }, { duration: 0.22, ease: 'easeOut' });
    }
  }

  if (el) {
    const origin = relativeOrigin(el, props.origin ?? null);
    if (origin && !prefersReducedMotion()) {
      el.style.transformOrigin = `${origin.x}px ${origin.y}px`;
    }
    enterSurface(el, { scaleFrom: 0.94, duration: 0.36 });
    const dialog = el.closest<HTMLElement>('[role="dialog"]');
    dialog?.focus();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
  if (previousActive instanceof HTMLElement) previousActive.focus();
});
</script>

<template>
  <div
    ref="backdrop"
    class="fixed inset-0 z-[120] flex items-stretch justify-center bg-navy/45 backdrop-blur-[3px] sm:items-center sm:p-6"
    @pointerdown.self="onBackdropPointer"
  >
    <div
      ref="panel"
      class="relative flex h-full w-full max-w-[1180px] flex-col overflow-hidden border border-hairline bg-canvas shadow-[0_30px_80px_rgb(4_30_66/0.35)] outline-none sm:h-[min(88vh,900px)] sm:rounded-xl"
      role="dialog"
      aria-modal="true"
      :aria-label="label || title"
      tabindex="-1"
      @click.stop
    >
      <span
        class="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-gradient-to-r from-navy via-accent to-mint"
      />

      <!-- Asa de arrastre (solo móvil) -->
      <div
        class="absolute inset-x-0 top-0 z-20 flex h-6 touch-none items-start justify-center pt-1.5 sm:hidden"
        aria-hidden="true"
        @pointerdown="onGrabDown"
        @pointermove="onGrabMove"
        @pointerup="onGrabUp"
        @pointercancel="onGrabCancel"
      >
        <span class="h-1 w-10 rounded-full bg-ink-subtle/45" />
      </div>

      <div ref="root" class="flex min-h-0 flex-1 flex-col">
        <slot />
      </div>
    </div>
  </div>
</template>
