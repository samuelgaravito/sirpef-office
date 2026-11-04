# SirpefOffice API · imagen de producción
#
# Chrome/Chromium es obligatorio: la exportación a PDF renderiza HTML con un
# navegador real. Se instala dentro de la imagen para que el contenedor sea
# autocontenido.

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Las dependencias se copian primero para aprovechar la caché de Docker.
# sync-shared.mjs genera backend/src/shared durante el postinstall.
COPY backend/package.json backend/package-lock.json ./
COPY shared /app/shared
COPY scripts/sync-shared.mjs /app/scripts/
RUN npm ci

# Código de la aplicación (sin node_modules, .env ni datos locales).
COPY backend /app/backend

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3101 \
    CHROME_PATH=/usr/bin/chromium \
    EXPORT_DIR=/data/exports

EXPOSE 3101

# tini recoge las señales para que Fastify cierre ordenadamente.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/tsx", "src/index.ts"]
