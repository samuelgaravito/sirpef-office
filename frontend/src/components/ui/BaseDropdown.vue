<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    align?: 'left' | 'right';
    width?: string;
    panelClass?: string;
    /** Las propiedades interactivas (color, inputs) no deben cerrar el panel. */
    closeOnClick?: boolean;
    /** Fuerza la apertura hacia arriba/abajo. `auto` decide según el espacio disponible. */
    side?: 'auto' | 'top' | 'bottom';
  }>(),
  { align: 'left', width: 'w-56', closeOnClick: true, side: 'auto' },
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const placement = ref<'top' | 'bottom'>('bottom');

const resolvedSide = computed(() => (props.side === 'auto' ? placement.value : props.side));

function close(): void {
  open.value = false;
  removeViewportListeners();
}

function onDocumentClick(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

/**
 * Coloca el panel arriba si no cabe debajo del disparador y hay más espacio arriba.
 * Usa la ventana como referencia porque el panel es `position: absolute` y no debe
 * quedar recortado por los contenedores con scroll.
 */
function updatePlacement(): void {
  if (!open.value || props.side !== 'auto') return;

  const trigger = root.value;
  const menu = panel.value;
  if (!trigger || !menu) return;

  const rect = trigger.getBoundingClientRect();
  const gap = 6; // mt-1.5 / mb-1.5
  const margin = 8;
  const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;

  placement.value = menu.offsetHeight > spaceBelow && spaceAbove > spaceBelow ? 'top' : 'bottom';
}

function addViewportListeners(): void {
  window.addEventListener('resize', updatePlacement);
  window.addEventListener('scroll', updatePlacement, true);
}

function removeViewportListeners(): void {
  window.removeEventListener('resize', updatePlacement);
  window.removeEventListener('scroll', updatePlacement, true);
}

async function toggle(): Promise<void> {
  if (open.value) {
    close();
    return;
  }

  placement.value = 'bottom';
  open.value = true;
  addViewportListeners();
  await nextTick();
  updatePlacement();
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
  removeViewportListeners();
});

defineExpose({ close, open });
</script>

<template>
  <div ref="root" class="relative">
    <div @click="toggle">
      <slot name="trigger" :open="open" />
    </div>

    <Transition
      enter-active-class="transition duration-120 ease-out"
      enter-from-class="translate-y-1 scale-[0.98] opacity-0"
      enter-to-class="translate-y-0 scale-100 opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        ref="panel"
        :class="[
          'absolute z-50 overflow-hidden rounded-xl border border-hairline bg-surface p-1 shadow-pop',
          width,
          align === 'right' ? 'right-0' : 'left-0',
          resolvedSide === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          panelClass,
        ]"
        @click="closeOnClick && close()"
      >
        <slot name="content" />
      </div>
    </Transition>
  </div>
</template>
