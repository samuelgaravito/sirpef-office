<script setup lang="ts">
import { LayoutTemplate, ListChecks, Send, X } from 'lucide-vue-next';
import { computed, ref } from 'vue';

import { useAuthStore } from '@/stores/auth';

/**
 * Guía de tres pasos para la primera vez. Se descarta por usuario y no vuelve
 * a aparecer: la idea es explicar el flujo sin convertir Inicio en un tutorial
 * permanente.
 */
const emit = defineEmits<{ create: [] }>();

const auth = useAuthStore();
const key = computed(() => `sirpefoffice:onboarding:${auth.user?.id ?? 'anon'}`);

function isDone(): boolean {
  try {
    return window.localStorage.getItem(key.value) === 'done';
  } catch {
    return true;
  }
}

const visible = ref(!isDone());

function dismiss(): void {
  try {
    window.localStorage.setItem(key.value, 'done');
  } catch {
    // Sin almacenamiento: se oculta solo durante esta sesión.
  }
  visible.value = false;
}

function start(): void {
  dismiss();
  emit('create');
}

const steps = [
  {
    icon: LayoutTemplate,
    title: '1. Elige un modelo',
    text: 'Memorándum, acta, certificado… El documento nace con su formato y su numeración.',
  },
  {
    icon: ListChecks,
    title: '2. Rellena los datos',
    text: 'El panel derecho te pide solo lo que falta. Los campos con * son obligatorios.',
  },
  {
    icon: Send,
    title: '3. Revisa y envía',
    text: 'La vista previa muestra el resultado final. Después se envía al jefe para aprobación.',
  },
];
</script>

<template>
  <section
    v-if="visible"
    class="rounded-xl border border-accent/25 bg-accent-soft/40 p-4 sm:p-5"
  >
    <header class="flex items-start justify-between gap-3">
      <div>
        <p class="text-[12px] font-semibold uppercase tracking-wide text-accent">Primeros pasos</p>
        <h2 class="mt-0.5 text-[16px] font-semibold text-ink">Crear un documento es así de simple</h2>
      </div>
      <button
        type="button"
        class="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        aria-label="No volver a mostrar esta guía"
        title="No volver a mostrar"
        @click="dismiss"
      >
        <X class="size-4" />
      </button>
    </header>

    <div class="mt-4 grid gap-3 sm:grid-cols-3">
      <div
        v-for="step in steps"
        :key="step.title"
        class="rounded-lg border border-accent/15 bg-surface/80 p-3"
      >
        <component :is="step.icon" class="size-4 text-accent" />
        <p class="mt-1.5 text-[13.5px] font-semibold text-ink">{{ step.title }}</p>
        <p class="text-description mt-0.5">{{ step.text }}</p>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
      <button type="button" class="btn btn-ghost btn-sm" @click="dismiss">
        Ya lo entiendo
      </button>
      <button type="button" class="btn btn-primary btn-sm" @click="start">
        Crear mi primer documento
      </button>
    </div>
  </section>
</template>
