"""Pruebas del almacén de notesmd (sin levantar la interfaz)."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.store import NoteStore, parse_markdown, render_markdown  # noqa: E402


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "notas"
        self.config = Path(self.tmp.name) / "config.json"
        self.store = NoteStore(self.data, self.config)

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_and_list(self):
        note = self.store.save_note(
            {"title": "Reunión de equipo", "body": "Hola **mundo**", "tags": ["Trabajo", "trabajo"]}
        )
        self.assertTrue(note["id"])
        self.assertEqual(note["title"], "Reunión de equipo")
        self.assertEqual(note["tags"], ["Trabajo"])
        files = list(self.data.glob("*.md"))
        self.assertEqual(len(files), 1)
        self.assertIn("reunion-de-equipo", files[0].name)

        notes = self.store.list_notes()
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["body"], "Hola **mundo**")

    def test_update_renames_file(self):
        note = self.store.save_note({"title": "Borrador", "body": "uno"})
        updated = self.store.update(note["id"], {"title": "Título definitivo"})
        self.assertEqual(updated["title"], "Título definitivo")
        names = [path.name for path in self.data.glob("*.md")]
        self.assertEqual(len(names), 1)
        self.assertIn("titulo-definitivo", names[0])
        self.assertEqual(self.store.list_notes()[0]["id"], note["id"])

    def test_frontmatter_roundtrip(self):
        note = {
            "id": "abc12345",
            "title": 'Comillas "raras" y : dos puntos',
            "body": "Línea 1\n\n- [ ] tarea\n- [x] hecha",
            "color": "ambar",
            "pinned": True,
            "archived": False,
            "trashed": False,
            "tags": ["casa", "ideas raras"],
            "created": "2026-10-28T10:00:00",
            "updated": "2026-10-28T11:00:00",
        }
        text = render_markdown(note)
        path = self.data / "prueba.md"
        path.write_text(text, encoding="utf-8")
        parsed = parse_markdown(text, path)
        for key in ("id", "title", "body", "color", "pinned", "archived", "trashed", "tags"):
            self.assertEqual(parsed[key], note[key], key)

    def test_unknown_frontmatter_survives_update(self):
        path = self.data / "con-extra.md"
        path.write_text(
            """---
id: abc12345
title: "Nota con extras"
tags:
  - casa
  - ideas raras
aliases: ["casa", "hogar"]
cssclasses: wide
---
Cuerpo original.
""",
            encoding="utf-8",
        )
        note = self.store.list_notes()[0]
        self.assertEqual(note["tags"], ["casa", "ideas raras"])

        self.store.update(note["id"], {"title": "Nota renombrada", "body": "Otro cuerpo."})
        text = next(self.data.glob("*.md")).read_text(encoding="utf-8")
        self.assertIn('aliases: ["casa", "hogar"]', text)
        self.assertIn("cssclasses: wide", text)

        again = parse_markdown(text, next(self.data.glob("*.md")))
        self.assertEqual(again["title"], "Nota renombrada")
        self.assertEqual(again["body"], "Otro cuerpo.")
        self.assertIn("cssclasses: wide", again["extra_lines"])

    def test_external_markdown_without_frontmatter(self):
        path = self.data / "nota-externa.md"
        path.write_text("# Hola\n\nEsto vino de Obsidian.\n", encoding="utf-8")
        notes = self.store.list_notes()
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["title"], "nota externa")
        self.assertIn("Esto vino de Obsidian", notes[0]["body"])

    def test_flags_and_trash(self):
        note = self.store.save_note({"title": "Nota", "body": "x"})
        pinned = self.store.update(note["id"], {"pinned": True})
        self.assertTrue(pinned["pinned"])

        trashed = self.store.update(note["id"], {"trashed": True, "archived": True})
        self.assertTrue(trashed["trashed"])
        self.assertFalse(trashed["archived"])

        self.assertEqual(self.store.empty_trash(), 1)
        self.assertEqual(self.store.list_notes(), [])

    def test_config_validation(self):
        self.store.save_config({"theme": "dia", "view": "list", "sort": "title"})
        self.assertEqual(self.store.config["theme"], "dia")
        self.store.save_config({"theme": "neon", "sort": "inventado"})
        self.assertEqual(self.store.config["theme"], "dia")
        self.assertEqual(self.store.config["sort"], "title")
        self.assertTrue(self.config.exists())

    def test_welcome_note_once(self):
        self.store.ensure_welcome()
        self.assertEqual(len(self.store.list_notes()), 1)
        self.assertTrue((self.data / ".welcome").exists())
        for note in self.store.list_notes():
            self.store.delete_forever(note["id"])
        self.store.ensure_welcome()
        self.assertEqual(self.store.list_notes(), [])

    def test_missing_file_is_rescanned(self):
        note = self.store.save_note({"title": "Temporal", "body": "x"})
        for path in self.data.glob("*.md"):
            path.unlink()
        again = self.store.save_note({"id": note["id"], "title": "Temporal", "body": "y"})
        self.assertEqual(again["id"], note["id"])
        self.assertEqual(len(self.store.list_notes()), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
