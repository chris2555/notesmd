#!/usr/bin/env bash
# notesmd · desinstalación (no toca tus notas)
set -euo pipefail

rm -f "$HOME/.local/share/applications/notesmd.desktop"
rm -f "$HOME/.local/bin/notesmd"
rm -f "$HOME/.local/share/icons/hicolor/512x512/apps/notesmd.png"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

printf '%s\n' "notesmd desinstalado. Tus notas siguen en ${NOTESMD_DIR:-$HOME/Notas-notesmd}."
printf '%s\n' "Puedes borrar la carpeta del proyecto cuando quieras."
