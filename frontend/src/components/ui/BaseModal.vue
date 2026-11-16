<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { isTopModal, registerModal, unregisterModal } from '@/lib/modal-stack';
import { lockScroll, unlockScroll } from '@/lib/scroll-lock';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    closeOnBackdrop?: boolean;
    /** Al abrir, lleva el foco al botón de cerrar (útil en modales anidados). */
    autoFocusClose?: boolean;
  }>(),
  { size: 'md', closeOnBackdrop: true, autoFocusClose: false },
);

const emit = defineEmits<{ close: [] }>();

/** Identidad estable para saber si este modal es el superior de la pila. */
const modalId = Symbol('base-modal');
const card = ref<HTMLElement | null>(null);

const widths = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
} as const;

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !props.open) return;
  // Solo cierra el modal superior: si hay un detalle encima, el panel de
  // debajo no debe cerrarse también.
  if (!isTopModal(modalId)) return;
  // Evita que el panel que lo contiene también se cierre al propagarse el
  // evento hasta su listener de `window`.
  event.stopPropagation();
  emit('close');
}

let scrollLocked = false;

function setScrollLocked(locked: boolean): void {
  if (locked === scrollLocked) return;
  scrollLocked = locked;
  if (locked) lockScroll();
  else unlockScroll();
}

watch(
  () => props.open,
  async (open) => {
    setScrollLocked(open);
    if (!open) {
      unregisterModal(modalId);
      return;
    }

    registerModal(modalId);
    if (props.autoFocusClose) {
      await nextTick();
      card.value?.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')?.focus();
    }
  },
  { immediate: true },
);

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  unregisterModal(modalId);
  setScrollLocked(false);
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-120 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <!-- Capas: ModulePanel 120 < BaseModal 130 < CommandPalette 140 < ToastHost 150 -->
      <div
        v-if="open"
        class="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-[#0b1220]/45 p-4 sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        @mousedown.self="closeOnBackdrop && emit('close')"
      >
        <div
          ref="card"
          :class="[
            'card flex max-h-[calc(100vh-2rem)] w-full flex-col sm:max-h-[calc(100vh-3rem)]',
            widths[size],
          ]"
          role="document"
        >
          <header
            v-if="title || $slots.header"
            class="flex shrink-0 items-start justify-between gap-4 border-b border-hairline px-5 py-4"
          >
            <div class="min-w-0">
              <slot name="header">
                <h2 class="truncate text-[17px] font-semibold text-ink">{{ title }}</h2>
                <p v-if="description" class="text-description mt-0.5">{{ description }}</p>
              </slot>
            </div>
            <button
              type="button"
              class="-mr-1 rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
              aria-label="Cerrar"
              @click="emit('close')"
            >
              <X class="size-4" />
            </button>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="flex shrink-0 items-center justify-end gap-2 border-t border-hairline bg-surface-muted/60 px-5 py-3"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
