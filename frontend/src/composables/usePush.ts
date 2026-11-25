import { computed, ref } from 'vue';

import {
  disablePush,
  enablePush,
  hasPushSubscription,
  isPushSupported,
  pushPermission,
  sendTestPush,
  syncPush,
} from '@/lib/push';

const supported = ref(isPushSupported());
const permission = ref<NotificationPermission | 'unsupported'>(pushPermission());
const subscribed = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');

const enabled = computed(() => supported.value && permission.value === 'granted' && subscribed.value);

async function refresh(): Promise<void> {
  supported.value = isPushSupported();
  permission.value = pushPermission();
  subscribed.value = await hasPushSubscription();
}

async function enable(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await enablePush();
    await refresh();
    notice.value = 'Notificaciones activadas en este dispositivo.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'No se pudieron activar las notificaciones.';
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function disable(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await disablePush();
    await refresh();
    notice.value = 'Notificaciones desactivadas en este dispositivo.';
  } finally {
    busy.value = false;
  }
}

async function test(): Promise<void> {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await sendTestPush();
    notice.value = 'Aviso de prueba enviado.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'No se pudo enviar el aviso de prueba.';
  } finally {
    busy.value = false;
  }
}

/** Al iniciar sesión: rehace la suscripción sin volver a pedir permiso. */
async function sync(): Promise<void> {
  const restored = await syncPush();
  if (restored) await refresh();
}

/** Al cerrar sesión: borra la suscripción de este navegador. */
async function clearForLogout(): Promise<void> {
  await disablePush(true);
  subscribed.value = false;
}

function clearMessages(): void {
  error.value = '';
  notice.value = '';
}

export function usePush() {
  return {
    supported,
    permission,
    subscribed,
    enabled,
    busy,
    error,
    notice,
    refresh,
    enable,
    disable,
    test,
    sync,
    clearForLogout,
    clearMessages,
  };
}
