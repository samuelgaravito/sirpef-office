# SirpefOffice Token

Segunda app Android de SirpefOffice. Genera el código TOTP de 6 dígitos que la
app de firma exige **después de la biometría y antes de sellar** un documento.

- Código: `sirpefoffice-token/` (Kotlin 2, Jetpack Compose, Material 3).
- Backend: `backend/src/modules/token/` y `backend/src/lib/totp.ts`.
- Migración: `backend/drizzle/0029_worthless_chronomancer.sql`.
- Smokes: `npm run smoke:token` y `npm run smoke:mobile-sign`.

## Flujo

```text
Vinculación:
App Firma → onboarding de Token → biometría
  → código de vinculación (5 min, un solo uso)

App Token → Vincular este teléfono (sin SVA)
  → introduce el código → biometría
  → recibe el secreto una sola vez

Firma:
App Firma → documento → firma → biometría
  → introduce el código de 6 dígitos de Token
  → POST /api/documents/:id/sign-authorization
  → POST /api/inbox/:id/approve-and-sign
```

La web no participa en este flujo. El código se exige únicamente al sellar en
la app de firma.

## Parámetros TOTP

- Algoritmo: HMAC-SHA1.
- 6 dígitos.
- Periodo: 30 segundos.
- Ventana de tolerancia: ±1 paso.
- Secreto: 160 bits en Base32.
- Un código solo se consume una vez por usuario e intervalo.
- El servidor ancla la hora al reloj monotónico de la app Token para corregir
  desfases del reloj del teléfono.

## Modelo de datos

| Tabla | Contenido |
| --- | --- |
| `totp_credentials` | Secreto cifrado, `key_id`, teléfono Token activo, último paso usado y fecha de rotación. |
| `totp_pairing_codes` | Códigos de vinculación hasheados, con caducidad e intentos. |
| `totp_recovery_codes` | Códigos de recuperación hasheados y de un solo uso. |
| `totp_device_challenges` | Nonces de un solo uso firmados por la clave EC del dispositivo de firma. |

### Formato de los códigos de recuperación

Cada código tiene **6 palabras + 2 dígitos de control**, por ejemplo:

```text
perro luna azul sol mar cielo 47
```

- Lista BIP39 en español, normalizada sin acentos.
- Se aceptan mayúsculas, espacios, guiones y acentos al escribirlo.
- Los 2 dígitos detectan palabras mal copiadas.
- Son de un solo uso; por defecto se generan 3.
- Los códigos antiguos de 10 caracteres siguen funcionando hasta que se
  regeneren.

`signature_challenges` añade `totp_verified_at`, `totp_step`,
`totp_attempts` y `totp_authorized_device_id`.

## Endpoints

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/mobile/token/status` | Estado del Token. Nunca devuelve el secreto. |
| `POST` | `/api/mobile/token/device-challenge` | Nonce para vincular o generar códigos de recuperación. |
| `POST` | `/api/mobile/token/pairing` | Genera el código de vinculación tras verificar dispositivo y biometría. |
| `POST` | `/api/mobile/token/recovery-codes` | Genera 3 códigos de recuperación (6 palabras + 2 dígitos) y los devuelve una vez. |
| `POST` | `/api/mobile/token/pair` | La app Token canjea un código de vinculación o de recuperación (compatibilidad). |
| `POST` | `/api/auth/token/pair` | Vinculación inicial sin SVA con el código generado por Firma. |
| `POST` | `/api/mobile/token/reset` | Rota el secreto del Token actual. |
| `POST` | `/api/mobile/token/unpair` | Desvincula el teléfono y borra el secreto. |
| `POST` | `/api/documents/:id/sign-authorization` | Valida código + dispositivo + desafío y autoriza el sellado. |
| `POST` | `/api/documents/:id/emergency-edit` | Reabre un documento aprobado; solo el aprobador y con TOTP. |
| `POST` | `/api/documents/:id/emergency-edit/:editId/finish` | Cierra la emergencia y crea la revisión pendiente. |
| `POST` | `/api/documents/:id/emergency-edit/:editId/cancel` | Cancela si no hubo cambios. |

Las rutas de vinculación exigen un dispositivo de firma activo y una aserción
ECDSA del payload `SIRPEF-TOKEN|<purpose>|<nonce>`. El código por sí solo no
sirve sin la clave privada del teléfono de firma y la biometría.

`sign-authorization` recibe:

```json
{
  "messageId": "uuid",
  "challengeId": "uuid",
  "code": "123456",
  "signatureSha256": "hex",
  "deviceAssertion": "base64"
}
```

Comprueba el desafío, la versión y el hash del documento, el dispositivo, la
aserción EC, el código TOTP y que el paso no se haya usado. Después marca el
desafío como autorizado. `approve-and-sign` y `sign` rechazan cualquier
desafío sin esa marca.

## Seguridad

- El secreto nunca se entrega con el simple login SVA. Se entrega una sola vez
  durante la vinculación.
- `reset` y `unpair` solo los puede ejecutar el teléfono Token que está
  vinculado en ese momento; una sesión SVA robada no basta para obtener el
  secreto.
- Solo hay un teléfono Token activo por usuario. Vincular otro rota el secreto
  e invalida el anterior.
- El teléfono Token descifra el secreto con una clave AES del Keystore que exige
  biometría fuerte o credencial del dispositivo. Al pasar a segundo plano se
  borra de memoria.
- `FLAG_SECURE` en release, sin copia de seguridad, portapapeles sensible y
  borrado automático.
- Vinculación, recuperación y reset quedan auditados.
- Límite de intentos por desafío y rate limit por ruta.
- En producción solo se permite HTTPS.

### Clave de cifrado

```dotenv
TOTP_ENCRYPTION_KEYS={"1":"base64-de-32-bytes"}
TOTP_ACTIVE_KEY_ID=1
```

Generar una clave:

```bash
openssl rand -base64 32
```

En producción es obligatoria y el arranque falla si no es válida. Guarda una
copia segura: si se pierde, hay que restablecer todos los tokens.

Rotación sin obligar a re-vincular:

```bash
# Añade la clave nueva al llavero y cambia TOTP_ACTIVE_KEY_ID
npm run token:rotate-key -- --to 2
```

Si se pierde el llavero:

```bash
npm run token:reset-all -- --apply
```

## Despliegue escalonado

1. Migración y backend con `TOTP_REQUIRED_FOR_SIGNING=false`.
2. Publicar SirpefOffice Token y la nueva app Firma.
3. Cada administrador vincula su Token.
4. Comprobar cobertura:

```bash
npm run token:coverage
```

5. Activar `TOTP_REQUIRED_FOR_SIGNING=true`.

Si un administrador pierde el teléfono:

```bash
npm run token:reset -- --email usuario@dominio
```

También puede usar un código de recuperación o vincular un teléfono nuevo desde
la app Firma.

## Variables

```dotenv
TOTP_ISSUER=SirpefOffice
TOTP_PERIOD=30
TOTP_DIGITS=6
TOTP_WINDOW=1
TOTP_MAX_ATTEMPTS=5
TOTP_PAIRING_TTL_SECONDS=300
TOTP_RECOVERY_CODE_COUNT=3
TOTP_REQUIRED_FOR_SIGNING=true
TOTP_ENCRYPTION_KEYS={"1":"..."}
TOTP_ACTIVE_KEY_ID=1
```

`SIGNATURE_CHALLENGE_TTL_SECONDS` se recomienda en `300` para dar tiempo a
cambiar de app y copiar el código.

## Compilar

```bash
cd sirpefoffice-token
export JAVA_HOME=/ruta/al/jdk17
export ANDROID_HOME=/ruta/al/android-sdk
./gradlew :app:testDebugUnitTest
./gradlew :app:lintDebug
./gradlew :app:assembleDebug
```

APK: `sirpefoffice-token/app/build/outputs/apk/debug/app-debug.apk`.

URLs:

```bash
./gradlew :app:assembleDebug \
  -PsvaBaseUrl=https://sva.mppef.gob.ve/ \
  -PsirpefBaseUrl=https://sirpefoffice.mppef.gob.ve/api/
```

Por defecto apunta al emulador (`10.0.2.2`). En release solo se permite HTTPS.

## Pruebas

```bash
cd backend
npm run typecheck
npm run smoke:token
npm run smoke:mobile-sign
```

`smoke:token` cubre vectores RFC 6238, vinculación, autorización, replay,
recuperación y reset. `smoke:mobile-sign` firma con un Token real de prueba.

Manual recomendado:

- Código correcto, incorrecto, expirado y reutilizado.
- Esperar 30 s y comprobar el cambio.
- Cambiar la hora del teléfono y verificar la corrección con el servidor.
- Pasar la app Token a segundo plano y comprobar que pide biometría otra vez.
- Enrolar una huella nueva: el secreto se invalida y hay que re-vincular.
- Vincular un segundo teléfono: el primero deja de servir.
- Usar un código de recuperación.
- Desvincular y volver a vincular.

## Limitaciones

- Solo Android.
- Un teléfono Token activo por usuario.
- Sin QR ni exportación a Google Authenticator (la URI `otpauth://` se genera
  en el backend para una fase posterior).
- Sin push ni widgets con el código.
- El código TOTP no sustituye la firma criptográfica ni la biometría: es un
  segundo factor adicional.


## Volver a la app de firma

La pantalla del código incluye **Copiar y volver a Firma**:

- copia el código al portapapeles;
- abre SirpefOffice Firma con un Intent explícito;
- pasa `TOTP_CODE` y `TOTP_REMAINING`;
- la app de firma rellena el diálogo, sin autorizar automáticamente.

Si Firma no está instalada, el código queda copiado y la app Token muestra un aviso.

## Edición de emergencia

La app Token también es el segundo factor para que el **aprobador vigente**
reabra un documento aprobado:

- solo el `approvedById` del último mensaje `sent`;
- motivo obligatorio;
- confirmación del número del documento;
- código TOTP de 6 dígitos;
- sin contraseña como respaldo;
- si no tiene Token, la web indica que debe configurarlo.

El backend valida el código, consume el paso TOTP y registra `reauth_method` y
`totp_step` en `document_emergency_edits`.
