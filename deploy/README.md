# Despliegue

La guía completa está en [`../README-PRODUCCION.md`](../README-PRODUCCION.md).

## Docker Compose (recomendado)

```bash
cp .env.production.example .env.production   # completar secretos
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d db
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm api npm run db:seed
docker compose --env-file .env.production -f docker-compose.prod.yml up -d

# HTTPS automático con Caddy
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tls up -d
```

Archivos del stack: `../backend/Dockerfile`, `../frontend/Dockerfile`,
`../docker-compose.prod.yml`, `nginx/container.conf` y `Caddyfile`.

## Instalación sin Docker

Resumen:

```bash
# 1. Configurar el frontend de producción
cp deploy/env/frontend.production.env.example deploy/env/frontend.production.env

# 2. Generar el release
node scripts/build-release.mjs

# 3. En el servidor: extraer el instalador y activar el release
tar -xzf /tmp/sirpefoffice-<fecha>.tar.gz -C /tmp
sudo /tmp/sirpefoffice-<fecha>/deploy/install-release.sh /tmp/sirpefoffice-<fecha>.tar.gz
```

Archivos:

- `env/backend.production.env.example`: variables de la API.
- `env/frontend.production.env.example`: variables del build de la SPA.
- `nginx/sirpefoffice.conf`: proxy y SPA.
- `systemd/sirpefoffice-api.service`: servicio de la API.
- `install-release.sh`: activa un release y cambia el symlink `current`.

No copies `sva/` a este despliegue: es un sistema independiente.
