#!/usr/bin/env bash
#
# Instala un release de SirpefOffice en el servidor.
# Uso:
#   sudo ./deploy/install-release.sh /ruta/sirpefoffice-2026-11-04_1400.tar.gz
#
# No sobrescribe /etc/sirpefoffice/backend.env. Si no existe, copia la
# plantilla para que la completes antes de arrancar el servicio.

set -euo pipefail

TARBALL="${1:-}"
if [[ -z "$TARBALL" || ! -f "$TARBALL" ]]; then
  echo "Uso: sudo $0 /ruta/sirpefoffice-<fecha>.tar.gz" >&2
  exit 1
fi

APP_ROOT="${APP_ROOT:-/srv/sirpefoffice}"
WEB_ROOT="${WEB_ROOT:-/var/www/sirpefoffice}"
DATA_ROOT="${DATA_ROOT:-/var/lib/sirpefoffice}"
CONFIG_DIR="${CONFIG_DIR:-/etc/sirpefoffice}"
SERVICE_USER="${SERVICE_USER:-sirpefoffice}"
SERVICE_NAME="${SERVICE_NAME:-sirpefoffice-api}"

TARBALL="$(realpath "$TARBALL")"
NAME="$(basename "$TARBALL" .tar.gz)"

if [[ $EUID -ne 0 ]]; then
  echo "Ejecuta este script con sudo." >&2
  exit 1
fi

echo "→ Preparando directorios…"
mkdir -p "$APP_ROOT/releases" "$WEB_ROOT" "$DATA_ROOT/exports" "$CONFIG_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_ROOT" "$DATA_ROOT"

if [[ ! -f "$CONFIG_DIR/backend.env" ]]; then
  cp "$(dirname "$0")/backend.env.example" "$CONFIG_DIR/backend.env"
  chown root:"$SERVICE_USER" "$CONFIG_DIR/backend.env"
  chmod 640 "$CONFIG_DIR/backend.env"
  echo "  · Creado $CONFIG_DIR/backend.env a partir de la plantilla."
  echo "  · EDITA ese archivo antes de continuar."
fi

echo "→ Extrayendo $NAME…"
tar -xzf "$TARBALL" -C "$APP_ROOT/releases"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_ROOT/releases/$NAME"

echo "→ Activando release…"
ln -sfn "$APP_ROOT/releases/$NAME" "$APP_ROOT/current"

if [[ -L "$WEB_ROOT" || ! -e "$WEB_ROOT" ]]; then
  ln -sfn "$APP_ROOT/current/web" "$WEB_ROOT"
else
  echo "ERROR: $WEB_ROOT existe y no es un symlink." >&2
  echo "Muévelo o elimínalo manualmente y vuelve a ejecutar." >&2
  exit 1
fi

if systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1; then
  echo "→ Reiniciando $SERVICE_NAME…"
  systemctl restart "$SERVICE_NAME"
  systemctl --no-pager --lines=5 status "$SERVICE_NAME" || true
else
  echo "  · El servicio $SERVICE_NAME aún no está instalado."
  echo "  · Copia deploy/sirpefoffice-api.service a /etc/systemd/system/."
fi

echo
echo "Release activo: $APP_ROOT/current"
echo "Web:           $WEB_ROOT"
echo "Config:        $CONFIG_DIR/backend.env"
echo "Datos:         $DATA_ROOT/exports"
