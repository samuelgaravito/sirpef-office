#!/usr/bin/env bash
#
# Instalador del nodo de IA local de SirpefOffice.
#
# Comprueba Docker, detecta la GPU y arranca Ollama + agente. Es idempotente:
# se puede volver a ejecutar sin perder el modelo descargado.
#
# Uso:
#   ./install.sh            # GPU si está disponible; si no, CPU
#   AI_MODEL=qwen2.5:7b ./install.sh
#   COMPOSE=docker-compose.cpu.yml ./install.sh

set -euo pipefail
cd "$(dirname "$0")"

MODEL="${AI_MODEL:-qwen2.5:14b}"

echo "· Comprobando Docker…"
command -v docker >/dev/null 2>&1 || {
  echo "✗ Falta Docker. Instálalo antes de continuar."
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "✗ Falta el plugin 'docker compose'."
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "✗ Docker no está en marcha o tu usuario no tiene permiso."
  echo "  Prueba: sudo systemctl enable --now docker"
  exit 1
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "✗ Se creó .env desde el ejemplo. Edita SD_TOKEN (y SD_SERVER si hace falta) y vuelve a ejecutar."
  exit 1
fi

# shellcheck disable=SC1091
set -a && . ./.env && set +a

if [ -z "${SD_TOKEN:-}" ]; then
  echo "✗ Falta SD_TOKEN en .env. Genéralo en Ajustes → Asistente de IA → Mi equipo."
  exit 1
fi
if [ -z "${SD_SERVER:-}" ]; then
  echo "✗ Falta SD_SERVER en .env (por ejemplo ws://sirpefoffice.mppef.gob.ve:8090/api/ai/node)."
  exit 1
fi

# Si el paquete trae la imagen del agente y aún no está cargada, se carga sola:
# en la PC destino basta con ./install.sh.
AGENT_IMAGE="${AI_NODE_IMAGE:-sirpef-ai-node:1.0}"
if ! docker image inspect "$AGENT_IMAGE" >/dev/null 2>&1; then
  TARBALL="$(ls -1 sirpef-ai-node-*.tar.gz 2>/dev/null | head -n 1 || true)"
  if [ -n "$TARBALL" ]; then
    echo "· Cargando la imagen del agente desde $TARBALL…"
    gunzip -c "$TARBALL" | docker load
  else
    echo "✗ No está la imagen $AGENT_IMAGE y el paquete no incluye el .tar.gz."
    echo "  Cópialo junto a este script o cárgalo con: gunzip -c <archivo>.tar.gz | docker load"
    exit 1
  fi
fi

COMPOSE="${COMPOSE:-}"
if [ -z "$COMPOSE" ]; then
  COMPOSE="docker-compose.cpu.yml"
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    echo "· GPU detectada. Comprobando que Docker puede usarla…"
    if timeout 120 docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
      echo "  ✓ GPU disponible dentro de Docker"
      COMPOSE="docker-compose.yml"
    else
      echo "  ! Docker no puede usar la GPU (¿falta nvidia-container-toolkit?). Se arranca en CPU."
    fi
  else
    echo "· Sin GPU NVIDIA. Se arranca en CPU."
  fi
fi

echo "· Arrancando servicios con $COMPOSE…"
docker compose -f "$COMPOSE" up -d

echo "· Descargando el modelo $MODEL (la primera vez son varios GB)…"
docker compose -f "$COMPOSE" exec -T ollama ollama pull "$MODEL"

echo "· Estado:"
docker compose -f "$COMPOSE" ps
echo
echo "✓ Listo. El equipo aparecerá conectado en Ajustes → Asistente de IA → Mi equipo."
