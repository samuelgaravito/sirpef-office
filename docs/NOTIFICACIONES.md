# Notificaciones y tiempo real

SirpefOffice avisa **dentro** y **fuera** de la aplicación. La web y la app Android
comparten el mismo backend y los mismos eventos; solo cambia el transporte.

## 1. Dentro de la app

- **Campana flotante** arriba a la derecha con los avisos de la bandeja.
- **Centro de notificaciones** en la cabecera con historial local (50 avisos por
  usuario), insignia de no leídos, marcar todo como leído y limpiar.
- **Avisos del sistema** cuando la pestaña está abierta pero no visible.
- En Android, la pantalla de inicio actualiza la lista y los contadores sin pulsar
  «actualizar» mientras la app está abierta (WebSocket).

## 2. Fuera de la app

### Web Push (web cerrada o en segundo plano)

- Requiere HTTPS en producción. En desarrollo funciona en `localhost`.
- El navegador debe dar permiso; se pide desde **Ajustes → Avisos → Notificaciones
  fuera de la app** o desde el aviso único que aparece tras iniciar sesión.
- En iPhone/iPad solo funciona si la web se añade a la pantalla de inicio
  (iOS 16.4 o superior).
- Las claves VAPID viven en el servidor:

```bash
cd backend
npx web-push generate-vapid-keys
# Copia las claves en .env:
# VAPID_PUBLIC_KEY=...
# VAPID_PRIVATE_KEY=...
# VAPID_SUBJECT=mailto:soporte@...
```

- Si faltan las claves, la app sigue funcionando y el endpoint
  `GET /api/notifications/public-key` responde 404; la sección de Ajustes lo explica.

### FCM (Android con la app cerrada)

Ver [`FIREBASE.md`](./FIREBASE.md). Sin `google-services.json` y la cuenta de servicio,
la app compila y la actualización en vivo funciona, pero no recibe push con la app
cerrada.

## 3. Qué eventos generan aviso

- Documento enviado directamente a un destinatario.
- Documento enviado a aprobación.
- Documento compartido.
- Resultado aprobado o rechazado.
- Firma electrónica estampada (para la vista del aprobador en la web).

No se notifica cada autoguardado.

## 4. Privacidad

El push usa texto genérico: «Tienes un documento nuevo» / «Documento pendiente de
aprobación». El asunto, el remitente y el contenido solo se ven dentro de la app.
La campana y el centro de notificaciones sí muestran el detalle porque el usuario ya
está autenticado.

## 5. Contrato técnico

Los eventos viajan por PostgreSQL (`pg_notify`) y el hub los reparte por
`GET /api/ws`. El payload **nunca** lleva el JSON TipTap: PostgreSQL limita `NOTIFY`
a unos 8 KB. El cliente recibe «ha cambiado» y pide el detalle por la API.

Tipos de bandeja:

- `connection.ready`
- `inbox.message.created`
- `inbox.message.pending`
- `inbox.message.approved`
- `inbox.result.approved`
- `inbox.result.rejected`
- `inbox.message.cancelled`
- `inbox.message.reviewed`
- `inbox.message.signed`

Tipos de documento:

- `document.created`
- `document.updated`
- `document.deleted`
- `document.restored`
- `document.shared`
- `document.unshared`
- `document.locked`

La audiencia de un documento es su propietario más los usuarios con fila en
`document_shares`. Los destinatarios de un envío y los administradores que deben
aprobarlo reciben una fila en esa tabla, así que quedan incluidos.

## 6. Endpoints nuevos

- `GET /api/notifications/public-key` → clave pública VAPID.
- `POST /api/notifications/subscribe` → alta/actualización web o Android.
- `POST /api/notifications/unsubscribe` → baja al cerrar sesión.
- `POST /api/notifications/test` → aviso de prueba al usuario actual.

Tabla `push_subscriptions`:

- `platform` (`web` | `android`), `endpoint` (URL o token FCM), claves `p256dh`/`auth`
  para web, `device_id` para Android, estado y contador de fallos.
- El endpoint es único: al iniciar sesión en un navegador compartido se reasigna al
  usuario actual.

## 7. Verificación

```bash
cd backend && npm run smoke:push
cd backend && npm run smoke:realtime
cd frontend && npm run typecheck && npm run build
cd mobile && ./gradlew :app:testDebugUnitTest && ./gradlew :app:lintDebug
```

Prueba manual de Web Push:

1. Configurar VAPID y reiniciar la API.
2. Entrar en Ajustes → Avisos → Activar notificaciones push.
3. Enviar el aviso de prueba con la pestaña visible: debe salir en la campana.
4. Ocultar o cerrar el navegador y enviar un documento: debe salir la notificación
   del sistema y, al pulsarla, abrir el mensaje.
