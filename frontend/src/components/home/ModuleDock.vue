<script setup lang="ts">
import { ArrowUpRight } from 'lucide-vue-next';
import type { Component } from 'vue';

defineProps<{
  tiles: Array<{
    key: string;
    label: string;
    description: string;
    icon: Component;
    route: string;
    value: string;
    caption: string;
    badge?: number;
  }>;
}>();

const emit = defineEmits<{ open: [route: string]; origin: [event: PointerEvent] }>();
</script>

<template>
  <section
    class="dock grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4"
    aria-label="Módulos"
  >
    <button
      v-for="tile in tiles"
      :key="tile.key"
      type="button"
      class="dock-item group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] px-5 py-4 text-left shadow-[0_18px_40px_-26px_rgb(0_0_0/0.9)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.075] hover:shadow-[0_26px_60px_-28px_rgb(0_0_0/0.95)]"
      @pointerdown="emit('origin', $event)"
      @click="emit('open', tile.route)"
    >
      <span
        class="pointer-events-none absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-mint to-[#4e85c8] transition-transform duration-300 group-hover:scale-x-100"
      />

      <div class="flex items-start justify-between gap-2">
        <span
          class="grid size-11 place-items-center rounded-xl bg-[#4e85c8]/15 text-[#8fb6f0] transition-colors duration-200 group-hover:bg-[#4e85c8] group-hover:text-white"
        >
          <component :is="tile.icon" class="size-5" />
        </span>
        <span
          class="grid size-7 place-items-center rounded-full border border-white/12 text-white/40 transition-colors group-hover:border-white/30 group-hover:text-white/85"
        >
          <ArrowUpRight class="size-3.5" />
        </span>
      </div>

      <p class="mt-3.5 text-[15px] font-semibold text-white">{{ tile.label }}</p>
      <p class="mt-1 line-clamp-2 min-h-[40px] text-[13.5px] leading-snug text-white/55">
        {{ tile.description }}
      </p>

      <div class="mt-3 flex items-baseline gap-1.5 border-t border-white/10 pt-2.5">
        <span class="text-[19px] font-semibold leading-none tracking-tight text-white">
          {{ tile.value }}
        </span>
        <span class="truncate text-[12.5px] text-white/50">{{ tile.caption }}</span>
        <span
          v-if="tile.badge"
          class="ml-auto grid min-w-[18px] place-items-center rounded-full bg-mint px-1 py-0.5 text-[9.5px] font-bold leading-none text-navy"
        >
          {{ tile.badge > 99 ? '99+' : tile.badge }}
        </span>
      </div>
    </button>
  </section>
</template>

<style scoped>
.dock {
  animation: dock-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.dock-item:active {
  transform: scale(0.995);
}

@keyframes dock-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dock {
    animation: none;
  }

  .dock-item:active {
    transform: none;
  }
}
</style>
