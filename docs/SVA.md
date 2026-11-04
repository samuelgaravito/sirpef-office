# Integración con SVA (sesión orquestada)

SVA es la fuente única de identidad. SirpefOffice no pide contraseña cuando
`AUTH_MODE=sva`: recibe la sesión de SVA, valida la cookie `SVA-TOKEN` contra la
API de SVA y crea/actualiza el usuario local.

## Flujo

```text
1. El usuario entra a SVA y se autentica.
2. SVA guarda la cookie httpOnly SVA-TOKEN.
3. SVA muestra su dashboard de sistemas.
4. El usuario pulsa la tarjeta "SirpefOffice".
5. SirpefOffice recibe la cookie y llama a POST /api/auth/sva.
6. El backend llama a POST {SVA_SERVER_URL}/auth/system/session
   con { token, api_key }.
7. SVA valida la sesión y que el usuario tenga el sistema asignado.
8. SirpefOffice materializa el usuario y emite su sesión local.
```

El paso 4 es un enlace normal (`Systems.url`). **No hay redirección automática**
desde el login de SVA: el usuario pasa por el dashboard y hace clic.

## Configuración de SVA

### Variables del backend de SVA

```dotenv
NODE_ENV=development        # ver "Modo HTTP" más abajo
SVR_LINK=http://sva.mppef.gob.ve
FRONTEND_URL=http://sva.mppef.gob.ve

# Cookie compartida entre subdominios. En producción: .mppef.gob.ve
# Si SVA y SirpefOffice comparten host y solo cambian de puerto, puede quedar vacío.
SVA_COOKIE_DOMAIN=.mppef.gob.ve

HOSTS_PERMITED=["http://sva.mppef.gob.ve","http://sirpefoffice.mppef.gob.ve"]
```

- `SVA_COOKIE_DOMAIN` es lo que permite que SirpefOffice lea `SVA-TOKEN`.
- `HOSTS_PERMITED` debe incluir el origen de SirpefOffice para el logout y las
  llamadas con credenciales desde el navegador.
- `SVR_LINK` debe ser la base de la **API** de SVA (imágenes y avatares).

### Datos en el panel de SVA

1. Crear el sistema **SirpefOffice**:
   - `url`: URL pública de SirpefOffice (`http://sirpefoffice.mppef.gob.ve` o
     `https://...`).
   - Estado: **Activo**. En esta versión se guarda como `estatus=false`.
   - Logo y descripción.
2. Copiar el `key_backend` generado.
3. Asignar cada usuario al sistema (`configUsers`), también con
   `estatus=false` (activo).
   - Sin asignación, SVA responde `ACCESS DENIED: NOT FOUND`.
4. Verificar que la tarjeta aparece en el dashboard del usuario.

> Ojo: en SVA, `estatus=false` significa **activo** tanto en sistemas como en
> asignaciones. `true` significa suspendido.

## Configuración de SirpefOffice

```dotenv
AUTH_MODE=sva
SVA_SERVER_URL=http://sva.mppef.gob.ve
SVA_API_KEY=<key_backend del sistema SirpefOffice>
SVA_TIMEOUT_MS=8000
SVA_SYNC_INTERVAL_MS=600000
SVA_REFRESH_TOKEN_TTL_DAYS=7

CORS_ORIGIN=http://sirpefoffice.mppef.gob.ve
VITE_SVA_URL=http://sva.mppef.gob.ve
VITE_SVA_API_URL=http://sva.mppef.gob.ve
```

- `SVA_SERVER_URL` es la base de la **API** que responde
  `/auth/system/session` y `/auth/sync`, no la URL del frontend Vue.
- `VITE_SVA_URL` es la URL del portal (login).
- `VITE_SVA_API_URL` es la base de la API para el logout desde el navegador.
- Si el frontend y la API de SVA están en orígenes distintos, usa cada URL donde
  corresponda.

Reconstruir después de cambiar las `VITE_*`:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build api web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Sincronizar usuarios una vez:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec api npm run sva:sync
```

## Modo HTTP

Con `NODE_ENV=production` las cookies se marcan `Secure` y el navegador no las
guarda por HTTP. Para usar solo HTTP:

- En SVA: `NODE_ENV=development` (su cookie deja de ser `Secure`). Esta versión
  de SVA no tiene `COOKIE_SECURE`; si necesitas `NODE_ENV=production` + HTTP,
  añade la variable equivalente en su `sessionCookie`.
- En SirpefOffice: `COOKIE_SECURE=false`.
  - Si no defines `COOKIE_SECURE`, el valor por defecto es `true` en
    `production` y `false` en el resto.
  - `COOKIE_SECURE=false` permite mantener `NODE_ENV=production` si quieres
    conservar el resto del comportamiento de producción.

Ejemplo de SirpefOffice por HTTP:

```dotenv
NODE_ENV=production
COOKIE_SECURE=false
AUTH_MODE=sva
CORS_ORIGIN=http://sirpefoffice.mppef.gob.ve
```

> HTTP solo debe usarse en redes internas o pruebas. Las credenciales y el
> `SVA-TOKEN` viajan sin cifrar. Antes de publicar, activa HTTPS y vuelve a
> `COOKIE_SECURE=true` (o elimina la variable).

## Prueba local con el repositorio de SVA

Si usas el SVA de `~/sva-reference` en desarrollo:

```text
SVA frontend:  http://devsirpef.mppef.gob.ve:5174
SVA API:       http://devsirpef.mppef.gob.ve:5005
SirpefOffice:  http://devsirpef.mppef.gob.ve:8090
```

La cookie de SVA es de host y los puertos no importan, así que funciona en el
mismo hostname. Ajusta:

```dotenv
# SirpefOffice
AUTH_MODE=sva
SVA_SERVER_URL=http://devsirpef.mppef.gob.ve:5005
VITE_SVA_URL=http://devsirpef.mppef.gob.ve:5174
VITE_SVA_API_URL=http://devsirpef.mppef.gob.ve:5005
CORS_ORIGIN=http://devsirpef.mppef.gob.ve:8090
COOKIE_SECURE=false
```

En el SVA local, agrega el origen de SirpefOffice a `HOSTS_PERMITED`:

```dotenv
HOSTS_PERMITED=["http://localhost:5173","http://localhost:5174","http://devsirpef.mppef.gob.ve:5173","http://devsirpef.mppef.gob.ve:5174","http://devsirpef.mppef.gob.ve:8090"]
```

Dos detalles de Docker:

1. Para entrar desde otra máquina, publica el contenedor web en la red:
   `WEB_BIND=0.0.0.0` en `.env.production`.
2. El contenedor de la API debe alcanzar la API de SVA. El
   `docker-compose.prod.yml` ya incluye
   `extra_hosts: host.docker.internal:host-gateway` en el servicio `api`, así
   que para el SVA local basta con:

   ```dotenv
   SVA_SERVER_URL=http://host.docker.internal:5005
   ```

## Verificación

1. Abre una ventana de incógnito.
2. Entra a SVA y autentícate.
3. En el dashboard, pulsa **Ingresar a SirpefOffice**.
4. Debes entrar sin formulario.
5. Revisa los logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

Debe verse `POST /api/auth/sva` con `200`.

6. Cierra sesión en SirpefOffice: también debe cerrarse la sesión de SVA.
7. Quita el sistema a un usuario en SVA, espera la sincronización y comprueba
   que pierde el acceso.

## Problemas típicos

| Síntoma | Causa probable |
| --- | --- |
| Vuelve siempre al login de SVA | La cookie no llega: revisa `SVA_COOKIE_DOMAIN`, el dominio padre y que ambos usen el mismo esquema (HTTP/HTTPS). |
| `No hay sesión de SVA` | La cookie `SVA-TOKEN` no se envía a SirpefOffice. |
| `ACCESS DENIED: API KEY` | `SVA_API_KEY` no coincide con `key_backend`. |
| `ACCESS DENIED: SYSTEM` | El sistema no existe o no está activo (`estatus=false`). |
| `ACCESS DENIED: NOT FOUND` | El usuario no está asignado al sistema (`configUsers.estatus=false`). |
| `SVA no respondió` | `SVA_SERVER_URL` incorrecto o el contenedor no alcanza SVA. |
| Sigue apareciendo el formulario local | `AUTH_MODE=local`, o el frontend no se reconstruyó con `VITE_SVA_URL`. |
| La cookie no se guarda por HTTP | Sigue activo `Secure`: pon `COOKIE_SECURE=false` en SirpefOffice y `NODE_ENV=development` en SVA. |

## Redirección automática (no implementada)

El flujo actual exige hacer clic en la tarjeta del sistema. Si en el futuro se
quiere que SVA devuelva al usuario automáticamente a SirpefOffice, hay que
modificar SVA para aceptar un `?redirect=` validado contra los sistemas
permitidos, o redirigir directo cuando el usuario solo tenga un sistema.
