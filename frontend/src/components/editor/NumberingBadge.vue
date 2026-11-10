<script setup lang="ts">
import { Clock, Hash, MinusCircle } from 'lucide-vue-next';
import { computed } from 'vue';

import { NUMBERING_MESSAGES, type NumberingPreview } from '@sirpefoffice/shared';

/**
 * Muestra el número del documento y, cuando aún no se ha oficializado, el
 * número previsto con una explicación clara de cuándo se asigna.
 */
const props = withDefaults(
  defineProps<{
    /** Número ya asignado (documento oficializado). */
    docNumber?: string | null;
    /** Número previsto, con los datos de la serie. */
    numbering?: NumberingPreview | null;
    /** Mientras se calcula el previsto. */
    loading?: boolean;
    /** `chip` = solo la etiqueta; `full` = etiqueta + explicación. */
    variant?: 'chip' | 'full';
  }>(),
  {
    docNumber: null,
    numbering: null,
    loading: false,
    variant: 'chip',
  },
);

type BadgeState = 'assigned' | 'pending' | 'calculating' | 'disabled';

const state = computed<BadgeState>(() => {
  if (props.docNumber) return 'assigned';
  if (props.loading && !props.numbering) return 'calculating';
  if (props.numbering) return 'pending';
  return 'disabled';
});

const chipClass = computed(() => {
  if (state.value === 'assigned') return 'chip !bg-accent-soft !text-accent';
  if (state.value === 'pending') return 'chip chip-pending';
  return 'chip';
});

const label = computed(() => {
  if (state.value === 'assigned') return props.docNumber ?? '';
  if (state.value === 'pending') return props.numbering?.number ?? '';
  if (state.value === 'calculating') return NUMBERING_MESSAGES.calculating;
  return NUMBERING_MESSAGES.disabled;
});

const hint = computed(() =>
  state.value === 'pending' ? NUMBERING_MESSAGES.pendingChip : '',
);

const tooltip = computed(() => {
  if (state.value === 'assigned') {
    return 'También disponible en el documento como {{numero_documento}}';
  }
  if (state.value === 'pending') {
    return [
      NUMBERING_MESSAGES.pendingHint,
      props.numbering?.seriesLabel,
      NUMBERING_MESSAGES.pendingWarning,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (state.value === 'disabled') return 'Esta plantilla no asigna número correlativo.';
  return '';
});

const detailLine = computed(() =>
  state.value === 'pending' && props.numbering
    ? `${props.numbering.seriesLabel} · ${NUMBERING_MESSAGES.pendingWarningShort}`
    : '',
);
</script>

<template>
  <div v-if="variant === 'full'" class="flex min-w-0 flex-col gap-0.5">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span :class="[chipClass, 'inline-flex items-center gap-1']" :title="tooltip">
        <Clock v-if="state === 'pending'" class="size-3" />
        <Hash v-else-if="state === 'assigned'" class="size-3" />
        <MinusCircle v-else-if="state === 'disabled'" class="size-3" />
        {{ label }}
      </span>
      <span v-if="hint" class="text-[11px] text-ink-subtle">{{ hint }}</span>
    </div>
    <p v-if="detailLine" class="text-[11px] text-ink-subtle">{{ detailLine }}</p>
  </div>

  <span v-else :class="[chipClass, 'inline-flex items-center gap-1']" :title="tooltip">
    <Clock v-if="state === 'pending'" class="size-3" />
    <Hash v-else-if="state === 'assigned'" class="size-3" />
    <MinusCircle v-else-if="state === 'disabled'" class="size-3" />
    {{ label }}
  </span>
</template>
