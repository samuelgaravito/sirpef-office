# SirpefOffice · agente de IA local
#
# Imagen mínima: solo reenvía peticiones al Ollama del propio equipo.
# No expone puertos; abre una conexión saliente hacia el servidor.

FROM node:22-alpine

WORKDIR /app

# Se instala solo la dependencia del WebSocket.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.mjs ./

USER node

CMD ["node", "index.mjs"]
