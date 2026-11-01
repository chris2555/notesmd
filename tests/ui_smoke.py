"""Prueba de humo de la interfaz real: crea, edita, etiqueta, recicla y restaura."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import webview  # noqa: E402

from app import Api, INDEX  # noqa: E402
from backend.store import NoteStore  # noqa: E402

DATA = Path("/tmp/notesmd-ui-smoke")
DATA.mkdir(parents=True, exist_ok=True)
for leftover in DATA.glob("*.md"):
    leftover.unlink()
(DATA / ".welcome").unlink(missing_ok=True)

store = NoteStore(DATA, Path("/tmp/notesmd-ui-config.json"))
api = Api(store)
window = webview.create_window(
    "notesmd ui smoke",
    str(INDEX),
    js_api=api,
    width=1100,
    height=760,
    background_color="#131614",
)

checks = []


def check(name, value, expected=True):
    ok = value == expected
    checks.append(ok)
    print(f"{'OK ' if ok else 'FAIL'} {name}: {value!r}", flush=True)


def js(code, pause=0.25):
    value = window.evaluate_js(code)
    time.sleep(pause)
    return value


def run():
    time.sleep(4)
    try:
        check("arranca en modo real", js("document.body.dataset.demo || 'real'"), "real")
        js("document.querySelector('#new-note').click()", 0.4)
        js(
            """(() => {
              const t = document.querySelector('#note-title');
              t.value = 'Prueba de interfaz';
              t.dispatchEvent(new Event('input', { bubbles: true }));
              const b = document.querySelector('#note-body');
              b.value = 'Un párrafo con **negrita** y una lista\\n\\n- [ ] primera\\n- [ ] segunda';
              b.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            })()""",
            1.6,
        )
        js("document.querySelector('#done-btn').click()", 0.8)
        notes = store.scan()
        made = [n for n in notes if n["title"] == "Prueba de interfaz"]
        check("guarda la nota nueva", bool(made))
        check("conserva el markdown", made[0]["body"].startswith("Un párrafo con **negrita**") if made else None)

        js(
            """(() => {
              const card = [...document.querySelectorAll('.note')]
                .find(n => n.querySelector('.note-title').textContent.includes('Prueba de interfaz'));
              card.click();
              return true;
            })()""",
            0.5,
        )
        js("document.querySelector('#color-btn').click(); document.querySelector('[data-color=\\'cielo\\']').click();", 0.3)
        js(
            """(() => {
              const t = document.querySelector('#tag-input');
              t.value = 'prueba';
              t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              return document.querySelectorAll('#tag-editor .tag-chip').length;
            })()""",
            1.4,
        )
        js("document.querySelector('#preview-toggle').click()", 0.5)
        check("la vista previa renderiza negrita", js("document.querySelectorAll('#note-preview strong').length"), 1)
        check("la vista previa tiene casillas", js("document.querySelectorAll('#note-preview input[type=checkbox]').length"), 2)
        js("document.querySelector('#done-btn').click()", 0.9)

        notes = store.scan()
        made = [n for n in notes if n["title"] == "Prueba de interfaz"][0]
        check("aplica el color", made["color"], "cielo")
        check("añade la etiqueta", made["tags"], ["prueba"])

        js(
            """(() => {
              const card = [...document.querySelectorAll('.note')]
                .find(n => n.querySelector('.note-title').textContent.includes('Prueba de interfaz'));
              card.click();
              return true;
            })()""",
            0.4,
        )
        js("document.querySelector('#delete-btn').click()", 1.2)
        made = [n for n in store.scan() if n["title"] == "Prueba de interfaz"][0]
        check("mueve a la papelera", made["trashed"])

        js("document.querySelector('[data-view=\\'trash\\']').click()", 0.4)
        check("la papelera muestra la nota", js("document.querySelectorAll('.note').length"), 1)
        js("document.querySelector('.note').click()", 0.4)
        js("document.querySelector('#archive-btn').click()", 1.2)
        made = [n for n in store.scan() if n["title"] == "Prueba de interfaz"][0]
        check("restaura desde la papelera", made["trashed"], False)

        js("document.querySelector('[data-view=\\'all\\']').click()", 0.4)
        js("document.querySelector('.note .pin-btn').click()", 0.9)
        made = [n for n in store.scan() if n["title"] == "Prueba de interfaz"][0]
        check("fija la nota", made["pinned"])
        check("la tarjeta queda fijada", js("document.querySelector('.note').classList.contains('is-pinned')"))

        js("document.querySelector('[data-view-mode=\\'list\\']').click()", 0.3)
        check("cambia a vista lista", js("document.querySelector('#grid').classList.contains('is-list')"))
        js("document.querySelector('#theme-toggle').click()", 0.6)
        check("cambia el tema", js("document.documentElement.dataset.theme"), "dia")
        check("guarda la preferencia", store.config["theme"], "dia")

        js(
            """(() => {
              const input = document.querySelector('#search');
              input.value = 'Prueba';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            })()""",
            0.45,
        )
        check("la búsqueda filtra", js("document.querySelectorAll('.note').length"), 1)
        check("la búsqueda resalta", js("document.querySelectorAll('.note mark').length > 0"))
        js("document.querySelector('#search-clear').click()", 0.3)

        js("document.querySelector('.note').click()", 0.4)
        js("document.querySelector('#preview-toggle').click()", 0.35)
        js("document.querySelector('#note-preview input[type=checkbox]').click()", 1.1)
        made = [n for n in store.scan() if n["title"] == "Prueba de interfaz"][0]
        check("marca una tarea desde la vista", "- [x] primera" in made["body"])
        js("document.querySelector('#done-btn').click()", 0.6)

        js("document.querySelector('.note').click()", 0.4)
        js("document.querySelector('#archive-btn').click()", 1.2)
        made = [n for n in store.scan() if n["title"] == "Prueba de interfaz"][0]
        check("archiva la nota", made["archived"])
        js("document.querySelector('[data-view=\\'archived\\']').click()", 0.4)
        check("la vista de archivo la muestra", js("document.querySelectorAll('.note').length"), 1)
        js("document.querySelector('.note').click()", 0.4)
        js("document.querySelector('#archive-btn').click()", 1.2)
        made = [n for n in store.scan() if n["title"] == "Prueba de interfaz"][0]
        check("desarchiva la nota", made["archived"], False)
        check("errores JS en pantalla", js("window.__notesmdErrors || 0"), 0)
    except Exception as exc:  # noqa: BLE001
        print("ERROR:", repr(exc), flush=True)
        checks.append(False)
    finally:
        print("RESUMEN:", "OK" if all(checks) else "FALLOS", flush=True)
        window.destroy()


webview.start(run)
