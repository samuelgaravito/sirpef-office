<script setup lang="ts">
import ToastHost from '@/components/ui/ToastHost.vue';
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <component :is="Component" :key="route.path" />
  </RouterView>
  <ToastHost />
</template>
