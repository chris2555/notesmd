"""notesmd · almacenamiento local en archivos Markdown.

Cada nota es un archivo .md dentro de la carpeta de datos, con un bloque
frontmatter (tipo YAML) que guarda los metadatos de la tarjeta. El cuerpo es
Markdown puro: se puede abrir y editar con cualquier editor de texto.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import tempfile
import threading
import unicodedata
import uuid
from pathlib import Path

COLORS = ("papel", "coral", "ambar", "lima", "menta", "cielo", "lavanda", "rosa", "grafito")
THEMES = ("noche", "dia")
VIEWS = ("masonry", "list")
SORTS = ("updated", "created", "title")
MAX_TITLE = 300
MAX_BODY = 2_000_000
MAX_TAGS = 24
MAX_TAG_LEN = 40

DEFAULT_CONFIG = {"theme": "noche", "view": "masonry", "sort": "updated"}

KNOWN_META = {"id", "title", "created", "updated", "color", "pinned", "archived", "trashed", "tags"}

WELCOME_BODY = """Notas rápidas, en Markdown, guardadas solo aquí.

- Pulsa **N** para crear una nota.
- Pulsa **/** para buscar.
- Escribe en Markdown y cambia a **Vista** para leerlo formateado.
- Cada nota es un archivo `.md` en tu carpeta: sin cuentas, sin nube.

Añade etiquetas con # desde el editor. Cuando quieras, bórrame.
"""


# --------------------------------------------------------------------------
# utilidades
# --------------------------------------------------------------------------

def now_iso() -> str:
    return dt.datetime.now().replace(microsecond=0).isoformat()


def _clean_text(value, limit: int) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    return text[:limit]


def _slug(text: str, fallback: str = "nota") -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    text = re.sub(r"-{2,}", "-", text)[:48].strip("-")
    return text or fallback


def _valid_id(value) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[a-z0-9]{4,24}", value))


def _parse_scalar(raw: str):
    raw = raw.strip()
    if not raw:
        return ""
    if raw[0] == '"':
        try:
            return json.loads(raw)
        except Exception:
            return raw.strip('"')
    if raw[0] == "'" and raw.endswith("'"):
        return raw[1:-1].replace("''", "'")
    if raw[0] == "[":
        try:
            value = json.loads(raw)
            return value if isinstance(value, list) else []
        except Exception:
            inner = raw[1:-1].strip()
            if not inner:
                return []
            return [p.strip().strip("\"'") for p in inner.split(",") if p.strip()]
    low = raw.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    if low in ("null", "~"):
        return None
    return raw


def _timestamps(meta: dict, fallback: dt.datetime) -> tuple[str, str]:
    stamp = fallback.replace(microsecond=0).isoformat()

    def pick(key):
        value = meta.get(key)
        if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", value):
            return value[:19]
        return stamp

    created = pick("created")
    updated = pick("updated")
    return created, updated


def _normalize_tags(value) -> list[str]:
    if isinstance(value, str):
        value = [p for p in re.split(r"[,\n]", value)]
    if not isinstance(value, list):
        return []
    tags, seen = [], set()
    for item in value:
        tag = str(item).strip().lstrip("#").strip()
        tag = tag[:MAX_TAG_LEN]
        key = tag.lower()
        if tag and key not in seen:
            seen.add(key)
            tags.append(tag)
        if len(tags) >= MAX_TAGS:
            break
    return tags


def _yaml_string(value: str) -> str:
    # JSON strings son YAML válido y escapan comillas, saltos y barras.
    return json.dumps(value, ensure_ascii=False)



def _read_frontmatter(lines: list[str]) -> tuple[dict, list[str]]:
    """Lee las claves conocidas y conserva el resto del YAML tal cual."""
    meta: dict = {}
    extra: list[str] = []
    capturing = False
    index = 0
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^([A-Za-z0-9_.-]+)\s*:(.*)$", line)
        if match:
            key = match.group(1).lower()
            value = match.group(2)
            capturing = key not in KNOWN_META
            if capturing:
                extra.append(line)
            elif key == "tags" and not value.strip():
                # listas YAML en bloque:  tags:\n  - casa
                collected = []
                cursor = index + 1
                while cursor < len(lines):
                    item = re.match(r"^\s*-\s+(.*)$", lines[cursor])
                    if not item:
                        break
                    collected.append(_parse_scalar(item.group(1)))
                    cursor += 1
                meta["tags"] = collected
                index = cursor
                continue
            else:
                meta[key] = _parse_scalar(value)
        elif capturing:
            if line.strip() == "---":
                break
            extra.append(line)
        index += 1
    return meta, extra

def parse_markdown(text: str, path: Path) -> dict:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    meta: dict = {}
    extra: list[str] = []
    body = text
    lines = text.split("\n")
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                meta, extra = _read_frontmatter(lines[1:i])
                body = "\n".join(lines[i + 1 :])
                break

    stat = path.stat()
    fallback = dt.datetime.fromtimestamp(stat.st_mtime)
    created, updated = _timestamps(meta, fallback)
    title = _clean_text(meta.get("title"), MAX_TITLE).strip()
    if not title:
        title = path.stem.replace("-", " ").replace("_", " ").strip()
    note_id = meta.get("id")
    if not _valid_id(note_id):
        seed = f"{path.name}:{created}:{stat.st_size}"
        note_id = "x" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:9]

    color = meta.get("color")
    if color not in COLORS:
        color = "papel"

    return {
        "id": note_id,
        "title": title,
        "body": body.lstrip("\n").rstrip("\n"),
        "color": color,
        "pinned": bool(meta.get("pinned", False)),
        "archived": bool(meta.get("archived", False)),
        "trashed": bool(meta.get("trashed", False)),
        "tags": _normalize_tags(meta.get("tags")),
        "created": created,
        "updated": updated,
        "filename": path.name,
        "mtime": stat.st_mtime,
        "extra_lines": extra,
    }


def render_markdown(note: dict) -> str:
    title = note.get("title") or ""
    body = note.get("body") or ""
    tags = _normalize_tags(note.get("tags"))
    lines = [
        "---",
        f"id: {note['id']}",
        f"title: {_yaml_string(title)}",
        f"created: {note['created']}",
        f"updated: {note['updated']}",
        f"color: {note['color']}",
        f"pinned: {'true' if note['pinned'] else 'false'}",
        f"archived: {'true' if note['archived'] else 'false'}",
        f"trashed: {'true' if note['trashed'] else 'false'}",
        f"tags: [{', '.join(_yaml_string(t) for t in tags)}]",
    ]
    for line in note.get("extra_lines") or []:
        if isinstance(line, str) and line.strip() != "---":
            lines.append(line[:4000])
    lines.extend(["---", ""])
    return "\n".join(lines) + body.rstrip("\n") + "\n"


# --------------------------------------------------------------------------
# almacén
# --------------------------------------------------------------------------

class NoteStore:
    def __init__(self, data_dir: Path, config_path: Path):
        self.data_dir = Path(data_dir).expanduser()
        self.config_path = Path(config_path).expanduser()
        self._lock = threading.RLock()
        self._notes: dict[str, dict] = {}
        self._files: dict[str, str] = {}
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config = self._load_config()

    # -- configuración ----------------------------------------------------

    def _load_config(self) -> dict:
        config = dict(DEFAULT_CONFIG)
        try:
            stored = json.loads(self.config_path.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                for key, allowed in (("theme", THEMES), ("view", VIEWS), ("sort", SORTS)):
                    if stored.get(key) in allowed:
                        config[key] = stored[key]
        except Exception:
            pass
        return config

    def save_config(self, patch: dict) -> dict:
        if not isinstance(patch, dict):
            return self.config
        with self._lock:
            for key, allowed in (("theme", THEMES), ("view", VIEWS), ("sort", SORTS)):
                if patch.get(key) in allowed:
                    self.config[key] = patch[key]
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.config_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.config, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, self.config_path)
        return self.config

    # -- lectura ----------------------------------------------------------

    def scan(self) -> list[dict]:
        with self._lock:
            notes: dict[str, dict] = {}
            files: dict[str, str] = {}
            for path in sorted(self.data_dir.glob("*.md")):
                if not path.is_file():
                    continue
                try:
                    note = parse_markdown(path.read_text(encoding="utf-8", errors="replace"), path)
                except Exception:
                    continue
                # ante ids duplicados gana el archivo más reciente
                if note["id"] in notes:
                    if note["updated"] <= notes[note["id"]]["updated"]:
                        continue
                notes[note["id"]] = note
                files[note["id"]] = path.name
            self._notes = notes
            self._files = files
            return [dict(n) for n in notes.values()]

    def list_notes(self) -> list[dict]:
        return self.scan()

    def get(self, note_id: str) -> dict | None:
        note = self._notes.get(note_id)
        return dict(note) if note else None

    # -- escritura --------------------------------------------------------

    def _target_path(self, note: dict) -> Path:
        slug = _slug(note["title"] or "", "nota")
        return self.data_dir / f"{slug}-{note['id']}.md"

    def _write(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=".notesmd-", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, path)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)

    def save_note(self, payload: dict) -> dict:
        if not isinstance(payload, dict):
            raise ValueError("nota inválida")
        with self._lock:
            note_id = payload.get("id")
            if not _valid_id(note_id):
                note_id = uuid.uuid4().hex[:8]
            current = self._notes.get(note_id)
            if current is None and self._files.get(note_id):
                path = self.data_dir / self._files[note_id]
                if path.exists():
                    current = parse_markdown(path.read_text(encoding="utf-8", errors="replace"), path)

            color = payload.get("color")
            note = {
                "id": note_id,
                "title": _clean_text(payload.get("title"), MAX_TITLE).strip(),
                "body": _clean_text(payload.get("body"), MAX_BODY).strip("\n"),
                "color": color if color in COLORS else "papel",
                "pinned": bool(payload.get("pinned", False)),
                "archived": bool(payload.get("archived", False)),
                "trashed": bool(payload.get("trashed", False)),
                "tags": _normalize_tags(payload.get("tags")),
                "extra_lines": [
                    str(line)[:4000]
                    for line in (payload.get("extra_lines") if isinstance(payload.get("extra_lines"), list) else (current or {}).get("extra_lines", []))
                    if str(line).strip() != "---"
                ][:200],
                "created": (current or {}).get("created") or now_iso(),
                "updated": now_iso(),
            }
            if note["trashed"]:
                note["archived"] = False

            target = self._target_path(note)
            old_name = self._files.get(note_id)
            if old_name:
                old_path = self.data_dir / old_name
                if old_path.exists() and old_path != target:
                    try:
                        os.replace(old_path, target)
                    except OSError:
                        target = old_path
            self._write(target, render_markdown(note))
            note["filename"] = target.name
            try:
                note["mtime"] = target.stat().st_mtime
            except OSError:
                note["mtime"] = 0
            self._notes[note_id] = note
            self._files[note_id] = target.name
            return dict(note)

    def update(self, note_id: str, patch: dict) -> dict | None:
        with self._lock:
            current = self._notes.get(note_id)
            if current is None:
                return None
            merged = dict(current)
            merged.update(patch or {})
            merged["id"] = note_id
            return self.save_note(merged)

    def delete_forever(self, note_id: str) -> bool:
        with self._lock:
            name = self._files.get(note_id)
            if name:
                try:
                    (self.data_dir / name).unlink(missing_ok=True)
                except OSError:
                    return False
            self._notes.pop(note_id, None)
            self._files.pop(note_id, None)
            return True

    def empty_trash(self) -> int:
        with self._lock:
            ids = [nid for nid, n in self._notes.items() if n.get("trashed")]
            count = 0
            for note_id in ids:
                if self.delete_forever(note_id):
                    count += 1
            return count

    def ensure_welcome(self) -> None:
        marker = self.data_dir / ".welcome"
        if marker.exists():
            return
        try:
            if not any(self.data_dir.glob("*.md")):
                self.save_note(
                    {
                        "title": "Bienvenido a notesmd",
                        "body": WELCOME_BODY,
                        "color": "ambar",
                        "pinned": True,
                        "tags": ["notesmd"],
                    }
                )
            marker.write_text(now_iso(), encoding="utf-8")
        except OSError:
            pass
