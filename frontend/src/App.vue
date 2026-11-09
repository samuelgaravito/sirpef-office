<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import ToastHost from '@/components/ui/ToastHost.vue';

const route = useRoute();

/**
 * Los módulos (`/templates`, `/documents`, …) son rutas hijas de `/`, así que
 * usar `route.path` como clave recreaba `HomeView` al abrir o cerrar su panel,
 * reiniciando contadores, peticiones y scroll. Mantenemos la misma clave para
 * todo lo que cuelga del panel de trabajo y conservamos el remontaje en el
 * resto de rutas (editores, login, etc.).
 */
const viewKey = computed(() => (route.matched[0]?.path === '/' ? '/' : route.path));
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" :key="viewKey" />
  </RouterView>
  <ToastHost />
</template>
