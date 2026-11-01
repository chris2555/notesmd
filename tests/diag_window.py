"""Arranque de diagnóstico: comprueba el puente JS <-> Python."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import threading
import time

import webview

from app import Api, INDEX, VERSION
from backend.store import NoteStore

store = NoteStore("/tmp/notesmd-diag", "/tmp/notesmd-diag-config.json")
store.ensure_welcome()
api = Api(store)

window = webview.create_window(
    "notesmd diag",
    str(INDEX),
    js_api=api,
    width=1000,
    height=700,
    background_color="#131614",
    text_select=True,
)

result = {}


def check():
    time.sleep(4)
    try:
        result["href"] = window.evaluate_js("location.href")
        result["api"] = window.evaluate_js("typeof window.pywebview !== 'undefined' && !!window.pywebview.api")
        result["notes"] = window.evaluate_js("document.querySelectorAll('.note').length")
        result["count"] = window.evaluate_js("document.querySelector('#view-count')?.textContent")
        result["modo"] = window.evaluate_js("document.body.dataset.demo || 'real'")
        result["overlay"] = window.evaluate_js("!document.querySelector('#overlay').hidden")
        print("DIAG", result, flush=True)
    except Exception as exc:  # noqa: BLE001
        print("DIAG ERROR", repr(exc), flush=True)
    finally:
        window.destroy()


webview.start(check)
