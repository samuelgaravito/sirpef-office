# SirpefOffice Firma (Android)

Aplicación nativa para aprobar y firmar memorándums de SirpefOffice desde el
teléfono. La identidad se valida con SVA y la firma se sella en el backend.

## Requisitos

- JDK 17 (con `jlink`).
- Android SDK Platform 35 y Build-Tools 35.
- `local.properties` con `sdk.dir=/ruta/al/android-sdk`.

```bash
export JAVA_HOME=/home/toor/jdk17
export ANDROID_HOME=/home/toor/android-sdk
```

## Comandos

```bash
./gradlew :app:testDebugUnitTest
./gradlew :app:lintDebug
./gradlew :app:assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.

## URLs

Por defecto:

- SVA: `http://10.0.2.2:5005/` (emulador → host).
- SirpefOffice: `http://10.0.2.2:3101/api/`.

Para un teléfono físico o un entorno real:

```bash
./gradlew :app:assembleDebug \
  -PsvaBaseUrl=https://sva.mppef.gob.ve/ \
  -PsirpefBaseUrl=https://sirpefoffice.mppef.gob.ve/api/
```

## Estructura

```text
app/src/main/java/ve/gob/mppef/sirpefoffice/firma/
  data/        API, modelos, Keystore, sesión cifrada, PDF, utilidades
  ui/          ViewModel, navegación, tema y pantallas Compose
    components/  lienzo de firma, QR, diálogo de firma
    screens/     login, inicio, documento, certificado, identidad
```

Documentación completa: [`../docs/MOVIL.md`](../docs/MOVIL.md).

## Probar sin SVA

El APK **debug** incluye un acceso local visible solo en desarrollo. Con el
backend en `AUTH_MODE=local`, pulsa **«Probar con cuenta local (debug)»** y usa
`admin@sirpefoffice.local` / `sirpefoffice` (o tu `SEED_ADMIN_*`). Luego crea un
pendiente con `cd ../backend && npm run demo:review`.

La firma exige biometría fuerte; enrola una huella en el dispositivo o
emulador antes de probar. Detalle completo en [`../docs/MOVIL.md`](../docs/MOVIL.md).

## Identidad visual

La app sigue la paleta de SirpefOffice (`#02152E`, `#041E42`, `#3C6FB0`,
`#06E3BD`, `#F7F9FC`) y usa **Source Sans 3** para la interfaz y **Caveat**
para la firma tipográfica. Licencias en [`FUENTES.md`](FUENTES.md).

## Notas

- La app no guarda la contraseña de SVA.
- La clave de firma es EC P-256 en el Android Keystore, ligada a biometría.
- El acceso HTTP solo está permitido para desarrollo. En producción usa HTTPS
  y desactiva `usesCleartextTraffic`.
- Esta versión no sube PDFs externos, no usa OTP y no tiene push.
