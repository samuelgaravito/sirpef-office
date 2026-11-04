<script setup lang="ts">
import type { DesignTokens } from '@sirpefoffice/shared';

withDefaults(
  defineProps<{
    tokens?: DesignTokens | null;
    title?: string;
    subtitle?: string;
    /** Altura de la hoja en px. */
    height?: number;
    compact?: boolean;
  }>(),
  { height: 150, compact: false },
);

const fallback: DesignTokens['primaryColor'] = '#2563eb';
</script>

<template>
  <div
    class="relative w-full overflow-hidden rounded-md border border-black/5 bg-white shadow-sm"
    :style="{ height: `${height}px` }"
    aria-hidden="true"
  >
    <div class="absolute inset-0 flex flex-col" :style="{ padding: compact ? '10px 12px' : '14px 18px' }">
      <!-- Membrete -->
      <div class="mb-2 flex items-center gap-1.5">
        <span
          class="block size-2 rounded-full"
          :style="{ background: tokens?.primaryColor ?? fallback }"
        />
        <span
          class="block h-1 w-10 rounded-full opacity-70"
          :style="{ background: tokens?.primaryColor ?? fallback }"
        />
      </div>

      <!-- Título -->
      <div
        class="mb-1.5 h-[7px] rounded-full"
        :style="{
          background: tokens?.primaryColor ?? fallback,
          width: title ? '58%' : '45%',
          opacity: 0.9,
        }"
      />
      <div
        v-if="subtitle"
        class="mb-2 h-[4px] w-[38%] rounded-full opacity-40"
        :style="{ background: tokens?.textColor ?? '#334155' }"
      />

      <!-- Líneas de texto -->
      <div class="mt-1 space-y-[5px]">
        <div
          v-for="index in compact ? 3 : 5"
          :key="index"
          class="h-[3px] rounded-full opacity-[0.16]"
          :style="{
            background: tokens?.textColor ?? '#334155',
            width: `${[92, 78, 86, 64, 74][index - 1] ?? 80}%`,
          }"
        />
      </div>

      <!-- Tabla -->
      <div v-if="!compact" class="mt-3 overflow-hidden rounded-[2px]">
        <div
          class="h-[7px] w-full"
          :style="{ background: tokens?.tableHeadColor ?? '#e8eef5' }"
        />
        <div class="mt-[2px] h-[5px] w-full bg-black/[0.05]" />
        <div class="mt-[2px] h-[5px] w-full bg-black/[0.04]" />
      </div>

      <!-- Pie -->
      <div
        class="absolute inset-x-0 bottom-2 mx-auto h-[2px] w-8 rounded-full opacity-25"
        :style="{ background: tokens?.textColor ?? '#334155' }"
      />
    </div>
  </div>
</template>
