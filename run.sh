#!/usr/bin/env bash
# notesmd · lanzador
set -euo pipefail

DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

# WebKitGTK puede parpadear al repintar en algunas GPU (NVIDIA/AMD) con el
# renderizador DMABUF. Desactivarlo solo afecta a esta app.
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"

if [[ ! -x "$DIR/.venv/bin/python" ]]; then
  echo "notesmd: falta el entorno. Ejecuta $DIR/install.sh primero." >&2
  exit 1
fi

exec "$DIR/.venv/bin/python" "$DIR/app.py" "$@"
