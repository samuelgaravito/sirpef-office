<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    closeOnBackdrop?: boolean;
  }>(),
  { size: 'md', closeOnBackdrop: true },
);

const emit = defineEmits<{ close: [] }>();

const widths = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
} as const;

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close');
}

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
  },
);

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
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
      <div
        v-if="open"
        class="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-[#0b1220]/45 p-4 sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        @mousedown.self="closeOnBackdrop && emit('close')"
      >
        <div :class="['card w-full', widths[size]]" role="document">
          <header
            v-if="title || $slots.header"
            class="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4"
          >
            <div class="min-w-0">
              <slot name="header">
                <h2 class="truncate text-[15px] font-semibold text-ink">{{ title }}</h2>
                <p v-if="description" class="mt-0.5 text-xs text-ink-muted">{{ description }}</p>
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

          <div class="px-5 py-4">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="flex items-center justify-end gap-2 border-t border-hairline bg-surface-muted/60 px-5 py-3"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
