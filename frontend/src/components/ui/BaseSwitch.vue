<script setup lang="ts">
/**
 * Interruptor (estilo iOS): una píldora con un botón circular que se desliza.
 *
 * Se usa como `v-model`:
 *   <BaseSwitch v-model="value" label="En uso" />
 */
const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    /** Texto accesible del interruptor. */
    label?: string;
    disabled?: boolean;
  }>(),
  { modelValue: false, label: '', disabled: false },
);

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

function toggle(): void {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label || undefined"
    :disabled="disabled"
    :class="[
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent',
      'transition-colors duration-300 ease-out',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
      modelValue ? 'bg-[var(--color-accent)]' : 'bg-[#c9ccd4]',
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:brightness-95 active:brightness-90',
    ]"
    @click="toggle"
  >
    <span
      aria-hidden="true"
      :class="[
        'pointer-events-none absolute left-0.5 size-5 rounded-full bg-white',
        'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
        'active:scale-95',
        modelValue
          ? 'translate-x-5 shadow-[0_2px_6px_rgba(15,23,42,0.35)]'
          : 'translate-x-0 shadow-[0_1px_3px_rgba(15,23,42,0.28)]',
      ]"
    />
  </button>
</template>
