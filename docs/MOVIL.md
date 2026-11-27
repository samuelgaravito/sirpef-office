# Aplicación móvil de firma electrónica

App Android nativa para que un administrador **apruebe y firme** memorándums
desde el teléfono. El alta se autoriza desde la web con un código; el login
diario usa cédula/correo, huella y TOTP. SVA sigue siendo la fuente de identidad
de la web y el sellado se hace siempre en el servidor. La app ya no pide la
contraseña de SVA.

- `mobile/` (Kotlin 2, Jetpack Compose, Material 3).
- `sirpefoffice-token/` (app Token, Kotlin 2, Jetpack Compose).
- Backend: `backend/src/modules/mobile/` y `backend/src/modules/token/`.
- Migración: `backend/drizzle/0026_eminent_peter_quill.sql` y `0029_worthless_chronomancer.sql`.
- Smokes: `smoke:mobile-auth` (SVA simulado), `smoke:token` y `smoke:mobile-sign` (DB + Chrome).

## Alta sin contraseña

La app Firma ya no pide la cédula ni la contraseña de SVA para entrar. El alta
se autoriza desde la web:

1. Un administrador entra a **Ajustes → Dispositivos de firma** y pulsa
   *Vincular teléfono*. La web comprueba que su nombre, correo y cédula estén
   completos.
2. La web muestra un código de un solo uso (`XXXX-XXXX`, 15 minutos).
3. En la app: *Vincula este teléfono* → se escribe el código.
4. La app recibe el perfil de SVA (nombre, cédula, correo y rol) y muestra una
   pantalla de confirmación. **No edita** esos datos.
5. Al confirmar, la app crea la clave EC del dispositivo, pide biometría y firma
   el payload `SIRPEF-PAIR|<pairToken>|<deviceId>`.
6. El backend valida el código, la clave y la firma, revoca el teléfono anterior
   y registra el nuevo. Después emite la sesión nativa.

Endpoints nuevos:

| Método | Ruta | Uso |
| --- | --- | --- |
| `POST` | `/api/auth/mobile/pairing` | La web genera el código de alta. |
| `POST` | `/api/auth/mobile/pair` | La app canjea el código por el perfil y un `pairToken`. |
| `POST` | `/api/auth/mobile/pair/confirm` | La app confirma con su clave pública y biometría; se emite la sesión. |
| `POST` | `/api/auth/mobile/login-challenge` | Valida cédula/correo + teléfono y devuelve un desafío firmado. |
| `POST` | `/api/auth/mobile/login` | Firma del teléfono + TOTP o código de recuperación. |
| `POST` | `/api/auth/token/pair` | La app Token canjea el código de Firma sin SVA. |

El código se guarda solo como hash y se consume al confirmar. La sesión de la
web sigue siendo la que autoriza el primer teléfono.

## Después de vincular

La app muestra una pantalla de éxito animada y pasa a **Asocia SirpefOffice
Token**:

1. Genera un código de vinculación de Token (5 minutos).
2. La app Token se abre con ese código y recibe el secreto una sola vez.
3. La Firma detecta que el Token está activo y muestra **3 códigos de
   recuperación de 6 palabras + 2 dígitos**, que se guardan fuera del teléfono.
4. Al terminar, entra a la bóveda.

La app Token ya no pide SVA ni contraseña: usa `POST /api/auth/token/pair`.

## Login diario

Al abrir la app en frío (o después de cerrar sesión):

1. Cédula o correo.
2. Huella: la app firma `SIRPEF-LOGIN|nonce|deviceId|identifier`.
3. Código de 6 dígitos de SirpefOffice Token, o un código de recuperación.
4. El servidor valida dispositivo, firma y TOTP y emite la sesión.

La sesión conserva `authAt`; cuando supera `MOBILE_REAUTH_HOURS` (24 por
defecto) el refresh responde `401 REAUTH_REQUIRED` y la app vuelve a pedir el
login completo. Para el ejercicio se puede poner `MOBILE_REAUTH_HOURS=0` y
forzar el login en cada apertura.

## Revocación desde la web

Al revocar un teléfono en **Ajustes → Dispositivos de firma**:

1. El dispositivo queda `revoked`.
2. Se revocan sus refresh tokens.
3. Se publica `mobile.device.revoked` por el WebSocket.
4. El access token móvil lleva el `deviceId`; en la siguiente petición el
   backend responde `401 DEVICE_REVOKED`.
5. La app borra la sesión y el enrolamiento y vuelve a **“Vincula este
   teléfono”** con el mensaje “Este teléfono fue desvinculado. Pide un nuevo
   código en la web.”

La app Token es independiente: si también se pierde, hay que desvincularla
desde Firma o restablecerla con un código de recuperación.

## Flujo heredado (SVA, compatibilidad)

El flujo actual de alta y login está descrito arriba. Este bloque se conserva
para versiones antiguas de la app y para el canje de SVA.

```text
1. App → SVA POST /auth/login/mobile { userCedula, password }
2. App → SirpefOffice POST /api/auth/mobile/sva { token }
3. App registra una clave EC P-256 del Android Keystore:
   POST /api/mobile/devices { deviceId, publicKey, model, appVersion }
4. App muestra pendientes y recibidos:
   GET /api/mobile/bootstrap
   GET /api/mobile/documents?scope=pending
   GET /api/mobile/documents?scope=received
   Mientras está abierta, el WebSocket /api/ws refresca la lista sola.
5. App abre el PDF:
   GET /api/documents/:id/pdf
6. El jefe decide primero:
   - Aprobar → se muestra la firma y se continúa con el paso 7.
   - Rechazar → POST /api/inbox/:id/reject { reason, allowEdit },
     igual que el diálogo de la web.
7. Al firmar:
   POST /api/documents/:id/sign-challenge { messageId }
   BiometricPrompt desbloquea la clave EC y firma el payload canónico.
   La app pide el código de 6 dígitos de SirpefOffice Token.
   POST /api/documents/:id/sign-authorization { challengeId, code,
     signatureSha256, deviceAssertion }
   POST /api/inbox/:id/approve-and-sign
     ├─ exige el desafío autorizado con TOTP
     ├─ aprueba el envío y asigna el correlativo
     ├─ renderiza el PDF final
     ├─ añade una hoja de firmas con QR
     ├─ calcula el SHA-256 del PDF sellado
     └─ emite el certificado
8. El QR abre GET /api/verify/:token (público, sin contenido del memo).

Con la app cerrada, FCM muestra el aviso y al pulsarlo abre el documento. Requiere
google-services.json y FCM_SERVICE_ACCOUNT_JSON; ver FIREBASE.md.
```

### Payload que firma el dispositivo

```text
SIRPEF-SIGN|challengeId|documentId|messageId|version|contentSha256|signatureSha256
```

- `contentSha256` es un SHA-256 estable de `content`, `data`, `title`,
  `header`, `footer`, `docType`, `templateId`, `designId` y `version`.
- El hash no incluye estado ni número correlativo. La numeración ya **no**
  escribe `data.numero`: el correlativo vive en sus columnas y se resuelve al
  renderizar (`{{numero_documento}}` o, por compatibilidad, `{{numero}}`). Así
  el hash sigue siendo válido cuando la aprobación asigna el número.
- `signatureSha256` es el SHA-256 del PNG de la rúbrica.
- La aserción ECDSA se envía en base64 (DER, `SHA256withECDSA`).

## Endpoints

| Método | Ruta | Uso |
| --- | --- | --- |
| `POST` | `/api/auth/mobile/sva` | Canje de la sesión SVA sin cookies (compatibilidad). |
| `POST` | `/api/auth/mobile/pairing` | Código de alta del teléfono desde la web. |
| `POST` | `/api/auth/mobile/pair` | Canje del código y perfil de SVA. |
| `POST` | `/api/auth/mobile/pair/confirm` | Confirma clave y biometría; emite la sesión. |
| `POST` | `/api/auth/mobile/login-challenge` | Desafío de login diario. |
| `POST` | `/api/auth/mobile/login` | Login con huella + TOTP o recuperación. |
| `POST` | `/api/auth/token/pair` | Vinculación de la app Token sin SVA. |
| `POST` | `/api/auth/mobile/refresh` | Rotación del refresh token nativo. |
| `POST` | `/api/auth/mobile/logout` | Revoca el refresh token. |
| `GET` | `/api/mobile/bootstrap` | Usuario, rol, contadores y capacidades. |
| `GET` | `/api/mobile/documents` | `scope=all\|pending\|received\|sent\|signed\|needs_signature`, `q`, `page`, `pageSize`; devuelve `items`, `page`, `pageSize` y `total`. |
| `GET` | `/api/documents/:id/pdf` | PDF actual; `?sealed=1` devuelve la copia firmada. |
| `GET/POST` | `/api/mobile/devices` | Listar y vincular dispositivos. |
| `DELETE` | `/api/mobile/devices/:id` | Revocar un dispositivo. |
| `POST` | `/api/documents/:id/sign-challenge` | Nonce, versión y hash del contenido. |
| `POST` | `/api/documents/:id/sign-authorization` | Valida el código TOTP y el dispositivo; autoriza el desafío. |
| `GET` | `/api/mobile/token/status` | Estado de SirpefOffice Token. |
| `POST` | `/api/mobile/token/device-challenge` | Nonce para vincular Token o generar códigos de recuperación. |
| `POST` | `/api/mobile/token/pairing` | Código de vinculación para la app Token. |
| `POST` | `/api/mobile/token/recovery-codes` | Códigos de recuperación de un solo uso. |
| `POST` | `/api/inbox/:id/approve-and-sign` | Aprobar, firmar y certificar en una sola transacción. Si falla, no aprueba. |
| `POST` | `/api/mobile/inbox/:id/reject` | Devolver o rechazar con motivo y opción de corrección. |
| `POST` | `/api/mobile/inbox/:id/annul` | Anular un memo aprobado con código TOTP. |
| `POST` | `/api/documents/:id/emergency-edit` | Autorizar una edición de emergencia con TOTP. Después se edita en la web. |
| `POST` | `/api/notifications/subscribe` | Registrar el token FCM del dispositivo. |
| `POST` | `/api/notifications/unsubscribe` | Dar de baja el token al cerrar sesión. |
| `POST` | `/api/documents/:id/sign` | Completar el sellado de un envío ya aprobado que quedó sin firma. |
| `GET` | `/api/documents/:id/certificate` | Certificado JSON del firmante. |
| `GET` | `/api/documents/:id/certificate.pdf` | Certificado PDF. |
| `GET` | `/api/verify/:token` | Verificación pública del QR. |

Los endpoints de firma exigen la cabecera `X-Device-Id` con el identificador
opaco que generó la app. La app añade además `Authorization: Bearer <access>`.

## Modelo de datos

| Tabla | Contenido |
| --- | --- |
| `mobile_devices` | Usuario, `device_id`, clave pública SPKI, estado y último uso. |
| `signature_challenges` | Documento, mensaje, versión, hash, nonce, expiración y uso. |
| `document_signatures` | Rúbrica PNG, trazos, dispositivo, hashes y estado. |
| `signature_certificates` | Serie, token de verificación hasheado, certificado JSON y rutas. |
| `totp_credentials` | Secreto TOTP cifrado y teléfono Token activo. |
| `totp_pairing_codes` | Códigos de vinculación hasheados. |
| `totp_recovery_codes` | Códigos de recuperación hasheados. |
| `totp_device_challenges` | Nonces firmados para vincular y recuperar Token. |

El PDF sellado y el certificado PDF se guardan en `SIGNATURE_DIR`
(`backend/data/signatures` por defecto). El token del QR solo se guarda como
SHA-256; el valor real viaja en el enlace y en el PDF.

## Variables

```dotenv
PUBLIC_APP_URL=http://localhost:5173
SIGNATURE_CHALLENGE_TTL_SECONDS=300
SIGNATURE_MAX_PNG_BYTES=524288
SIGNATURE_DIR=./data/signatures
SIGNATURE_CERT_SERIAL_PREFIX=SF
# SirpefOffice Token (TOTP)
TOTP_ENCRYPTION_KEYS={"1":"..."}
TOTP_ACTIVE_KEY_ID=1
TOTP_REQUIRED_FOR_SIGNING=true
MOBILE_PAIRING_TTL_SECONDS=900
MOBILE_REAUTH_HOURS=24
```

`PUBLIC_APP_URL` debe ser la URL pública que aparece en el QR. En producción,
por ejemplo, `https://sirpefoffice.mppef.gob.ve`.

## Probar sin SVA (solo build de depuración)

La app de release solo admite SVA. El APK **debug** muestra un enlace
«Probar con cuenta local (debug)» que llama a `POST /api/auth/mobile/local`.
Ese endpoint está deshabilitado cuando `AUTH_MODE=sva`.

1. Deja el backend en `AUTH_MODE=local` o `hybrid` y arráncalo:

   ```bash
   cd backend
   npm run dev
   ```

2. Crea un documento pendiente de aprobación:

   ```bash
   cd backend
   npm run demo:review
   ```

3. Instala el APK y abre la app:

   ```bash
   adb install -r mobile/app/build/outputs/apk/debug/app-debug.apk
   ```

4. Pulsa «Probar con cuenta local (debug)» y usa el admin del seed:

   ```text
   Correo:    admin@sirpefoffice.local
   Contraseña: sirpefoffice
   ```

   Si cambiaste `SEED_ADMIN_*`, usa esos valores.

5. Abre el memorándum pendiente, firma y confirma. La biometría es
   obligatoria: el teléfono o emulador debe tener una huella enrolada y un
   bloqueo de pantalla. Si no la tiene, el login funciona pero la firma falla.

### Emulador y teléfono físico

- El APK por defecto apunta a `http://10.0.2.2:3101/api/` (host visto desde el
  emulador).
- Para un teléfono en la misma red, recompila con la IP de la máquina:

  ```bash
  ./gradlew :app:assembleDebug \
    -PsvaBaseUrl=http://192.168.1.50:5005/ \
    -PsirpefBaseUrl=http://192.168.1.50:3101/api/
  ```

- Alternativa por USB: `adb reverse tcp:3101 tcp:3101` y compila con
  `-PsirpefBaseUrl=http://127.0.0.1:3101/api/`.
- En este equipo el emulador **sí arranca**: `/dev/kvm` tiene una ACL que da
  acceso al usuario aunque no pertenezca al grupo `kvm`. El AVD se llama
  `sirpef` (Android 15, x86_64):

  ```bash
  cd ~/android-sdk/emulator
  ./emulator -avd sirpef -no-audio -gpu swiftshader_indirect
  ```

- Para probar la firma en el emulador hay que enrolar una huella y simular el
  toque del sensor:

  ```bash
  adb shell locksettings set-pin 1234        # bloqueo de pantalla
  adb shell am start -a android.settings.FINGERPRINT_ENROLL
  adb -s emulator-5554 emu finger touch 1    # cada toque = una pasada del dedo
  ```

- En builds **debug** la app no activa `FLAG_SECURE`, así que se pueden tomar
  capturas con `adb exec-out screencap -p`. En release el flag sigue activo y
  las capturas salen en negro, a propósito.
  Para permitir capturas en un release de pruebas (por ejemplo, para adjuntar
  pantallas al soporte) se compila con el interruptor temporal:

  ```bash
  ./gradlew :app:assembleRelease -PallowScreenshots=true
  ```

  Sin esa propiedad, release mantiene `FLAG_SECURE`. El APK resultante lleva el
  permiso incorporado; para volver a protegerlo hay que recompilar sin el flag.
- Si el dispositivo no tiene huella ni rostro enrolado, el login **sí**
  funciona y la app avisa «Este dispositivo no tiene huella ni rostro
  enrolado. Regístralo en Ajustes para poder firmar» al intentar sellar.

## Identidad visual

La app usa los tokens de `frontend/src/style.css`, no una paleta propia:

| Token | Hex |
| --- | --- |
| Navy profundo | `#02152E` |
| Navy | `#041E42` |
| Navy suave | `#1B3A66` |
| Azul de acción | `#3C6FB0` |
| Azul claro | `#E9F1FA` |
| Mint | `#06E3BD` |
| Fondo | `#F7F9FC` |
| Borde | `#E3E4E8` |
| Éxito | `#028D05` |
| Advertencia | `#B45309` |
| Peligro | `#C81E00` |

- UI: **Source Sans 3**.
- Firma tipográfica: **Caveat**.
- Logo: monograma **S** con punto mint.
- No se tocan `DEFAULT_DESIGN_TOKENS` ni los colores de los documentos
  exportados; la identidad visual del editor y de la app son independientes.
- Licencias de fuentes: [`mobile/FUENTES.md`](../mobile/FUENTES.md).

## Compilar la app

Requisitos: JDK 17, Android SDK 35 y `local.properties` con `sdk.dir`.

```bash
cd mobile
export JAVA_HOME=/ruta/al/jdk17
export ANDROID_HOME=/ruta/al/android-sdk
./gradlew :app:testDebugUnitTest
./gradlew :app:lintDebug
./gradlew :app:assembleDebug
```

El APK queda en `mobile/app/build/outputs/apk/debug/app-debug.apk`.

Las URLs se configuran al compilar:

```bash
./gradlew :app:assembleDebug \
  -PsvaBaseUrl=http://192.168.1.50:5005/ \
  -PsirpefBaseUrl=http://192.168.1.50:3101/api/
```

Por defecto apuntan al emulador (`10.0.2.2`). En un teléfono físico hay que
usar la IP de la máquina que ejecuta SVA y la API.

La configuración de red de desarrollo permite HTTP
(`mobile/app/src/main/res/xml/network_security_config.xml`). En producción hay
que desactivar `cleartextTrafficPermitted` y `android:usesCleartextTraffic`.

## Verificación

```bash
cd backend
npm run typecheck
npm run smoke:errors
npm run smoke:mobile-auth   # SVA simulado, sin SVA real
npm run smoke:token         # TOTP contra PostgreSQL
npm run smoke:emergency-edit # edición de emergencia con TOTP
npm run smoke:mobile-sign   # PostgreSQL + Chrome reales
```

`smoke:mobile-auth` levanta un SVA simulado en un puerto efímero, canjea su
token por una sesión local y comprueba que el access token abre
`/api/mobile/bootstrap`.

`smoke:mobile-sign`:

1. Renueva y revoca una sesión nativa.
2. Registra una clave EC P-256.
3. Crea un documento y una solicitud de aprobación temporales.
4. Firma el desafío y llama a `approve-and-sign`.
5. Comprueba el PDF sellado, el certificado y la verificación pública.
6. Limpia documento, dispositivo y archivos.

Pruebas manuales recomendadas:

- Cambiar la huella enrolada: la clave se invalida y hay que re-vincular.
- Revocar el dispositivo: la firma debe rechazarse.
- Repetir un challenge o cambiar la versión: 409.
- Verificar el QR desde otro teléfono.
- Rotación, fuente grande, modo oscuro del sistema y pérdida de red.

## Seguridad y alcance

- La contraseña de SVA no se guarda; el access token vive en memoria y el
  refresh se cifra con AES-GCM y una clave del Keystore. La app **no** usa el
  atajo `finger` de `/auth/login/mobile`: siempre exige la contraseña.
- La clave privada de firma nunca sale del teléfono. Su uso exige
  `BIOMETRIC_STRONG` y se invalida si se enrola una biometría nueva.
- El servidor verifica la aserción, el dispositivo activo, el challenge de un
  solo uso, la versión y el hash antes de sellar.
- El sellado exige además un código TOTP de SirpefOffice Token autorizado contra
  el desafío. Sin código no se aprueba ni se sella.
- El código TOTP se consume una sola vez; no se puede reutilizar en otro
  documento ni en el mismo intervalo.
- El QR público no revela el contenido del memorándum.
- No se afirma validez jurídica cualificada. Es una **constancia de firma
  electrónica simple auditada**. PAdES/X.509/TSA queda para una fase posterior.

## Limitaciones de esta versión

- Solo Android.
- Solo firma del administrador al aprobar; no firma del creador ni acuse de
  destinatarios.
- La firma exige SirpefOffice Token; si el administrador no lo tiene vinculado,
  no puede sellar.
- No sube PDFs externos ni escanea con cámara.
- Sin OTP por correo (SirpefOffice no tiene SMTP configurado).
- Sin modo offline de firma. Las notificaciones push funcionan con FCM cuando se configura Firebase; sin credenciales, la app actualiza en vivo solo mientras está abierta.
- El lienzo se puede ampliar en vertical; la rotación real a horizontal queda pendiente.
- La app no descarga todavía el certificado PDF para compartirlo; el backend
  ya lo genera y expone.

## Volver desde Token

Desde la app Token se puede pulsar **Copiar y volver a Firma**. El código se
copia y se envía por Intent a la app de firma, que lo autocompleta en el
diálogo. El backend sigue validando el código y el dispositivo.

## Edición de emergencia

Solo el administrador que aprobó la versión vigente puede reabrir un documento
bloqueado. La web exige TOTP de SirpefOffice Token, motivo y número del
documento. Al primer cambio:

- el documento pasa a `in_review`;
- las firmas y certificados anteriores quedan supersedidos;
- el mensaje anterior queda `superseded`;
- se crea una revisión pendiente;
- el aprobador debe volver a aprobar y firmar.

El QR del certificado anterior responde `valid:false` y `superseded:true`.
El detalle está en [`docs/TOKEN.md`](TOKEN.md).
