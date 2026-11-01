#!/usr/bin/env python3
"""notesmd · notas locales en Markdown (ventana nativa con WebKit)."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

# WebKitGTK parpadea al repintar en algunas GPU con el renderizador DMABUF.
# Tiene que estar definido antes de que arranque WebKit.
os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")

import webview  # noqa: E402

from backend.store import NoteStore  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent
INDEX = BASE_DIR / "web" / "index.html"
VERSION = "0.1.0"


def default_data_dir() -> Path:
    return Path(os.environ.get("NOTESMD_DIR", "~/Notas-notesmd")).expanduser()


def default_config_path() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")).expanduser()
    return base / "notesmd" / "config.json"


class Api:
    def __init__(self, store: NoteStore):
        self.store = store

    def bootstrap(self) -> dict:
        notes = self.store.scan()
        return {
            "notes": notes,
            "config": self.store.config,
            "data_dir": str(self.store.data_dir),
            "version": VERSION,
        }

    def sync(self) -> list[dict]:
        return self.store.scan()

    def save_note(self, note: dict) -> dict:
        return self.store.save_note(note)

    def set_flag(self, note_id: str, flag: str, value: bool) -> dict | None:
        if flag not in ("pinned", "archived", "trashed"):
            raise ValueError("bandera desconocida")
        patch = {flag: bool(value)}
        if flag == "trashed" and value:
            patch["archived"] = False
        if flag == "archived" and value:
            patch["trashed"] = False
        return self.store.update(note_id, patch)

    def delete_forever(self, note_id: str) -> bool:
        return self.store.delete_forever(note_id)

    def empty_trash(self) -> int:
        return self.store.empty_trash()

    def save_config(self, patch: dict) -> dict:
        return self.store.save_config(patch)

    def open_data_dir(self) -> bool:
        try:
            subprocess.Popen(
                ["xdg-open", str(self.store.data_dir)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except OSError:
            return False

    def open_url(self, url: str) -> bool:
        parsed = urlparse(str(url))
        if parsed.scheme not in ("http", "https", "mailto"):
            return False
        webbrowser.open(url)
        return True


def main() -> int:
    parser = argparse.ArgumentParser(prog="notesmd", description="notesmd: notas locales en Markdown")
    parser.add_argument("--data-dir", default=None, help="carpeta donde viven los .md")
    parser.add_argument("--debug", action="store_true", help="abrir herramientas de desarrollo")
    args = parser.parse_args()

    data_dir = Path(args.data_dir).expanduser() if args.data_dir else default_data_dir()
    store = NoteStore(data_dir, default_config_path())
    store.ensure_welcome()

    api = Api(store)
    webview.create_window(
        "notesmd",
        str(INDEX),
        js_api=api,
        width=1220,
        height=720,
        min_size=(920, 620),
        background_color="#0f0f0f",
        text_select=True,
    )
    storage = Path(os.environ.get("XDG_DATA_HOME", "~/.local/share")).expanduser() / "notesmd" / "webview"
    webview.start(
        debug=args.debug,
        private_mode=False,
        storage_path=str(storage),
        icon=str(BASE_DIR / "assets" / "icon.png"),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
