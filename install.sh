#!/usr/bin/env bash
# notesmd · instalación local (sin sudo)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ID="notesmd"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"

say() { printf '%s\n' "$*"; }

if ! command -v python3 >/dev/null 2>&1; then
  say "notesmd: necesitas python3 instalado."
  exit 1
fi

if ! python3 -c "import gi" >/dev/null 2>&1; then
  say "notesmd: falta PyGObject (python3-gi)."
  say "En Linux Mint / Ubuntu:  sudo apt install python3-gi gir1.2-webkit2-4.1"
  exit 1
fi

say "Preparando el entorno de Python…"
if [[ ! -x "$DIR/.venv/bin/python" ]] || ! "$DIR/.venv/bin/python" -c "import gi" >/dev/null 2>&1; then
  rm -rf "$DIR/.venv"
  python3 -m venv --system-site-packages "$DIR/.venv"
fi
"$DIR/.venv/bin/pip" install --quiet --upgrade pip
if ! "$DIR/.venv/bin/python" -c "import webview" >/dev/null 2>&1; then
  "$DIR/.venv/bin/pip" install --quiet pywebview
fi

chmod +x "$DIR/run.sh"

say "Instalando el lanzador…"
mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
ln -sfn "$DIR/run.sh" "$BIN_DIR/notesmd"

if [[ -f "$DIR/assets/icon.png" ]]; then
  cp "$DIR/assets/icon.png" "$ICON_DIR/$APP_ID.png"
  ICON_VALUE="$APP_ID"
else
  ICON_VALUE="$DIR/assets/icon.png"
fi

cat > "$DESKTOP_DIR/$APP_ID.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=notesmd
Comment=Notas locales en Markdown
Exec=$DIR/run.sh
Icon=$ICON_VALUE
Terminal=false
Categories=Office;TextEditor;
Keywords=notas;notes;markdown;local;
StartupNotify=true
StartupWMClass=App.py
EOF

chmod +x "$DESKTOP_DIR/$APP_ID.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

say ""
say "Listo. notesmd ya está en el menú de aplicaciones."
say "  Lanzar desde terminal:  notesmd"
say "  Tus notas:              ${NOTESMD_DIR:-$HOME/Notas-notesmd}"
say ""
say "Si «notesmd» no aparece en el PATH, añade ~/.local/bin a tu PATH."
