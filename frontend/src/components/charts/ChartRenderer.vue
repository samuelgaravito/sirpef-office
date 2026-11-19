<script setup lang="ts">
import { computed } from 'vue';

import type { AiChart } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    chart: AiChart;
    dark?: boolean;
    interactive?: boolean;
  }>(),
  { dark: false, interactive: false },
);

const emit = defineEmits<{ select: [key: string, label: string] }>();

const PALETTE = ['#4e85c8', '#06b89b', '#e0a106', '#93a9c4', '#8b5cf6', '#ef6b5b', '#0ea5e9', '#84cc16'];

const seriesColors = computed(() =>
  props.chart.series.map((_, index) => PALETTE[index % PALETTE.length] ?? '#4e85c8'),
);

const max = computed(() => {
  let top = 0;
  for (const series of props.chart.series) {
    for (const value of series.values) top = Math.max(top, value);
  }
  return top;
});

function format(value: number): string {
  if (props.chart.unit === 'hours') return `${Number(value).toFixed(1)} h`;
  if (props.chart.unit === 'percent') return `${Math.round(value)} %`;
  return new Intl.NumberFormat('es-PE').format(Math.round(value));
}

function percentOf(value: number): string {
  if (max.value <= 0 || value <= 0) return '0%';
  return `${Math.max(2, Math.round((value / max.value) * 100))}%`;
}

function valueAt(seriesIndex: number, categoryIndex: number): number {
  return props.chart.series[seriesIndex]?.values[categoryIndex] ?? 0;
}

function keyAt(index: number): string {
  return props.chart.keys?.[index] ?? props.chart.categories[index] ?? String(index);
}

/* ── Línea ─────────────────────────────────────────────────────── */

const WIDTH = 640;
const HEIGHT = 190;
const PAD_X = 24;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

const points = computed(() =>
  props.chart.series.map((series) => {
    const count = series.values.length;
    return series.values.map((value, index) => {
      const x = count <= 1 ? WIDTH / 2 : PAD_X + (index / (count - 1)) * (WIDTH - PAD_X * 2);
      const y = HEIGHT - PAD_BOTTOM - (max.value > 0 ? (value / max.value) * (HEIGHT - PAD_TOP - PAD_BOTTOM) : 0);
      return { x, y, value };
    });
  }),
);

function polyline(seriesIndex: number): string {
  return (points.value[seriesIndex] ?? []).map((point) => `${point.x},${point.y}`).join(' ');
}

function monthLabel(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const [year, month] = value.split('-').map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, 1).toLocaleDateString('es-PE', {
    month: 'short',
  });
}

const xLabels = computed(() => {
  const categories = props.chart.categories;
  if (categories.length <= 8) return categories.map((label, index) => ({ label, index }));

  const steps = 7;
  const indices = new Set<number>();
  for (let step = 0; step < steps; step += 1) {
    indices.add(Math.round((step * (categories.length - 1)) / steps));
  }
  indices.add(categories.length - 1);

  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => ({ label: categories[index] ?? '', index }));
});

/* ── Dona ──────────────────────────────────────────────────────── */

const donut = computed(() => {
  const values = props.chart.series[0]?.values ?? [];
  const total = values.reduce((sum, value) => sum + value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const slices = values.map((value, index) => {
    const fraction = total > 0 ? value / total : 0;
    const length = fraction * circumference;
    const slice = {
      label: props.chart.categories[index] ?? '',
      key: keyAt(index),
      value,
      color: PALETTE[index % PALETTE.length] ?? '#4e85c8',
      dash: `${length} ${circumference - length}`,
      offset: -offset,
    };
    offset += length;
    return slice;
  });

  return { total, radius, circumference, slices };
});

function select(index: number): void {
  if (!props.interactive) return;
  emit('select', keyAt(index), props.chart.categories[index] ?? '');
}
</script>

<template>
  <div class="w-full">
    <p
      v-if="chart.kind !== 'kpi' && chart.title"
      :class="['mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em]', dark ? 'text-white/45' : 'text-ink-subtle']"
    >
      {{ chart.title }}
    </p>

    <!-- KPI -->
    <div v-if="chart.kind === 'kpi'" class="flex flex-col items-start">
      <span :class="['text-[34px] font-semibold leading-none tabular-nums', dark ? 'text-white' : 'text-ink']">
        {{ format(chart.series[0]?.values[0] ?? 0) }}
      </span>
      <span :class="['mt-1 text-[11.5px]', dark ? 'text-white/55' : 'text-ink-subtle']">
        {{ chart.categories[0] }}
      </span>
    </div>

    <!-- Tabla -->
    <div v-else-if="chart.kind === 'table'" class="overflow-x-auto">
      <table class="w-full text-left text-[12px]">
        <thead>
          <tr :class="['border-b', dark ? 'border-white/15 text-white/50' : 'border-hairline text-ink-subtle']">
            <th class="py-1.5 pr-2 font-semibold">{{ chart.title || 'Elemento' }}</th>
            <th v-for="series in chart.series" :key="series.label" class="py-1.5 pl-2 text-right font-semibold">
              {{ series.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(category, index) in chart.categories"
            :key="category"
            :class="['border-b', dark ? 'border-white/8' : 'border-hairline/70']"
          >
            <td :class="['py-1.5 pr-2', dark ? 'text-white/80' : 'text-ink']">{{ category }}</td>
            <td
              v-for="(series, seriesIndex) in chart.series"
              :key="series.label"
              :class="['py-1.5 pl-2 text-right tabular-nums', dark ? 'text-white/80' : 'text-ink']"
            >
              {{ format(valueAt(seriesIndex, index)) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Línea -->
    <div v-else-if="chart.kind === 'line'">
      <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="h-auto w-full" role="img" :aria-label="chart.title">
        <line
          v-for="step in 4"
          :key="step"
          :x1="PAD_X"
          :x2="WIDTH - PAD_X"
          :y1="PAD_TOP + ((HEIGHT - PAD_TOP - PAD_BOTTOM) / 4) * step"
          :y2="PAD_TOP + ((HEIGHT - PAD_TOP - PAD_BOTTOM) / 4) * step"
          :stroke="dark ? 'rgb(255 255 255 / 0.08)' : '#e9eaee'"
          stroke-width="1"
        />
        <g v-for="(series, seriesIndex) in chart.series" :key="series.label">
          <polyline
            :points="polyline(seriesIndex)"
            fill="none"
            :stroke="seriesColors[seriesIndex]"
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <circle
            v-for="(point, index) in points[seriesIndex]"
            :key="index"
            :cx="point.x"
            :cy="point.y"
            r="3.5"
            :fill="seriesColors[seriesIndex]"
            :stroke="dark ? '#0b1b30' : '#ffffff'"
            stroke-width="1.5"
          >
            <title>{{ chart.categories[index] }}: {{ format(point.value) }}</title>
          </circle>
        </g>
      </svg>

      <div class="mt-1 flex justify-between gap-1">
        <span
          v-for="item in xLabels"
          :key="item.index"
          :class="['truncate text-[9.5px]', dark ? 'text-white/45' : 'text-ink-subtle']"
        >
          {{ monthLabel(item.label) }}
        </span>
      </div>

      <div v-if="chart.series.length > 1" class="mt-2 flex flex-wrap gap-3">
        <span
          v-for="(series, seriesIndex) in chart.series"
          :key="series.label"
          :class="['flex items-center gap-1.5 text-[10.5px]', dark ? 'text-white/55' : 'text-ink-subtle']"
        >
          <span class="size-2 rounded-sm" :style="{ background: seriesColors[seriesIndex] }" />
          {{ series.label }}
        </span>
      </div>
    </div>

    <!-- Dona -->
    <div v-else-if="chart.kind === 'donut'" class="flex items-center gap-4">
      <svg viewBox="0 0 140 140" class="size-28 shrink-0" role="img" :aria-label="chart.title">
        <circle
          cx="70"
          cy="70"
          :r="donut.radius"
          fill="none"
          :stroke="dark ? 'rgb(255 255 255 / 0.1)' : '#eceef2'"
          stroke-width="18"
        />
        <circle
          v-for="slice in donut.slices"
          :key="slice.key"
          cx="70"
          cy="70"
          :r="donut.radius"
          fill="none"
          :stroke="slice.color"
          stroke-width="18"
          :stroke-dasharray="slice.dash"
          :stroke-dashoffset="slice.offset"
          transform="rotate(-90 70 70)"
        >
          <title>{{ slice.label }}: {{ format(slice.value) }}</title>
        </circle>
      </svg>
      <ul class="min-w-0 flex-1 space-y-1">
        <li v-for="slice in donut.slices" :key="slice.key" class="flex items-center gap-2 text-[11.5px]">
          <span class="size-2 shrink-0 rounded-sm" :style="{ background: slice.color }" />
          <span :class="['min-w-0 flex-1 truncate', dark ? 'text-white/70' : 'text-ink-muted']">
            {{ slice.label }}
          </span>
          <span :class="['tabular-nums', dark ? 'text-white/90' : 'text-ink']">
            {{ format(slice.value) }}
          </span>
        </li>
      </ul>
    </div>

    <!-- Barras y comparación -->
    <div v-else class="space-y-2">
      <div
        v-for="(category, index) in chart.categories"
        :key="category"
        :class="[
          'rounded-lg px-1.5 py-1',
          interactive ? (dark ? 'cursor-pointer hover:bg-white/10' : 'cursor-pointer hover:bg-surface-hover') : '',
        ]"
        :role="interactive ? 'button' : undefined"
        :tabindex="interactive ? 0 : undefined"
        @click="select(index)"
        @keydown.enter="select(index)"
      >
        <div class="mb-0.5 flex items-baseline justify-between gap-2">
          <span :class="['truncate text-[11.5px]', dark ? 'text-white/70' : 'text-ink-muted']">
            {{ category }}
          </span>
          <span
            v-if="chart.series.length === 1"
            :class="['text-[11.5px] font-medium tabular-nums', dark ? 'text-white' : 'text-ink']"
          >
            {{ format(valueAt(0, index)) }}
          </span>
        </div>
        <div v-for="(series, seriesIndex) in chart.series" :key="series.label" class="flex items-center gap-2">
          <span
            v-if="chart.series.length > 1"
            :class="['w-24 shrink-0 truncate text-[9.5px]', dark ? 'text-white/45' : 'text-ink-subtle']"
          >
            {{ series.label }}
          </span>
          <span
            :class="['relative h-2 flex-1 overflow-hidden rounded-full', dark ? 'bg-white/10' : 'bg-surface-hover']"
            aria-hidden="true"
          >
            <span
              class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
              :style="{ width: percentOf(valueAt(seriesIndex, index)), backgroundColor: seriesColors[seriesIndex] }"
            />
          </span>
          <span
            v-if="chart.series.length > 1"
            :class="['w-14 shrink-0 text-right text-[10.5px] tabular-nums', dark ? 'text-white/70' : 'text-ink-muted']"
          >
            {{ format(valueAt(seriesIndex, index)) }}
          </span>
        </div>
      </div>

      <div v-if="chart.series.length > 1" class="flex flex-wrap gap-3 pt-1">
        <span
          v-for="(series, seriesIndex) in chart.series"
          :key="series.label"
          :class="['flex items-center gap-1.5 text-[10.5px]', dark ? 'text-white/55' : 'text-ink-subtle']"
        >
          <span class="size-2 rounded-sm" :style="{ background: seriesColors[seriesIndex] }" />
          {{ series.label }}
        </span>
      </div>
    </div>
  </div>
</template>
