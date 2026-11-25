/* SirpefOffice · service worker de notificaciones push.
 *
 * No cachea la aplicación: solo recibe avisos y abre el destino. Así una
 * versión nueva de la SPA nunca queda servida desde una caché vieja.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Sin caché: el handler solo existe para que la PWA sea instalable. Cada
// petición sigue yendo a la red como si el service worker no estuviera.
self.addEventListener('fetch', () => {});

function normalizeUrl(value) {
  if (typeof value !== 'string' || !value) return '/';
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'SirpefOffice', body: event.data.text() };
  }

  event.waitUntil(
    (async () => {
      // Si el usuario ya está mirando la aplicación, la campana interna es
      // suficiente: no se duplica el aviso del sistema.
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      if (clientList.some((client) => client.visibilityState === 'visible')) return;

      await self.registration.showNotification(payload.title || 'SirpefOffice', {
        body: payload.body || 'Abre SirpefOffice para revisarlo.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: payload.messageId || payload.documentId || 'sirpefoffice',
        renotify: false,
        data: {
          url: normalizeUrl(payload.url),
        },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = normalizeUrl(event.notification.data?.url);

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (!('focus' in client)) continue;
        await client.focus();
        if ('navigate' in client) {
          try {
            await client.navigate(target);
          } catch {
            // Si la ventana no permite navegar, se abre una nueva.
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/* El navegador puede renovar la suscripción por su cuenta. Se vuelve a
 * registrar con la sesión actual (la petición lleva la cookie httpOnly). */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch('/api/notifications/public-key', {
          credentials: 'include',
        });
        if (!response.ok) return;
        const { publicKey } = await response.json();
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        });
        const json = subscription.toJSON();
        await fetch('/api/notifications/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'web',
            endpoint: subscription.endpoint,
            keys: json.keys,
          }),
        });
      } catch {
        // Sin sesión o sin red: se reintentará en la próxima apertura.
      }
    })(),
  );
});

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
