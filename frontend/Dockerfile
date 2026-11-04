# SirpefOffice SPA · build con Vite y servidor Nginx

FROM node:22-bookworm-slim AS build

# Las variables VITE_* se congelan en el bundle: se pasan como build args.
ARG VITE_API_URL=/api
ARG VITE_SVA_URL=
ARG VITE_SVA_API_URL=

ENV VITE_API_URL=$VITE_API_URL \
    VITE_SVA_URL=$VITE_SVA_URL \
    VITE_SVA_API_URL=$VITE_SVA_API_URL

WORKDIR /app/frontend

# sync-shared.mjs genera frontend/src/shared durante el postinstall.
COPY frontend/package.json frontend/package-lock.json ./
COPY shared /app/shared
COPY scripts/sync-shared.mjs /app/scripts/
RUN npm ci

COPY frontend /app/frontend
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx/container.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
