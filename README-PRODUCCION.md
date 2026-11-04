# SirpefOffice · Producción

Este repositorio es un **monorepo**: frontend, backend y código compartido viven
juntos y se despliegan como un único release coordinado.

```text
sirpefoffice/                  ← un solo repositorio Git
├── frontend/                  # SPA Vue + Vite (incluye Dockerfile)
├── backend/                   # API Fastify + Drizzle (incluye Dockerfile)
├── shared/                    # fuente única de código compartido
├── scripts/
│   ├── sync-shared.mjs        # copia shared/src a frontend y backend
│   └── build-release.mjs      # genera el paquete de producción
├── deploy/
│   ├── nginx/                 # Nginx del host y del contenedor
│   ├── Caddyfile              # HTTPS automático (perfil tls)
│   ├── systemd/               # unidad para la instalación sin Docker
│   ├── env/                   # plantillas de variables de entorno
│   └── install-release.sh     # activa un release en el servidor
├── docker-compose.prod.yml    # stack Docker: db + api + web (+ caddy)
├── .env.production.example    # plantilla del entorno del stack
├── release/                   # generado; ignorado por Git
├── README.md                  # documentación general
└── README-PRODUCCION.md       # este documento
```

No se crean repositorios separados para `frontend/` ni `backend/`. Tampoco se
duplica `shared/`: `scripts/sync-shared.mjs` genera las copias locales que cada
aplicación necesita.

## Qué se despliega

El release incluye:

```text
sirpefoffice-<fecha>/
├── backend/
│   ├── src/                   # incluye src/shared generado
│   ├── drizzle/               # SQL + meta/_journal.json
│   ├── scripts/               # reset-admin, sva-sync
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   └── drizzle.config.ts
├── web/                       # frontend/dist
├── deploy/
│   ├── nginx.conf
│   ├── sirpefoffice-api.service
│   ├── backend.env.example
│   ├── frontend.env.example
│   └── install-release.sh
├── README-PRODUCCION.md
├── LICENSE
└── SHA256SUMS
```

No se despliegan:

- `sva/` (es el sistema SVA, no SirpefOffice).
- `.opencode/`, documentación interna, capturas.
- `node_modules/`, `.env`, `backend/data/`.
- Smoke tests (`backend/scripts/*smoke*`, `inbox-demo.ts`).
- `frontend/src/`, `frontend/node_modules/`.
- `shared/` y `scripts/`: solo se usan en desarrollo. El release ya lleva
  `backend/src/shared` generado y no necesita `sync-shared`.
- Archivos swap o temporales.

## Despliegue con Docker Compose (recomendado)

La API y la SPA corren en contenedores. PostgreSQL puede ser el servidor
existente (recomendado) o el contenedor local opcional. Los datos persisten en
volúmenes y la actualización es un `docker compose up -d --build`.

| Archivo | Uso |
| --- | --- |
| `backend/Dockerfile` | Imagen de la API: Node 22 + Chromium para los PDF. |
| `frontend/Dockerfile` | Compila la SPA con Vite y la sirve con Nginx. |
| `docker-compose.prod.yml` | Servicios `api`, `web`, `migrate`, `caddy` y `db` local opcional. |
| `deploy/nginx/container.conf` | Nginx del contenedor `web`. |
| `deploy/Caddyfile` | HTTPS automático con Caddy (perfil `tls`). |
| `.env.production.example` | Plantilla del entorno del stack. |

### Puesta en marcha

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Edita DATABASE_URL (base existente), JWT_*, SVA_*, SIRPEF_DOMAIN y el resto.

docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Si la base está vacía, ejecuta una vez el seed:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm api npm run db:seed
```

Para usar la base local incluida (solo pruebas), arranca el perfil `local-db` y
apunta `DATABASE_URL` a `db:5432`. En producción no se arranca ese servicio.

La web queda en `http://127.0.0.1:8080` (o el puerto indicado en `WEB_PORT`).
Para probar sin proxy/TLS usa `WEB_BIND=0.0.0.0` y `COOKIE_SECURE=false`; en
producción con HTTPS deja `WEB_BIND=127.0.0.1` y `COOKIE_SECURE=true`.

Para HTTPS con certificado automático:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tls up -d
```

Caddy pide el certificado para `SIRPEF_DOMAIN`; los puertos 80 y 443 deben estar
libres y el DNS debe apuntar al servidor.

### Variables, volúmenes y datos

- En producción: `NODE_ENV=production`, `AUTH_MODE=sva` y las claves reales de SVA.
- Las `VITE_*` se congelan al construir la imagen `web`: si cambian, reconstruye.
- `pgdata` guarda PostgreSQL y `exports` los PDF temporales.
- El contenedor `db` no publica puertos; solo es accesible desde la red de Compose.
- El seed es idempotente: puede ejecutarse varias veces sin duplicar datos.

### Actualizar, backup y rollback

```bash
# Actualizar
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d

# Backup
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T db pg_dump -Fc -U sirpefoffice sirpefoffice > backup.dump

# Rollback: volver al commit anterior y reconstruir
git checkout <commit-anterior>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

### Instalación sin Docker (alternativa)

Las secciones siguientes describen la instalación con systemd, Nginx del host y
PostgreSQL en el servidor. Sigue siendo válida, pero requiere Node.js, Chrome,
PostgreSQL y Nginx instalados manualmente.

## Requisitos del servidor (instalación sin Docker)

- Linux con systemd.
- Node.js 20.11+ (recomendado 22 LTS).
- PostgreSQL 16.
- Google Chrome estable.
- Nginx.
- Certificado TLS.
- Usuario de sistema `sirpefoffice`.

```bash
sudo useradd --system --home /srv/sirpefoffice --shell /usr/sbin/nologin sirpefoffice
```

## Generar un release

Antes de compilar, crea el archivo de entorno del frontend:

```bash
cp deploy/env/frontend.production.env.example deploy/env/frontend.production.env
# edita VITE_API_URL, VITE_SVA_URL y VITE_SVA_API_URL
```

Ese archivo está ignorado por Git. Después:

```bash
node scripts/build-release.mjs
```

El script:

1. Ejecuta `scripts/sync-shared.mjs`.
2. Compila el frontend con `NODE_ENV=production`.
3. Copia `backend/`, `web/` y `deploy/` (sin `shared/` ni `scripts/`).
4. Genera `SHA256SUMS`.
5. Crea `release/sirpefoffice-<fecha>.tar.gz`.

## Instalar en el servidor

```bash
scp release/sirpefoffice-<fecha>.tar.gz usuario@sirpefoffice.mppef.gob.ve:/tmp/
```

En el servidor:

```bash
cd /tmp
tar -xzf sirpefoffice-<fecha>.tar.gz

# Extrae el release, crea directorios y activa el symlink current.
sudo /tmp/sirpefoffice-<fecha>/deploy/install-release.sh /tmp/sirpefoffice-<fecha>.tar.gz

sudo cp /tmp/sirpefoffice-<fecha>/deploy/sirpefoffice-api.service /etc/systemd/system/
sudo cp /tmp/sirpefoffice-<fecha>/deploy/nginx.conf /etc/nginx/sites-available/sirpefoffice.conf
sudo ln -sfn /etc/nginx/sites-available/sirpefoffice.conf /etc/nginx/sites-enabled/sirpefoffice.conf

# El instalador crea /etc/sirpefoffice/backend.env si no existe.
# Edítalo con los valores reales antes de arrancar el servicio.
sudo systemctl daemon-reload
sudo systemctl enable --now sirpefoffice-api
sudo nginx -t && sudo systemctl reload nginx
```

`install-release.sh` extrae el release en `/srv/sirpefoffice/releases/`,
actualiza el symlink `current` y apunta `/var/www/sirpefoffice` a `current/web`.
No sobrescribe un `backend.env` existente.

### Instalar dependencias del release

El release no incluye `node_modules`. Instálalas en el servidor:

```bash
cd /srv/sirpefoffice/current/backend
sudo -u sirpefoffice npm ci --omit=dev --ignore-scripts
```

`--ignore-scripts` es opcional: el `package.json` del release ya no tiene
`postinstall` ni `prestart`, y `backend/src/shared` viene generado. El servicio
systemd usa directamente `tsx`, no `npm start`.

## Base de datos

Crea una base y un usuario dedicados:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE sirpefoffice LOGIN PASSWORD 'CLAVE_FUERTE';
CREATE DATABASE sirpefoffice OWNER sirpefoffice;
SQL
```

Configura `DATABASE_URL` en `/etc/sirpefoffice/backend.env`.

Aplica migraciones y seed inicial:

```bash
cd /srv/sirpefoffice/current/backend
sudo -u sirpefoffice npx drizzle-kit migrate
sudo -u sirpefoffice npx tsx src/db/seed.ts
```

`drizzle-kit` es una dependencia de desarrollo. Si instalaste con
`--omit=dev`, instálala temporalmente o ejecuta las migraciones desde CI:

```bash
sudo -u sirpefoffice npm install --no-save drizzle-kit
```

El seed crea las plantillas, diseños y el admin local de emergencia. Ejecútalo
solo una vez.

## Nginx y systemd

- `deploy/nginx/sirpefoffice.conf`: proxy `/api/` a `127.0.0.1:3101`, SPA con
  `try_files`, límite de cuerpo de 30 MB y bloqueo de `.map`.
- `deploy/systemd/sirpefoffice-api.service`: ejecuta `tsx src/index.ts` como
  usuario `sirpefoffice`, lee `/etc/sirpefoffice/backend.env` y reinicia
  automáticamente.

Ajusta el dominio y las rutas de los certificados en el archivo de Nginx.

## SVA

SirpefOffice puede delegar la sesión en SVA con `AUTH_MODE=sva`. El flujo
completo, la configuración del panel, el modo HTTP y los errores típicos están
en [`docs/SVA.md`](docs/SVA.md).

Resumen:

- El sistema `SirpefOffice` debe existir y estar activo en SVA
  (`estatus=false`), con su `key_backend`.
- `SVA_API_KEY` de SirpefOffice debe coincidir con esa `key_backend`.
- Agrega el origen de SirpefOffice a `HOSTS_PERMITED`.
- Configura `SVA_COOKIE_DOMAIN=.mppef.gob.ve` si comparten dominio padre.
- Asigna el sistema y el rol a cada usuario (`configUsers.estatus=false`).
- Para HTTP: `COOKIE_SECURE=false` en SirpefOffice y `NODE_ENV=development`
  en SVA. En producción usa HTTPS y vuelve a `COOKIE_SECURE=true`.

La autenticación se resuelve por `key_backend`, no por el nombre visible.

## Verificación posterior

```bash
curl https://sirpefoffice.mppef.gob.ve/api/health
sudo systemctl status sirpefoffice-api
sudo journalctl -u sirpefoffice-api -n 50 --no-pager
```

Comprueba también:

- Login desde el portal SVA.
- Crear y guardar un documento.
- Insertar una imagen.
- Exportar PDF y DOCX.
- Reiniciar el servicio y confirmar persistencia.

## Backups

```bash
pg_dump -Fc -U sirpefoffice -h 127.0.0.1 sirpefoffice \
  > /var/backups/sirpefoffice-$(date +%F-%H%M).dump
```

Programa backups diarios, retención y una copia externa. Los documentos e
imágenes viven en PostgreSQL, así que el backup de la base es crítico.

## Rollback

- Los releases quedan en `/srv/sirpefoffice/releases/`.
- Cambia el symlink `current` al release anterior y reinicia el servicio.
- Restaura el `pg_dump` si una migración necesita revertirse.
- No edites migraciones ya aplicadas.

## Notas de seguridad

- No subas `.env`, tokens, dumps ni `release/` a Git.
- Usa HTTPS; las cookies de sesión son `secure` en producción.
- Mantén `HOST=127.0.0.1` y expón solo Nginx.
- Rota los secretos de desarrollo antes de publicar.
- Revisa que `backend/drizzle/meta/` esté versionado; es necesario para migrar.
