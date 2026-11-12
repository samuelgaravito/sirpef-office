<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';

import ToastHost from '@/components/ui/ToastHost.vue';
import {
  connectRealtime,
  disconnectRealtime,
  reconnectRealtime,
} from '@/composables/useRealtime';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const auth = useAuthStore();

/**
 * El canal de eventos sigue a la sesión: se abre al iniciar sesión y se
 * cierra al cerrarla. Vive en el componente raíz y no en `AppShell` porque
 * aquel se remonta en cada ruta y se salta cuando la vista se abre como
 * panel dentro del módulo.
 */
watch(
  () => auth.isAuthenticated,
  (authenticated) => {
    if (authenticated) connectRealtime();
    else disconnectRealtime();
  },
  { immediate: true },
);

/**
 * Al volver a la pestaña se comprueba que el canal siga vivo: los móviles
 * suspenden las conexiones en segundo plano.
 */
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && auth.isAuthenticated) {
    reconnectRealtime();
  }
}

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange));

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
