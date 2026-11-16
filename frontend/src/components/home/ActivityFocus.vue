<script setup lang="ts">
import { CheckCircle2, ChevronRight, Inbox, RefreshCw } from 'lucide-vue-next';
import { computed } from 'vue';

import { relativeTime } from '@/lib/labels';
import type { InboxMessageSummary } from '@/types';

const props = defineProps<{
  items: InboxMessageSummary[];
  total: number;
  pending: number;
  loading: boolean;
  updatedAt: Date | null;
}>();

const emit = defineEmits<{ open: [id: string]; openInbox: [] }>();

const hasItems = computed(() => props.items.length > 0);
const needsReview = computed(() => props.total > 0);

const statusText = computed(() => {
  if (props.total === 0) return 'Todo al día';
  if (props.pending > 0) {
    return `${props.pending} ${props.pending === 1 ? 'aprobación pendiente' : 'aprobaciones pendientes'}`;
  }
  return `${props.total} ${props.total === 1 ? 'aviso sin revisar' : 'avisos sin revisar'}`;
});

const updatedLabel = computed(() => {
  if (!props.updatedAt) return null;
  return `Actualizado ${relativeTime(props.updatedAt)}`;
});
</script>

<template>
  <section class="activity mt-5 border-t border-white/10 pt-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="relative grid size-5 place-items-center">
          <span
            v-if="needsReview"
            class="pulse-ring absolute inset-0 rounded-full bg-mint/25"
            aria-hidden="true"
          />
          <span
            :class="[
              'relative size-2 rounded-full transition-colors',
              needsReview ? 'bg-mint' : 'bg-white/35',
            ]"
          />
        </span>
        <p class="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">
          Bandeja
        </p>
        <span class="text-[12.5px] font-medium text-white/85">{{ statusText }}</span>
      </div>

      <span
        v-if="updatedLabel"
        class="flex items-center gap-1 text-[12px] text-white/65"
      >
        <RefreshCw class="size-3" />
        {{ updatedLabel }}
      </span>
    </div>

    <!-- Cargando -->
    <div v-if="loading && !hasItems" class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <span
        v-for="n in 3"
        :key="n"
        class="h-[52px] animate-pulse rounded-lg border border-white/10 bg-white/5"
      />
    </div>

    <!-- Pendientes reales -->
    <div v-else-if="hasItems" class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        class="chip-item group flex items-center gap-2.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2.5 text-left backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-mint/40 hover:bg-white/15"
        :style="{ animationDelay: `${index * 70}ms` }"
        @click="emit('open', item.id)"
      >
        <span class="grid size-8 shrink-0 place-items-center rounded-md bg-white/10">
          <Inbox class="size-4 text-white/75" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[14px] font-semibold text-white">
            {{ item.subject || item.documentTitle }}
          </span>
          <span class="mt-0.5 block truncate text-[12.5px] text-white/75">
            De {{ item.senderName }} · {{ relativeTime(item.sentAt ?? item.createdAt) }}
          </span>
        </span>
        <ChevronRight
          class="size-3.5 shrink-0 text-white/35 transition-transform group-hover:translate-x-0.5 group-hover:text-mint"
        />
      </button>
    </div>

    <!-- Hay avisos pero no mensajes recibidos listados -->
    <div
      v-else-if="needsReview"
      class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/10 px-3 py-2.5"
    >
      <p class="text-[13.5px] text-white/85">
        Tienes elementos por revisar en la bandeja.
      </p>
      <button
        type="button"
        class="btn h-9 border border-white/20 bg-white/10 px-3 text-[13px] text-white hover:bg-white/20"
        @click="emit('openInbox')"
      >
        Abrir bandeja
        <ChevronRight class="size-3.5" />
      </button>
    </div>

    <!-- Calma -->
    <div v-else class="mt-3 flex items-center gap-2 text-[13px] text-white/75">
      <span class="calm grid size-7 place-items-center rounded-full bg-white/8">
        <CheckCircle2 class="size-4 text-mint" />
      </span>
      No hay nada pendiente. Puedes empezar un documento nuevo.
    </div>
  </section>
</template>

<style scoped>
.pulse-ring {
  animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse-ring {
  0% {
    transform: scale(0.8);
    opacity: 0.9;
  }
  70% {
    transform: scale(2.4);
    opacity: 0;
  }
  100% {
    transform: scale(2.4);
    opacity: 0;
  }
}

.chip-item {
  animation: chip-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes chip-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.calm {
  animation: calm 4s ease-in-out infinite;
}

@keyframes calm {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(6 227 189 / 0);
  }
  50% {
    box-shadow: 0 0 0 5px rgb(6 227 189 / 0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pulse-ring,
  .chip-item,
  .calm {
    animation: none;
  }
}
</style>
