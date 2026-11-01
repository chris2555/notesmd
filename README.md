# notesmd

Notas rápidas para el escritorio de Linux, en Markdown y sin nube. Una especie de Google Keep local: mosaico de tarjetas, etiquetas, búsqueda, fijadas, archivo y papelera.

Cada nota es un archivo `.md` real dentro de `~/Notas-notesmd`: puedes abrirlo con Obsidian, editarlo a mano o copiar la carpeta como copia de seguridad. No hay cuentas, servidores ni telemetría.

![Vista principal en modo oscuro](docs/notesmd-oscuro.png)

## Qué incluye

- Tarjetas en mosaico o en lista, con nueve colores de papel (versión clara y oscura).
- Editor con Markdown y vista previa: negritas, listas, tareas, citas, código y enlaces.
- Etiquetas (`#trabajo`, `#casa`) que filtran el tablero.
- Búsqueda instantánea en título, cuerpo y etiquetas.
- Notas fijadas, archivadas y papelera con deshacer.
- Guardado automático (y `Ctrl+S` para forzar).
- Tema oscuro tipo YouTube (fondo `#0f0f0f`, tarjetas `#212121`) y tema claro.
- Atajos de teclado: `N` para nueva nota, `/` para buscar, `Esc` para cerrar.

## Capturas

| Tema claro | Editor con vista previa |
| --- | --- |
| ![Tema claro](docs/notesmd-claro.png) | ![Editor](docs/notesmd-editor.png) |

## Instalar

Necesitas Linux con Python 3, GTK y WebKit2GTK. En Linux Mint / Ubuntu:

```bash
sudo apt install python3-venv python3-gi gir1.2-webkit2-4.1
```

Después, desde esta carpeta:

```bash
./install.sh
```

El instalador crea un entorno de Python aislado, registra la aplicación en el menú y deja el comando `notesmd` en `~/.local/bin` (si no está en tu `PATH`, añade esa carpeta).

Para abrirla sin instalar:

```bash
./run.sh
```

## Versiones y descargas

La versión vive en una sola línea de `app.py`:

```python
VERSION = "0.1.0"
```

Se usa semver: `MAJOR.MINOR.PATCH` (rompe compatibilidad / funciones nuevas / arreglos). El tag de Git lleva una `v` delante y **tiene que coincidir**: `v0.1.0`.

Para publicar una versión:

```bash
# 1. sube la versión en app.py y anota los cambios en CHANGELOG.md
git add -A
git commit -m "notesmd 0.1.0"
git tag -a v0.1.0 -m "notesmd 0.1.0"
git push origin main --tags
```

Al empujar el tag, `.github/workflows/release.yml` compila los paquetes y crea la
Release con los adjuntos. En la barra lateral del repositorio aparece
**Releases → Latest v0.1.0** con el instalador para descargar.

También puedes generar los paquetes en local:

```bash
./scripts/package.sh          # dist/notesmd-0.1.0.tar.gz y dist/notesmd_0.1.0_all.deb
```

- **`.deb`** (recomendado): `sudo apt install ./notesmd_0.1.0_all.deb`. Instala en
  `/usr/lib/notesmd`, añade `notesmd` al menú y declara las dependencias de GTK/WebKit.
- **`.tar.gz`**: descomprimir y ejecutar `./install.sh` (instalación en tu carpeta personal,
  sin sudo).

La primera Release hay que crearla publicando el tag; a partir de ahí GitHub muestra
siempre la última en esa parte del repositorio.

## Uso

- `N` o el botón **Nueva nota** para escribir.
- `/` enfoca la búsqueda; `Esc` la limpia o cierra el editor.
- `Ctrl+S` guarda al instante (si no, se guarda solo a los ~650 ms).
- Pasa el ratón por una tarjeta para fijarla con el alfiler.
- Las etiquetas se escriben dentro de una nota con `#etiqueta` y aparecen en la barra lateral.

## Tus notas

Por defecto viven en `~/Notas-notesmd` (puedes cambiarlo con `--data-dir` o la variable `NOTESMD_DIR`). La primera vez se crea una nota de bienvenida.

```
~/Notas-notesmd/
├── ideas-para-notesmd-a1b2c3d4.md
├── lista-del-super-9f8e7d6c.md
└── ...
```

Cada archivo lleva un frontmatter con los metadatos de la tarjeta y el resto es Markdown puro:

```markdown
---
id: a1b2c3d4
title: "Ideas para notesmd"
color: ambar
pinned: true
archived: false
trashed: false
created: 2026-10-28T08:12:00
updated: 2026-10-28T08:26:00
tags:
  - proyecto
  - ideas
---

El cuerpo de la nota, en Markdown.
```

## Estructura

```
notesmd/
├── app.py                 # ventana + API expuesta a JavaScript
├── backend/store.py       # almacén Markdown
├── web/
│   ├── index.html
│   ├── css/app.css
│   ├── js/app.js
│   ├── js/vendor/         # marked + DOMPurify
│   └── fonts/             # Fraunces + Public Sans
├── assets/                # iconos
├── docs/                  # capturas para este README
├── scripts/package.sh     # .tar.gz y .deb para las releases
├── .github/workflows/     # release automática al empujar un tag
├── tests/
├── run.sh
├── install.sh
└── uninstall.sh
```

## Desarrollo

La interfaz funciona sola en el navegador con datos de demostración:

```bash
python3 -m http.server 8765 --directory web
# abrir http://127.0.0.1:8765/
```

Para una prueba de humo de la ventana real y del puente con Python:

```bash
.venv/bin/python tests/ui_smoke.py
```

## Si la ventana parpadea

El mosaico se reparte en columnas flex desde JavaScript, no con `columns` de CSS:
WebKitGTK repinta en bucle el layout multicolumna y las tarjetas parpadean.
Además `run.sh` desactiva el renderizador DMABUF de WebKit, que provoca
parpadeos en algunas GPU (NVIDIA/AMD).

Si en tu equipo aún se nota, arranca con el compositor de WebKit desactivado:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./run.sh
```
