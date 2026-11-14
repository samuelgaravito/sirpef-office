<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    documents: number;
    drafts: number;
    templates: number;
    designs: number;
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{ openStats: [] }>();

interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface Arc extends Segment {
  length: number;
  offset: number;
}

const segments = computed<Segment[]>(() => [
  {
    key: 'documents',
    label: 'Documentos',
    value: Math.max(0, props.documents - props.drafts),
    color: '#4e85c8',
  },
  {
    key: 'drafts',
    label: 'Borradores',
    value: Math.max(0, props.drafts),
    color: '#06b89b',
  },
  {
    key: 'templates',
    label: 'Plantillas',
    value: Math.max(0, props.templates),
    color: '#e0a106',
  },
  {
    key: 'designs',
    label: 'Diseños',
    value: Math.max(0, props.designs),
    color: '#93a9c4',
  },
]);

const total = computed(() => segments.value.reduce((sum, segment) => sum + segment.value, 0));

/**
 * Arcos normalizados a `pathLength=100`: cada segmento deja un hueco de 1.4
 * unidades para que los colores no se toquen. Los valores cero no se pintan.
 */
const arcs = computed<Arc[]>(() => {
  const sum = total.value;
  if (sum <= 0) return [];

  let offset = 0;
  return segments.value
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const percentage = (segment.value / sum) * 100;
      const arc: Arc = {
        ...segment,
        length: Math.max(0.4, percentage - 1.4),
        offset,
      };
      offset += percentage;
      return arc;
    });
});

const ariaLabel = computed(() => {
  const detail = segments.value
    .map((segment) => `${segment.label}: ${segment.value}`)
    .join(', ');
  return `Resumen del espacio: ${total.value} elementos. ${detail}.`;
});
</script>

<template>
  <div class="gauge">
    <p class="sr-only">{{ ariaLabel }}</p>

    <div class="relative">
      <svg viewBox="0 0 420 312" class="w-full" aria-hidden="true">
        <path
          d="M 60 215 A 150 150 0 0 1 360 215"
          fill="none"
          stroke="rgb(255 255 255 / 0.1)"
          stroke-width="44"
        />
        <path
          v-for="arc in arcs"
          :key="arc.key"
          d="M 60 215 A 150 150 0 0 1 360 215"
          fill="none"
          :stroke="arc.color"
          stroke-width="44"
          pathLength="100"
          :stroke-dasharray="`${arc.length} ${100 - arc.length}`"
          :stroke-dashoffset="-arc.offset"
        />

        <circle cx="210" cy="215" r="90" fill="#ffffff" />
        <circle cx="210" cy="215" r="90" fill="none" stroke="rgb(4 30 66 / 0.06)" />

        <text
          x="210"
          y="211"
          text-anchor="middle"
          fill="#041e42"
          font-size="38"
          font-weight="700"
          letter-spacing="-1.5"
        >
          {{ total }}
        </text>
        <text
          x="210"
          y="232"
          text-anchor="middle"
          fill="#55606c"
          font-size="9.5"
          font-weight="700"
          letter-spacing="1.4"
        >
          ELEMENTOS
        </text>
        <text x="210" y="248" text-anchor="middle" fill="#94969e" font-size="9.5">
          en tu espacio
        </text>
        <text
          x="210"
          y="265"
          text-anchor="middle"
          fill="#4e85c8"
          font-size="8.5"
          font-weight="700"
          letter-spacing="0.9"
        >
          VER ESTADÍSTICAS
        </text>
      </svg>

      <!-- Zona pulsable sobre el círculo: es un botón real, no un SVG. -->
      <button
        type="button"
        class="gauge-hit absolute left-1/2 top-[68.9%] aspect-square w-[42.86%] -translate-x-1/2 -translate-y-1/2"
        aria-label="Ver estadísticas del espacio"
        title="Ver estadísticas del espacio"
        @click="emit('openStats')"
      />
    </div>

    <div class="mx-auto -mt-2 grid max-w-[310px] grid-cols-2 gap-x-5 gap-y-2">
      <div v-for="segment in segments" :key="segment.key" class="flex items-center gap-2">
        <span
          class="size-2 shrink-0 rounded-full"
          :style="{ backgroundColor: segment.color }"
          aria-hidden="true"
        />
        <span class="truncate text-[11px] text-white/55">{{ segment.label }}</span>
        <span
          class="ml-auto text-[12px] font-semibold tabular-nums text-white"
          :class="{ 'animate-pulse': loading }"
        >
          {{ segment.value }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gauge {
  filter: drop-shadow(0 24px 45px rgb(2 21 46 / 0.28));
}

/* El círculo blanco invita a abrir el detalle: se tiñe al pasar el ratón. */
.gauge-hit {
  cursor: pointer;
  border-radius: 9999px;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.gauge-hit:hover {
  background-color: rgb(6 227 189 / 0.08);
  box-shadow: 0 0 0 3px rgb(6 227 189 / 0.18);
}

.gauge-hit:focus-visible {
  outline: 2px solid var(--color-mint);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .gauge-hit {
    transition: none;
  }
}
</style>
