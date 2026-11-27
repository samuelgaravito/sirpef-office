# SirpefOffice Token (Android)

Aplicación nativa que genera el código TOTP de 6 dígitos para autorizar el
sellado de documentos desde SirpefOffice Firma.

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

Para un teléfono físico o producción:

```bash
./gradlew :app:assembleDebug \
  -PsvaBaseUrl=https://sva.mppef.gob.ve/ \
  -PsirpefBaseUrl=https://sirpefoffice.mppef.gob.ve/api/
```

En release solo se permite HTTPS.

## Estructura

```text
app/src/main/java/ve/gob/mppef/sirpefoffice/token/
  data/        API, modelos, sesión cifrada, secreto con biometría y TOTP
  ui/          ViewModel, navegación, tema y pantallas Compose
    screens/     login, vinculación, token y perfil
    components/  marca y tarjeta del código
```

## Flujo

1. Inicia sesión con SVA (o con el admin local en builds de depuración).
2. En SirpefOffice Firma, abre **Identidad y dispositivo → Activar Token** y
   copia el código de vinculación.
3. En esta app, elige **Vincular este teléfono**, introduce el código y confirma
   con biometría.
4. El código de 6 dígitos aparece en pantalla y cambia cada 30 segundos.
5. Al firmar en SirpefOffice Firma, introduce ese código.

## Seguridad

- La sesión se guarda cifrada con AES-GCM y una clave del Keystore.
- El secreto TOTP se guarda cifrado con una clave que exige biometría o
  credencial del dispositivo.
- El secreto se borra de memoria al pasar a segundo plano.
- `FLAG_SECURE` en release; sin copia de seguridad.
- El código se copia como contenido sensible y se borra del portapapeles a los
  45 segundos.

## Pruebas

```bash
./gradlew :app:testDebugUnitTest
```

Los tests incluyen los vectores oficiales del RFC 6238.

Documentación completa: [`../docs/TOKEN.md`](../docs/TOKEN.md).
