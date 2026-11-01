#!/usr/bin/env bash
# notesmd · empaquetado para GitHub Releases
#
#   ./scripts/package.sh          # genera dist/notesmd-<version>.tar.gz y dist/notesmd_<version>_all.deb
#   ./scripts/package.sh tarball  # solo el tar.gz
#   ./scripts/package.sh deb      # solo el .deb
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT"

APP_ID="notesmd"
VERSION="$(sed -n 's/^VERSION = "\(.*\)"/\1/p' app.py | head -1)"
if [[ -z "$VERSION" ]]; then
  echo "package: no encuentro VERSION en app.py" >&2
  exit 1
fi

# En CI el tag manda: v0.1.0 tiene que coincidir con VERSION = "0.1.0".
if [[ "${GITHUB_REF_TYPE:-}" == "tag" && "v$VERSION" != "${GITHUB_REF_NAME}" ]]; then
  echo "package: el tag ${GITHUB_REF_NAME} no coincide con la versión v$VERSION" >&2
  exit 1
fi

WHAT="${1:-all}"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

say() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------- tar.gz
if [[ "$WHAT" == "all" || "$WHAT" == "tarball" ]]; then
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/$APP_ID-$VERSION"
  tar -C "$ROOT" \
    --exclude=.git \
    --exclude=.venv \
    --exclude=dist \
    --exclude=__pycache__ \
    --exclude='*.pyc' \
    --exclude=.pytest_cache \
    -cf - . | tar -C "$TMP/$APP_ID-$VERSION" -xf -
  tar -C "$TMP" -czf "$DIST/$APP_ID-$VERSION.tar.gz" "$APP_ID-$VERSION"
  rm -rf "$TMP"
  say "tarball  dist/$APP_ID-$VERSION.tar.gz"
fi

# ---------------------------------------------------------------- .deb
if [[ "$WHAT" == "all" || "$WHAT" == "deb" ]]; then
  PKG="$DIST/.deb/${APP_ID}_${VERSION}_all"
  mkdir -p \
    "$PKG/DEBIAN" \
    "$PKG/usr/bin" \
    "$PKG/usr/lib/$APP_ID" \
    "$PKG/usr/share/applications" \
    "$PKG/usr/share/icons/hicolor/512x512/apps" \
    "$PKG/usr/share/doc/$APP_ID"

  cp -r app.py backend web assets "$PKG/usr/lib/$APP_ID/"
  find "$PKG/usr/lib/$APP_ID" -name __pycache__ -type d -prune -exec rm -rf {} +

  # pywebview es Python puro: se empaqueta junto para no depender de pip.
  VENDOR="$PKG/usr/lib/$APP_ID/vendor"
  mkdir -p "$VENDOR"
  if [[ -d "$ROOT/.venv/lib/python3.12/site-packages/webview" ]]; then
    SITE="$ROOT/.venv/lib/python3.12/site-packages"
  else
    BUILD_VENV="$DIST/.build-venv"
    python3 -m venv "$BUILD_VENV"
    "$BUILD_VENV/bin/pip" install --quiet --upgrade pip
    "$BUILD_VENV/bin/pip" install --quiet pywebview bottle
    SITE="$(find "$BUILD_VENV/lib" -maxdepth 2 -type d -name site-packages | head -1)"
  fi
  cp -r "$SITE/webview" "$SITE/proxy_tools" "$VENDOR/"
  cp "$SITE/bottle.py" "$VENDOR/"
  python3 - "$VENDOR" "$SITE" <<'PY'
import os
import shutil
import sys

vendor, site = sys.argv[1], sys.argv[2]
source = os.path.join(site, "typing_extensions.py")
if not os.path.exists(source):
    import typing_extensions

    source = typing_extensions.__file__
shutil.copy(source, os.path.join(vendor, "typing_extensions.py"))
PY
  find "$VENDOR" -name __pycache__ -type d -prune -exec rm -rf {} +

  cat > "$PKG/usr/bin/$APP_ID" <<'LAUNCHER'
#!/bin/sh
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
export PYTHONPATH="/usr/lib/notesmd/vendor${PYTHONPATH:+:$PYTHONPATH}"
exec python3 /usr/lib/notesmd/app.py "$@"
LAUNCHER
  chmod 755 "$PKG/usr/bin/$APP_ID"

  cp assets/icon-512.png "$PKG/usr/share/icons/hicolor/512x512/apps/$APP_ID.png"

  cat > "$PKG/usr/share/applications/$APP_ID.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=notesmd
Comment=Notas locales en Markdown
Exec=$APP_ID
Icon=$APP_ID
Terminal=false
Categories=Office;TextEditor;
Keywords=notas;notes;markdown;local;
StartupNotify=true
DESKTOP

  cp README.md "$PKG/usr/share/doc/$APP_ID/README.md"

  SIZE="$(du -sk "$PKG" | cut -f1)"
  cat > "$PKG/DEBIAN/control" <<CONTROL
Package: $APP_ID
Version: $VERSION
Section: office
Priority: optional
Architecture: all
Depends: python3 (>= 3.10), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1
Installed-Size: $SIZE
Maintainer: Christian Hernandez <ratingunah@gmail.com>
Description: Notas rápidas en Markdown para Linux
 notesmd es un tablero de notas locales al estilo Google Keep.
 Cada nota es un archivo Markdown en ~/Notas-notesmd, sin nube,
 sin cuentas y sin telemetría. Incluye etiquetas, búsqueda,
 notas fijadas, archivo, papelera y temas claro y oscuro.
CONTROL

  cat > "$PKG/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi
exit 0
POSTINST

  cat > "$PKG/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi
exit 0
POSTRM

  chmod 755 "$PKG/DEBIAN/postinst" "$PKG/DEBIAN/postrm"
  find "$PKG/usr" -type d -exec chmod 755 {} +
  find "$PKG/usr" -type f -exec chmod 644 {} +
  chmod 755 "$PKG/usr/bin/$APP_ID"
  dpkg-deb --root-owner-group --build "$PKG" "$DIST/${APP_ID}_${VERSION}_all.deb" >/dev/null
  rm -rf "$DIST/.deb" "$DIST/.build-venv"
  say "deb      dist/${APP_ID}_${VERSION}_all.deb"
fi

say ""
ls -lh "$DIST" | tail -n +2
