<script setup lang="ts">
import { Compass } from 'lucide-vue-next';
</script>

<template>
  <div class="grid min-h-full place-items-center bg-canvas px-6">
    <div class="text-center">
      <span class="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <Compass class="size-5" />
      </span>
      <h1 class="mt-4 text-[22px] font-semibold">Página no encontrada</h1>
      <p class="mt-1.5 text-[13px] text-ink-muted">La dirección que abriste no existe o fue movida.</p>
      <RouterLink :to="{ name: 'home' }" class="btn btn-primary mt-5">Volver al inicio</RouterLink>
    </div>
  </div>
</template>
