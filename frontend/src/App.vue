<script setup lang="ts">
import { RefreshCw, TriangleAlert, X } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import NotificationBell from '@/components/layout/NotificationBell.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import { api } from '@/api/client';
import { useNotifications } from '@/composables/useNotifications';
import {
  connectRealtime,
  disconnectRealtime,
  reconnectRealtime,
} from '@/composables/useRealtime';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const notifications = useNotifications();

/**
 * El canal de eventos sigue a la sesión: se abre al iniciar sesión y se
 * cierra al cerrarla. Vive en el componente raíz y no en `AppShell` porque
 * aquel se remonta en cada ruta y se salta cuando la vista se abre como
 * panel dentro del módulo.
 */
watch(
  () => auth.isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      connectRealtime();
    } else {
      disconnectRealtime();
      notifications.reset();
    }
  },
  { immediate: true },
);

/**
 * Los avisos de la bandeja se escuchan aquí, una sola vez, para que la
 * campana flotante y el aviso del sistema funcionen en cualquier ruta.
 */
onMounted(() => {
  notifications.start({
    onOpenInbox: () => {
      void router.push({ name: 'inbox' });
    },
  });
});

/**
 * Al volver a la pestaña se comprueba que el canal siga vivo: los móviles
 * suspenden las conexiones en segundo plano.
 */
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && auth.isAuthenticated) {
    reconnectRealtime();
    void checkVersion();
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

/* ─────────────── Avisos de versión y compatibilidad ─────────────── */

const versionStale = ref(false);
const browserUnsupported = ref(false);
const browserNoticeDismissed = ref(false);
try {
  browserNoticeDismissed.value =
    window.sessionStorage.getItem('sirpefoffice:browser-notice') === 'dismissed';
} catch {
  // Almacenamiento bloqueado: el aviso se muestra y se puede cerrar igual.
}

let bootId: string | null = null;
let versionTimer: number | undefined;

/** El servidor cambia de `bootId` al reiniciarse o desplegarse. */
async function checkVersion(): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const data = await api.get<{ bootId: string }>('/system/version');
    if (!bootId) {
      bootId = data.bootId;
      return;
    }
    if (data.bootId !== bootId) versionStale.value = true;
  } catch {
    // Sin conexión: no se molesta al usuario con esto.
  }
}

/** Detecta funciones modernas que la interfaz necesita de verdad. */
function checkBrowserSupport(): void {
  try {
    const colorMix = CSS.supports('color', 'color-mix(in srgb, red, blue)');
    const dynamicViewport = CSS.supports('height', '100dvh');
    browserUnsupported.value = !colorMix || !dynamicViewport;
  } catch {
    browserUnsupported.value = true;
  }
}

function dismissBrowserNotice(): void {
  browserNoticeDismissed.value = true;
  try {
    window.sessionStorage.setItem('sirpefoffice:browser-notice', 'dismissed');
  } catch {
    // Sin almacenamiento: se oculta durante esta vista.
  }
}

function reloadApp(): void {
  window.location.reload();
}

onMounted(() => {
  checkBrowserSupport();
  void checkVersion();
  versionTimer = window.setInterval(() => void checkVersion(), 5 * 60 * 1000);
});

onUnmounted(() => {
  if (versionTimer) window.clearInterval(versionTimer);
});
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" :key="viewKey" />
  </RouterView>
  <NotificationBell />
  <ToastHost />

  <!-- Hay una versión nueva en el servidor -->
  <div
    v-if="versionStale"
    class="card fixed bottom-4 left-4 z-[140] flex max-w-sm items-start gap-2.5 border-accent/30 p-3 shadow-pop"
    role="status"
  >
    <RefreshCw class="mt-0.5 size-4 shrink-0 text-accent" />
    <div class="min-w-0 flex-1">
      <p class="text-[13px] font-semibold text-ink">Hay una versión nueva</p>
      <p class="text-description mt-0.5">Recarga para evitar errores con la versión anterior.</p>
    </div>
    <button type="button" class="btn btn-primary btn-sm shrink-0" @click="reloadApp">
      Recargar
    </button>
  </div>

  <!-- Navegador antiguo: aviso no bloqueante -->
  <div
    v-else-if="browserUnsupported && !browserNoticeDismissed"
    class="card fixed bottom-4 left-4 z-[140] flex max-w-sm items-start gap-2.5 border-warning/30 p-3 shadow-pop"
    role="status"
  >
    <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
    <div class="min-w-0 flex-1">
      <p class="text-[13px] font-semibold text-ink">Tu navegador está desactualizado</p>
      <p class="text-description mt-0.5">
        Algunas vistas pueden verse mal. Actualiza Chrome o Edge para trabajar sin sorpresas.
      </p>
    </div>
    <button
      type="button"
      class="rounded-lg p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
      aria-label="Ocultar aviso"
      @click="dismissBrowserNotice"
    >
      <X class="size-4" />
    </button>
  </div>
</template>
