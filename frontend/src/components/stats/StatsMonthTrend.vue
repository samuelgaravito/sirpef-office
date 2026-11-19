<script setup lang="ts">
import { computed } from 'vue';

import type { StatsMonthPoint } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    points: StatsMonthPoint[];
    /** Solo los últimos meses, para la tarjeta compacta del chat. */
    limit?: number;
    dark?: boolean;
  }>(),
  { limit: 0, dark: false },
);

const visible = computed(() => {
  const list = props.limit > 0 ? props.points.slice(-props.limit) : props.points;
  return list;
});

const max = computed(() =>
  visible.value.reduce((top, point) => Math.max(top, point.created, point.approved), 0),
);

function height(value: number): string {
  if (max.value <= 0 || value <= 0) return '0%';
  return `${Math.max(3, Math.round((value / max.value) * 100))}%`;
}

function label(month: string): string {
  const [year, number] = month.split('-');
  const name = new Date(Number(year), Number(number) - 1, 1).toLocaleDateString('es-PE', {
    month: 'short',
  });
  return name.replace('.', '');
}
</script>

<template>
  <div>
    <div class="flex h-24 items-end gap-1" role="img" aria-label="Documentos creados y aprobados por mes">
      <div
        v-for="point in visible"
        :key="point.month"
        class="group flex h-full min-w-0 flex-1 items-end justify-center gap-[3px]"
        :title="`${point.month}: ${point.created} creados, ${point.approved} aprobados`"
      >
        <span
          :class="['w-full max-w-[14px] rounded-t-[3px]', dark ? 'bg-[#4e85c8]' : 'bg-accent']"
          :style="{ height: height(point.created) }"
        />
        <span
          :class="['w-full max-w-[14px] rounded-t-[3px]', dark ? 'bg-[#06e3bd]' : 'bg-mint']"
          :style="{ height: height(point.approved) }"
        />
      </div>
    </div>

    <div class="mt-1.5 flex gap-1">
      <span
        v-for="point in visible"
        :key="point.month"
        :class="[
          'min-w-0 flex-1 truncate text-center text-[9.5px]',
          dark ? 'text-white/45' : 'text-ink-subtle',
        ]"
      >
        {{ label(point.month) }}
      </span>
    </div>

    <div
      :class="[
        'mt-2 flex items-center gap-4 text-[10.5px]',
        dark ? 'text-white/55' : 'text-ink-subtle',
      ]"
    >
      <span class="flex items-center gap-1.5">
        <span :class="['size-2 rounded-sm', dark ? 'bg-[#4e85c8]' : 'bg-accent']" />
        Creados
      </span>
      <span class="flex items-center gap-1.5">
        <span :class="['size-2 rounded-sm', dark ? 'bg-[#06e3bd]' : 'bg-mint']" />
        Aprobados
      </span>
    </div>
  </div>
</template>
