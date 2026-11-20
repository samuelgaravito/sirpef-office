<script setup lang="ts">
import { Cpu, Server, Sparkles } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted } from 'vue';

import { useAiStatus, type AiStatus } from '@/composables/useAiStatus';

/**
 * Indicador del modo de IA activo.
 *
 * `node` → la redacción la hace el equipo del usuario; `server` → el proveedor
 * configurado en Ajustes; `none` → modo manual. Se refresca cada minuto porque
 * el equipo puede conectarse o apagarse sin recargar la página.
 */
const { status, load } = useAiStatus();

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void load();
  timer = setInterval(() => void load(true), 60_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  timer = null;
});

const mode = computed<NonNullable<AiStatus['mode']>>(() => status.value?.mode ?? 'none');

const label = computed(() => {
  if (mode.value === 'node') return 'IA · mi equipo';
  if (mode.value === 'server') return 'IA · servidor';
  return 'IA · manual';
});

const title = computed(() => {
  const current = status.value;
  if (!current) return 'Estado de la IA';

  if (mode.value === 'node' && current.node) {
    return `Redactando en «${current.node.name}» · ${current.node.model}`;
  }
  if (mode.value === 'server') {
    return `Proveedor del servidor · ${current.model}`;
  }
  return 'Sin proveedor de IA: los documentos se rellenan a mano';
});

const icon = computed(() => (mode.value === 'node' ? Cpu : mode.value === 'server' ? Server : Sparkles));
</script>

<template>
  <span
    v-if="status"
    class="hidden h-9 items-center gap-1.5 rounded-field border border-white/15 bg-white/[0.07] px-2.5 text-[11.5px] font-medium text-white/75 sm:inline-flex"
    :title="title"
  >
    <component :is="icon" class="size-3.5" :class="mode === 'node' ? 'text-mint' : 'text-white/60'" />
    <span class="hidden md:inline">{{ label }}</span>
    <span v-if="mode === 'node'" class="size-1.5 rounded-full bg-mint" />
  </span>
</template>
