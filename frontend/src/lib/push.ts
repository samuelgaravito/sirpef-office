import { api } from '@/api/client';

const PREFERENCE_KEY = 'sirpefoffice.pushEnabled';

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePreference(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(PREFERENCE_KEY, '1');
    else window.localStorage.removeItem(PREFERENCE_KEY);
  } catch {
    // Sin almacenamiento la preferencia dura lo que la pestaña.
  }
}

/** Convierte la clave VAPID base64url al formato que exige PushManager. */
function applicationServerKey(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!isPushSupported()) throw new Error('Este navegador no admite notificaciones push.');
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none',
    });
  }
  return registrationPromise;
}

async function getPublicKey(): Promise<string> {
  const data = await api.get<{ publicKey: string }>('/notifications/public-key');
  if (!data.publicKey) throw new Error('El servidor no tiene configuradas las notificaciones push.');
  return data.publicKey;
}

async function postSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await api.post('/notifications/subscribe', {
    platform: 'web',
    endpoint: subscription.endpoint,
    keys: json.keys,
    userAgent: navigator.userAgent.slice(0, 500),
  });
}

async function subscribe(): Promise<PushSubscription> {
  const registration = await getRegistration();
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await postSubscription(existing);
    return existing;
  }

  const publicKey = await getPublicKey();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey) as BufferSource,
  });
  await postSubscription(subscription);
  return subscription;
}

/** Pide permiso y activa los avisos en este navegador. */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error('Este navegador no admite notificaciones push.');

  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== 'granted') {
    throw new Error('El navegador bloqueó las notificaciones. Actívalas en sus ajustes.');
  }

  await subscribe();
  writePreference(true);
}

/** Desactiva los avisos. `keepPreference` evita re-preguntar en el próximo login. */
export async function disablePush(keepPreference = false): Promise<void> {
  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      try {
        await api.post('/notifications/unsubscribe', { endpoint: subscription.endpoint });
      } finally {
        // Aunque la API falle (por ejemplo, ya sin sesión), el navegador deja
        // de recibir el push y el servidor limpiará la fila al caducar.
        await subscription.unsubscribe();
      }
    }
  } catch {
    // Sin suscripción o sin red: el servidor limpiará la fila al caducar.
  }
  if (!keepPreference) writePreference(false);
}

/** Rehace la suscripción al iniciar sesión si el usuario ya la había activado. */
export async function syncPush(): Promise<boolean> {
  if (!isPushSupported() || !readPreference()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    await subscribe();
    return true;
  } catch {
    return false;
  }
}

export async function hasPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await getRegistration();
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function sendTestPush(): Promise<void> {
  await api.post('/notifications/test');
}
