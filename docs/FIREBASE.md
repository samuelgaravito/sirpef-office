# Firebase para notificaciones Android

SirpefOffice usa **Firebase Cloud Messaging (FCM)** para avisar a la app Android
cuando está cerrada o el móvil está bloqueado. Sin esta configuración, la app
funciona y se actualiza en vivo mientras está abierta, pero no recibe push con la
app cerrada.

## 1. Crear el proyecto

1. Entra en <https://console.firebase.google.com> con una cuenta de Google.
2. Crea un proyecto (el plan gratuito Spark es suficiente).
3. Añade una app Android con el paquete:
   `ve.gob.mppef.sirpefoffice.firma`.
4. Descarga **`google-services.json`** y colócalo en:
   `mobile/app/google-services.json`.

El archivo está en `.gitignore`: no se versiona.

## 2. Cuenta de servicio para el servidor

1. En Firebase, abre **Configuración del proyecto → Cuentas de servicio**.
2. Genera una clave privada nueva (JSON).
3. Configura el backend con una de estas dos formas:
   - ruta al archivo:
     `FCM_SERVICE_ACCOUNT_JSON=/ruta/a/service-account.json`
   - contenido JSON en base64:
     `FCM_SERVICE_ACCOUNT_JSON=$(base64 -w0 service-account.json)`

No subas ese archivo al repositorio. En producción, guárdalo fuera de la carpeta
pública y con permisos restringidos.

## 3. Compilar la app

```bash
cd mobile
./gradlew :app:assembleDebug
```

El plugin de Google Services **solo se aplica si existe**
`mobile/app/google-services.json`. Sin ese archivo, el build sigue funcionando.

## 4. Probar

1. Inicia sesión en la app para que se registre el token FCM.
2. Comprueba en la base de datos:

```sql
select platform, status, created_at
from push_subscriptions
where platform = 'android';
```

3. Envía un documento desde la web a un administrador o destinatario.
4. Cierra la app Android y comprueba que llega la notificación.
5. Al pulsarla debe abrir la app y llevar al documento recibido o a la bandeja.

## 5. Comportamiento

- **App abierta**: el WebSocket refresca la lista y muestra el aviso dentro de la app.
- **App en segundo plano o cerrada**: FCM muestra la notificación del sistema.
- **Sin permiso de notificaciones (Android 13+)**: no se muestra el aviso; la app
  pide el permiso al arrancar.
- **Token inválido o app desinstalada**: el backend elimina la suscripción cuando
  FCM responde `UNREGISTERED` o el token no es válido.
- **Cierre de sesión**: la app da de baja el token para no recibir avisos de otra
  cuenta en el mismo dispositivo.
