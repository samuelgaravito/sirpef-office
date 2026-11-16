<script setup lang="ts">
import { computed } from 'vue';

import type { StatsMonthPoint } from '@sirpefoffice/shared';

const props = defineProps<{ points: StatsMonthPoint[] }>();

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const maxValue = computed(() =>
  Math.max(1, ...props.points.map((point) => Math.max(point.created, point.approved))),
);

const totalCreated = computed(() => props.points.reduce((sum, point) => sum + point.created, 0));
const totalApproved = computed(() => props.points.reduce((sum, point) => sum + point.approved, 0));

const ariaLabel = computed(
  () =>
    `Últimos doce meses: ${totalCreated.value} documentos creados y ${totalApproved.value} aprobados.`,
);

function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_LABELS[index] ?? month;
}

function barHeight(value: number): string {
  if (value <= 0) return '0%';
  return `${Math.max(5, Math.round((value / maxValue.value) * 100))}%`;
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2 rounded-full bg-[#4e85c8]" aria-hidden="true" />
        Creados <strong class="font-semibold text-ink">{{ totalCreated }}</strong>
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2 rounded-full bg-[#06b89b]" aria-hidden="true" />
        Aprobados <strong class="font-semibold text-ink">{{ totalApproved }}</strong>
      </span>
    </div>

    <div class="mt-3 flex h-36 items-end gap-1" role="img" :aria-label="ariaLabel">
      <div
        v-for="point in points"
        :key="point.month"
        class="flex h-full min-w-0 flex-1 flex-col justify-end"
      >
        <div class="flex h-full items-end justify-center gap-[3px]">
          <span
            class="trend-bar w-1/3 max-w-[9px] rounded-t bg-[#4e85c8]"
            :style="{ height: barHeight(point.created) }"
            :title="`${monthLabel(point.month)}: ${point.created} creados`"
          />
          <span
            class="trend-bar w-1/3 max-w-[9px] rounded-t bg-[#06b89b]"
            :style="{ height: barHeight(point.approved) }"
            :title="`${monthLabel(point.month)}: ${point.approved} aprobados`"
          />
        </div>
        <span class="mt-1.5 text-center text-[10px] text-ink-subtle">
          {{ monthLabel(point.month) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trend-bar {
  transition: height 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .trend-bar {
    transition: none;
  }
}
</style>
