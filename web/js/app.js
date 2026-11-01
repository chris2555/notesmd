(() => {
  'use strict';

  // ---------------------------------------------------------------- datos

  const COLORS = {
    papel: { name: 'Papel', light: '#F8F1DA', dark: '#212121' },
    coral: { name: 'Coral', light: '#F8B9A3', dark: '#3A2321' },
    ambar: { name: 'Ámbar', light: '#F6CE7A', dark: '#352B16' },
    lima: { name: 'Lima', light: '#CDE181', dark: '#26301A' },
    menta: { name: 'Menta', light: '#A2E0BF', dark: '#173029' },
    cielo: { name: 'Cielo', light: '#AED2F4', dark: '#16293A' },
    lavanda: { name: 'Lavanda', light: '#C4B5EF', dark: '#272238' },
    rosa: { name: 'Rosa', light: '#F2B0CE', dark: '#34202A' },
    grafito: { name: 'Grafito', light: '#C2C7CE', dark: '#2A2A2A' },
  };
  const COLOR_KEYS = Object.keys(COLORS);
  const SORTS = ['updated', 'created', 'title'];
  const VIEWS = ['masonry', 'list'];
  const THEMES = ['noche', 'dia'];
  const SAVE_DELAY = 650;
  const MOCK_NOTES_KEY = 'notesmd.demo.notes.v1';
  const MOCK_CONFIG_KEY = 'notesmd.demo.config.v1';

  const state = {
    notes: [],
    config: { theme: 'noche', view: 'masonry', sort: 'updated' },
    filter: { kind: 'all', tag: null },
    query: '',
    editing: null,
    dirty: false,
    preview: false,
    closing: false,
    saveTimer: null,
    savePromise: null,
    lastFocus: null,
    confirmResolve: null,
    dataDir: '',
    cols: 0,
    resizeFrame: null,
  };

  let api = null;
  let els = {};

  // El papel de cada nota tiene dos versiones: pastel (día) y oscura (noche).
  function colorHex(key) {
    const color = COLORS[key] || COLORS.papel;
    return state.config.theme === 'noche' ? color.dark : color.light;
  }

  // ---------------------------------------------------------------- utilidades

  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  const attr = escapeHtml;

  function isoLocal(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 19);
  }

  function shortDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
      return `hoy ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }
    if (date.toDateString() === yesterday.toDateString()) return 'ayer';
    const opts = { day: 'numeric', month: 'short' };
    if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString('es-ES', opts).replace(/\./g, '');
  }

  function longDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  }

  function highlight(text, newlines = false) {
    let html = escapeHtml(text);
    const term = state.query.trim();
    if (term) {
      const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        html = html.replace(new RegExp(pattern, 'gi'), (match) => `<mark>${match}</mark>`);
      } catch (_) { /* término raro: se ignora */ }
    }
    return newlines ? html.replace(/\n/g, '<br>') : html;
  }

  function plainText(markdown) {
    return String(markdown || '')
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, ''))
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/^\s*(---|\*\*\*|___)\s*$/gm, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const hasContent = (note) =>
    Boolean(note && (note.title.trim() || note.body.trim() || (note.tags && note.tags.length)));

  const contentSnapshot = (note) => JSON.stringify([note.title, note.body, note.tags]);

  function upsert(note) {
    const index = state.notes.findIndex((item) => item.id === note.id);
    if (index === -1) state.notes.push(note);
    else state.notes[index] = note;
  }

  function activeNotes() {
    return state.notes.filter((note) => !note.archived && !note.trashed);
  }

  function countLabel(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  // ---------------------------------------------------------------- API local

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readMockConfig() {
    try {
      const stored = JSON.parse(localStorage.getItem(MOCK_CONFIG_KEY) || 'null');
      if (stored && typeof stored === 'object') {
        return {
          theme: THEMES.includes(stored.theme) ? stored.theme : 'noche',
          view: VIEWS.includes(stored.view) ? stored.view : 'masonry',
          sort: SORTS.includes(stored.sort) ? stored.sort : 'updated',
        };
      }
    } catch (_) { /* almacenamiento no disponible */ }
    return { theme: 'noche', view: 'masonry', sort: 'updated' };
  }

  function readMockNotes() {
    try {
      const stored = JSON.parse(localStorage.getItem(MOCK_NOTES_KEY) || 'null');
      if (stored && Array.isArray(stored.notes)) return stored;
    } catch (_) { /* almacenamiento no disponible */ }
    const seeded = { notes: seedNotes() };
    try { localStorage.setItem(MOCK_NOTES_KEY, JSON.stringify(seeded)); } catch (_) { /* nada */ }
    return seeded;
  }

  function persistMock(db) {
    try { localStorage.setItem(MOCK_NOTES_KEY, JSON.stringify(db)); } catch (_) { /* nada */ }
  }

  function seedNotes() {
    const base = Date.now();
    const at = (minutesAgo) => isoLocal(new Date(base - minutesAgo * 60000));
    const mk = (id, title, body, color, tags, pinned, minutesAgo, extra = {}) => ({
      id,
      title,
      body: body.trim(),
      color,
      tags,
      pinned,
      archived: false,
      trashed: false,
      created: at(minutesAgo + 60 * 24 * 3),
      updated: at(minutesAgo),
      mtime: Math.floor((base - minutesAgo * 60000) / 1000),
      filename: `${id}.md`,
      ...extra,
    });

    return [
      mk('demoide1', 'Ideas para notesmd', `- Buscar por etiquetas y contenido
- Vista de mosaico y lista
- **Atajos**: \`N\` para escribir, \`/\` para buscar
- Exportar la carpeta tal cual: son archivos \`.md\`

> Lo que no se sincroniza, no se filtra.`, 'ambar', ['proyecto', 'ideas'], true, 18),
      mk('demosup2', 'Lista del súper', `- [ ] Pan de masa madre
- [ ] Café en grano
- [x] Leche de avena
- [ ] Tomates
- [ ] Aceite de oliva`, 'papel', ['casa'], false, 55),
      mk('demosql3', 'Consulta de SQL', `Para el informe del lunes:

\`\`\`sql
select cliente, sum(total) as gasto
from pedidos
where fecha >= '2026-10-01'
group by cliente
order by gasto desc;
\`\`\``, 'cielo', ['trabajo'], false, 180),
      mk('demoreu4', 'Reunión del jueves', `**Orden del día**

1. Estado del rediseño
2. Costes de infraestructura
3. Turnos de noviembre

> Llevar el borrador impreso.`, 'menta', ['trabajo'], false, 60 * 25),
      mk('demolib5', 'Libros pendientes', `1. *Los detectives salvajes*
2. *La mano izquierda de la oscuridad*
3. *Cien años de soledad* (relectura)

Empezar por el de Bolaño.`, 'rosa', ['lectura'], false, 60 * 49),
      mk('demoru6', 'Rutina de la mañana', `- [x] Agua antes del café
- [x] Estirar diez minutos
- [ ] Revisar la agenda
- [ ] Caminar antes de abrir el portátil`, 'lavanda', ['salud'], false, 300),
      mk('demoreg7', 'Regalo para mamá', `Mirar la librería del barrio. Le gustó el libro de cocina de Ottolenghi, pero ya lo tiene.

Presupuesto: 25 €.`, 'coral', ['personal'], false, 60 * 32),
      mk('demolin8', 'Enlaces guardados', `- [Documentación de WebKit](https://webkit.org)
- [Markdown: guía rápida](https://commonmark.org/help/)
- [Fuentes libres](https://fonts.google.com)

Abrir solo lo necesario.`, 'grafito', ['trabajo'], false, 60 * 24 * 4),
      mk('demoarq9', 'Notas del curso', `Tema 3: **estructuras de datos**.

- Pilas y colas
- Árboles binarios
- Ejercicios del capítulo 6`, 'papel', ['curso'], false, 60 * 24 * 6, { archived: true }),
      mk('demotr10', 'Prueba de formato', `Esto era solo una prueba.

~~Ya no hace falta.~~`, 'papel', [], false, 60 * 24 * 2, { trashed: true }),
      mk('demoru11', 'Llamar al taller', `Preguntar por la revisión de los frenos.

Teléfono en la agenda del móvil.`, 'lima', ['casa', 'personal'], false, 60 * 24 * 7),
    ];
  }

  const mockApi = {
    async bootstrap() {
      const db = readMockNotes();
      return {
        notes: clone(db.notes),
        config: readMockConfig(),
        data_dir: '~/Notas-notesmd',
        version: '0.1.0-demo',
      };
    },
    async sync() {
      return clone(readMockNotes().notes);
    },
    async save_note(payload) {
      const db = readMockNotes();
      const stamp = isoLocal();
      let note = db.notes.find((item) => item.id === payload.id);
      if (note) {
        Object.assign(note, payload, { updated: stamp, mtime: Date.now() / 1000 });
      } else {
        note = {
          ...payload,
          id: payload.id || `demo${Math.random().toString(36).slice(2, 8)}`,
          created: payload.created || stamp,
          updated: stamp,
          mtime: Date.now() / 1000,
          filename: `${payload.id || Math.random().toString(36).slice(2, 8)}.md`,
        };
        db.notes.push(note);
      }
      if (note.trashed) note.archived = false;
      persistMock(db);
      return clone(note);
    },
    async set_flag(id, flag, value) {
      const db = readMockNotes();
      const note = db.notes.find((item) => item.id === id);
      if (!note) return null;
      note[flag] = Boolean(value);
      if (flag === 'trashed' && value) note.archived = false;
      if (flag === 'archived' && value) note.trashed = false;
      note.updated = isoLocal();
      note.mtime = Date.now() / 1000;
      persistMock(db);
      return clone(note);
    },
    async delete_forever(id) {
      const db = readMockNotes();
      db.notes = db.notes.filter((item) => item.id !== id);
      persistMock(db);
      return true;
    },
    async empty_trash() {
      const db = readMockNotes();
      const count = db.notes.filter((item) => item.trashed).length;
      db.notes = db.notes.filter((item) => !item.trashed);
      persistMock(db);
      return count;
    },
    async save_config(patch) {
      const config = { ...readMockConfig(), ...patch };
      try { localStorage.setItem(MOCK_CONFIG_KEY, JSON.stringify(config)); } catch (_) { /* nada */ }
      return config;
    },
    async open_data_dir() {
      return true;
    },
    async open_url(url) {
      window.open(url, '_blank', 'noopener');
      return true;
    },
  };

  function whenReady() {
    // pywebview inyecta su API y luego emite "pywebviewready". Si abrimos la
    // página en un navegador normal, no llega nunca y usamos el modo demo.
    const current = window.pywebview && window.pywebview.api;
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        resolve(value);
      };
      window.addEventListener('pywebviewready', () => finish(window.pywebview ? window.pywebview.api : null), { once: true });
      setTimeout(() => finish(window.pywebview ? window.pywebview.api : null), 1600);
    });
  }

  // ---------------------------------------------------------------- arranque

  async function init() {
    cacheElements();
    bindStaticEvents();

    const params = new URLSearchParams(location.search);
    if (params.has('reset')) {
      try {
        localStorage.removeItem(MOCK_NOTES_KEY);
        localStorage.removeItem(MOCK_CONFIG_KEY);
      } catch (_) { /* nada */ }
    }

    const backend = await whenReady();
    const mock = !backend;
    api = backend || mockApi;

    try {
      const data = await api.bootstrap();
      state.notes = Array.isArray(data.notes) ? data.notes : [];
      state.dataDir = data.data_dir || '';
      state.config = {
        theme: THEMES.includes(data.config && data.config.theme) ? data.config.theme : 'noche',
        view: VIEWS.includes(data.config && data.config.view) ? data.config.view : 'masonry',
        sort: SORTS.includes(data.config && data.config.sort) ? data.config.sort : 'updated',
      };
    } catch (error) {
      console.error(error);
      toast('No se pudieron leer las notas. Revisa la carpeta de datos.', null, null, true);
    }

    // pequeñas ayudas para revisar la interfaz con parámetros de URL
    if (THEMES.includes(params.get('theme'))) state.config.theme = params.get('theme');
    if (VIEWS.includes(params.get('view'))) state.config.view = params.get('view');

    if (mock) {
      document.body.dataset.demo = 'true';
      els.demoBadge.hidden = false;
    }
    applyConfig();
    buildPalette();
    renderAll();
    watchGridWidth();

    if (state.dataDir) els.openFolder.title = `Abrir ${state.dataDir}`;

    const openId = params.get('open');
    if (openId) {
      setTimeout(() => {
        openEditor(openId);
        if (params.get('preview') === '1') applyPreview(true);
      }, 80);
    }
  }

  function cacheElements() {
    els = {
      board: $('#board'),
      grid: $('#grid'),
      empty: $('#empty'),
      labels: $('#labels'),
      viewTitle: $('#view-title'),
      viewCount: $('#view-count'),
      search: $('#search'),
      searchClear: $('#search-clear'),
      sort: $('#sort'),
      viewButtons: Array.from(document.querySelectorAll('[data-view-mode]')),
      emptyTrash: $('#empty-trash'),
      newNote: $('#new-note'),
      composer: $('#composer'),
      openFolder: $('#open-folder'),
      themeToggle: $('#theme-toggle'),
      themeIcon: $('#theme-icon'),
      navItems: Array.from(document.querySelectorAll('.nav-item')),
      overlay: $('#overlay'),
      sheet: $('#sheet'),
      noteTitle: $('#note-title'),
      noteBody: $('#note-body'),
      notePreview: $('#note-preview'),
      tagEditor: $('#tag-editor'),
      tagInput: $('#tag-input'),
      tagOptions: $('#tag-options'),
      pinToggle: $('#pin-toggle'),
      colorBtn: $('#color-btn'),
      colorDot: $('#color-dot'),
      palette: $('#palette'),
      closeEditor: $('#close-editor'),
      formatBar: $('#format-bar'),
      previewToggle: $('#preview-toggle'),
      archiveBtn: $('#archive-btn'),
      deleteBtn: $('#delete-btn'),
      doneBtn: $('#done-btn'),
      saveStatus: $('#save-status'),
      wordCount: $('#word-count'),
      confirmLayer: $('#confirm-layer'),
      confirmTitle: $('#confirm-title'),
      confirmText: $('#confirm-text'),
      confirmOk: $('#confirm-ok'),
      confirmCancel: $('#confirm-cancel'),
      toast: $('#toast'),
      demoBadge: $('#demo-badge'),
    };
  }

  // ---------------------------------------------------------------- eventos

  function bindStaticEvents() {
    els.newNote.addEventListener('click', () => openEditor());
    els.composer.addEventListener('click', () => openEditor());

    els.navItems.forEach((item) => {
      item.addEventListener('click', () => setFilter(item.dataset.view));
    });

    els.labels.addEventListener('click', (event) => {
      const label = event.target.closest('.label-item');
      if (label) setTagFilter(label.dataset.tag);
    });

    els.search.addEventListener('input', () => {
      state.query = els.search.value;
      els.searchClear.hidden = !state.query;
      els.search.classList.toggle('has-query', Boolean(state.query));
      els.board.scrollTop = 0;
      renderGrid();
    });
    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSearch();
        els.search.blur();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const first = els.grid.querySelector('.note');
        if (first) openEditor(first.dataset.id);
      }
    });
    els.searchClear.addEventListener('click', () => {
      clearSearch();
      els.search.focus();
    });

    els.sort.addEventListener('change', () => {
      state.config.sort = SORTS.includes(els.sort.value) ? els.sort.value : 'updated';
      saveConfig({ sort: state.config.sort });
      renderGrid();
    });

    els.viewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const view = button.dataset.viewMode;
        if (!VIEWS.includes(view) || view === state.config.view) return;
        state.config.view = view;
        saveConfig({ view });
        renderAll();
      });
    });

    els.themeToggle.addEventListener('click', () => {
      const theme = state.config.theme === 'noche' ? 'dia' : 'noche';
      state.config.theme = theme;
      applyConfig();
      refreshThemeSurfaces();
      renderAll();
      saveConfig({ theme });
    });

    els.openFolder.addEventListener('click', async () => {
      try {
        const ok = await api.open_data_dir();
        toast(ok ? 'Carpeta de notas abierta.' : 'No se pudo abrir la carpeta.');
      } catch (error) {
        console.error(error);
        toast('No se pudo abrir la carpeta de notas.', null, null, true);
      }
    });

    els.emptyTrash.addEventListener('click', emptyTrash);

    els.grid.addEventListener('click', onGridClick);
    els.grid.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.note');
      if (!card || event.target.closest('button')) return;
      event.preventDefault();
      openEditor(card.dataset.id);
    });

    // editor
    els.overlay.addEventListener('mousedown', (event) => {
      if (event.target === els.overlay) closeEditor();
    });
    els.closeEditor.addEventListener('click', closeEditor);
    els.doneBtn.addEventListener('click', closeEditor);

    els.noteTitle.addEventListener('input', () => {
      if (!state.editing) return;
      state.editing.title = els.noteTitle.value;
      markDirty();
    });
    els.noteTitle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.noteBody.focus();
      }
    });

    els.noteBody.addEventListener('input', () => {
      if (!state.editing) return;
      state.editing.body = els.noteBody.value;
      updateWordCount();
      markDirty();
    });
    els.noteBody.addEventListener('keydown', onBodyKeydown);

    els.tagInput.addEventListener('keydown', onTagKeydown);
    els.tagInput.addEventListener('blur', () => {
      if (els.tagInput.value.trim()) addTag(els.tagInput.value);
    });
    els.tagEditor.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-tag]');
      if (!remove) return;
      removeTag(remove.dataset.removeTag);
    });

    els.pinToggle.addEventListener('click', togglePinInEditor);
    els.colorBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (els.palette.hidden) openPalette();
      else closePalette();
    });
    els.palette.addEventListener('click', (event) => {
      const swatch = event.target.closest('[data-color]');
      if (!swatch) return;
      applyColor(swatch.dataset.color);
      closePalette();
      els.colorBtn.focus();
    });
    document.addEventListener('mousedown', (event) => {
      if (els.palette.hidden) return;
      if (els.colorBtn.contains(event.target) || els.palette.contains(event.target)) return;
      closePalette();
    });

    els.previewToggle.addEventListener('click', () => applyPreview(!state.preview));

    els.formatBar.addEventListener('mousedown', (event) => {
      // evita que el textarea pierda la selección antes de aplicar formato
      if (event.target.closest('.fmt-btn')) event.preventDefault();
    });
    els.formatBar.addEventListener('click', (event) => {
      const button = event.target.closest('.fmt-btn');
      if (button) applyMarkdown(button.dataset.md);
    });

    els.archiveBtn.addEventListener('click', onArchiveClick);
    els.deleteBtn.addEventListener('click', onDeleteClick);

    els.notePreview.addEventListener('click', onPreviewClick);

    els.sheet.addEventListener('keydown', trapFocus);

    // confirmación
    els.confirmCancel.addEventListener('click', () => resolveConfirm(false));
    els.confirmOk.addEventListener('click', () => resolveConfirm(true));
    els.confirmLayer.addEventListener('mousedown', (event) => {
      if (event.target === els.confirmLayer) resolveConfirm(false);
    });

    // global
    document.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('blur', () => {
      if (state.editing && state.dirty) flushSave();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (state.editing && state.dirty) flushSave();
      } else {
        syncFromDisk();
      }
    });
    window.addEventListener('focus', syncFromDisk);
    window.addEventListener('beforeunload', () => {
      if (state.editing && state.dirty) flushSave();
    });
  }

  function onGridClick(event) {
    const card = event.target.closest('.note');
    if (!card) return;

    const pin = event.target.closest('.pin-btn');
    if (pin) {
      event.stopPropagation();
      togglePinCard(card.dataset.id);
      return;
    }

    const tag = event.target.closest('.tag-chip');
    if (tag) {
      event.stopPropagation();
      setTagFilter(tag.dataset.tag);
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().trim()) return;
    openEditor(card.dataset.id);
  }

  function onGlobalKeydown(event) {
    if (!els.confirmLayer.hidden) {
      if (event.key === 'Escape') resolveConfirm(false);
      return;
    }

    if (!els.overlay.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!els.palette.hidden) closePalette();
        else closeEditor();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        flushSave();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        closeEditor();
      }
      return;
    }

    const tag = (event.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable;
    if (typing) return;

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      openEditor();
    } else if (event.key === '/') {
      event.preventDefault();
      els.search.focus();
      els.search.select();
    }
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(
      els.sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')
    ).filter((node) => node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------- vistas

  function setFilter(kind) {
    if (!['all', 'archived', 'trash'].includes(kind)) return;
    state.filter = { kind, tag: null };
    state.query = '';
    els.search.value = '';
    els.searchClear.hidden = true;
    els.search.classList.remove('has-query');
    els.board.scrollTop = 0;
    renderAll();
  }

  function setTagFilter(tag) {
    if (!tag) return;
    if (state.filter.kind === 'tag' && state.filter.tag.toLowerCase() === tag.toLowerCase()) {
      setFilter('all');
      return;
    }
    state.filter = { kind: 'tag', tag };
    state.query = '';
    els.search.value = '';
    els.searchClear.hidden = true;
    els.search.classList.remove('has-query');
    els.board.scrollTop = 0;
    renderAll();
  }

  function clearSearch() {
    state.query = '';
    els.search.value = '';
    els.searchClear.hidden = true;
    els.search.classList.remove('has-query');
    renderGrid();
  }

  function visibleNotes() {
    const term = state.query.trim().toLowerCase();
    const filter = state.filter;
    const list = state.notes.filter((note) => {
      if (filter.kind === 'trash') return Boolean(note.trashed);
      if (filter.kind === 'archived') return Boolean(note.archived) && !note.trashed;
      if (filter.kind === 'tag') {
        return (
          !note.archived &&
          !note.trashed &&
          note.tags.some((tag) => tag.toLowerCase() === filter.tag.toLowerCase())
        );
      }
      return !note.archived && !note.trashed;
    });

    const matches = term
      ? list.filter((note) => {
          return (
            (note.title || '').toLowerCase().includes(term) ||
            (note.body || '').toLowerCase().includes(term) ||
            note.tags.some((tag) => tag.toLowerCase().includes(term))
          );
        })
      : list;

    const sortKey = state.config.sort;
    matches.sort((a, b) => {
      if (filter.kind !== 'trash' && Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      if (sortKey === 'title') {
        return (a.title || 'Sin título').localeCompare(b.title || 'Sin título', 'es', {
          sensitivity: 'base',
          numeric: true,
        });
      }
      return String(b[sortKey] || '').localeCompare(String(a[sortKey] || ''));
    });

    return matches;
  }

  function renderAll() {
    applyConfig();
    renderSidebar();
    renderGrid();
  }

  function applyConfig() {
    document.documentElement.dataset.theme = state.config.theme;
    els.sort.value = state.config.sort;
    els.viewButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.viewMode === state.config.view));
    });
    if (els.themeIcon) {
      els.themeIcon.querySelector('use').setAttribute(
        'href',
        state.config.theme === 'noche' ? '#i-sun' : '#i-moon'
      );
    }
    els.themeToggle.title = state.config.theme === 'noche' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    els.themeToggle.setAttribute('aria-label', els.themeToggle.title);
  }

  // Al cambiar de tema hay que repintar el papel y el editor con su hex oscuro/claro.
  function refreshThemeSurfaces() {
    buildPalette();
    if (!state.editing) return;
    els.sheet.style.setProperty('--sheet', colorHex(state.editing.color));
    els.colorDot.style.background = colorHex(state.editing.color);
  }

  // El mosaico se reparte en columnas flex (no en columnas CSS): WebKitGTK
  // repinta en bucle el layout multicolumna y eso hacía parpadear las notas.
  function watchGridWidth() {
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (state.editing || state.resizeFrame) return;
      state.resizeFrame = requestAnimationFrame(() => {
        state.resizeFrame = null;
        if (state.config.view === 'list') return;
        if (columnCount() !== state.cols) renderGrid();
      });
    });
    observer.observe(els.grid);
  }

  function columnCount() {
    const width = els.grid.clientWidth || els.board.clientWidth;
    const min = 236;
    const gap = 15;
    return Math.max(1, Math.floor((width + gap) / (min + gap)));
  }

  function estimateCardHeight(note) {
    const title = note.title || 'Sin título';
    const body = plainText(note.body);
    const titleLines = Math.max(1, Math.ceil(title.length / 24));
    const bodyLines = Math.min(9, Math.ceil(body.length / 32));
    return 46 + titleLines * 23 + bodyLines * 21 + (body ? 8 : 0) + (note.tags.length ? 24 : 0);
  }

  function paintGrid(notes) {
    if (!notes.length) {
      els.grid.innerHTML = '';
      state.cols = 0;
      return;
    }

    const cols = state.config.view === 'list' ? 1 : columnCount();
    state.cols = cols;

    // Reparte cada nota en la columna más corta: mosaico estable, sin saltos.
    const buckets = Array.from({ length: cols }, () => ({ items: [], height: 0 }));
    notes.forEach((note) => {
      let target = buckets[0];
      for (const bucket of buckets) {
        if (bucket.height < target.height) target = bucket;
      }
      target.items.push(note);
      target.height += estimateCardHeight(note);
    });

    els.grid.innerHTML = buckets
      .map((bucket) => `<div class="grid-col">${bucket.items.map(renderCard).join('')}</div>`)
      .join('');
  }

  function renderSidebar() {
    const counts = {
      all: activeNotes().length,
      archived: state.notes.filter((note) => note.archived && !note.trashed).length,
      trash: state.notes.filter((note) => note.trashed).length,
    };
    document.querySelectorAll('[data-count]').forEach((node) => {
      node.textContent = String(counts[node.dataset.count] ?? 0);
    });

    els.navItems.forEach((item) => {
      item.classList.toggle('is-active', state.filter.kind === item.dataset.view);
    });

    const tags = new Map();
    activeNotes().forEach((note) => {
      note.tags.forEach((tag) => {
        const key = tag.toLowerCase();
        if (!tags.has(key)) tags.set(key, { name: tag, count: 0 });
        tags.get(key).count += 1;
      });
    });
    const ordered = Array.from(tags.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    );

    if (!ordered.length) {
      els.labels.innerHTML = '<p class="labels-empty">Añade etiquetas desde una nota y aparecerán aquí.</p>';
    } else {
      const previous = els.labels.scrollTop;
      els.labels.innerHTML = ordered
        .map((tag) => {
          const active = state.filter.kind === 'tag' && state.filter.tag.toLowerCase() === tag.name.toLowerCase();
          return `<button class="label-item${active ? ' is-active' : ''}" type="button" data-tag="${attr(tag.name)}">
            <span class="hash">#</span>
            <span class="label-name">${escapeHtml(tag.name)}</span>
            <span class="count">${tag.count}</span>
          </button>`;
        })
        .join('');
      els.labels.scrollTop = previous;
    }
  }

  function renderGrid() {
    const notes = visibleNotes();
    const titleMap = {
      all: 'Todas las notas',
      archived: 'Archivadas',
      trash: 'Papelera',
      tag: `#${state.filter.tag || ''}`,
    };

    els.viewTitle.textContent = titleMap[state.filter.kind] || 'Notas';
    els.viewCount.textContent = String(notes.length);
    els.emptyTrash.hidden = !(state.filter.kind === 'trash' && state.notes.some((note) => note.trashed));
    els.composer.hidden = state.filter.kind === 'archived' || state.filter.kind === 'trash';
    els.grid.classList.toggle('is-list', state.config.view === 'list');
    paintGrid(notes);
    renderEmpty(notes.length);
  }

  function renderCard(note) {
    const color = COLORS[note.color] ? note.color : 'papel';
    const title = note.title || 'Sin título';
    const excerpt = plainText(note.body);
    const tags = note.tags
      .map(
        (tag) => `<button class="tag-chip" type="button" data-tag="${attr(tag)}" title="Filtrar por #${attr(tag)}"><span class="hash">#</span>${escapeHtml(tag)}</button>`
      )
      .join('');
    const date = shortDate(note.updated);

    return `<article class="note${note.pinned ? ' is-pinned' : ''}" tabindex="0" data-id="${attr(note.id)}" data-color="${attr(color)}" style="--paper:${colorHex(color)}" aria-label="Abrir nota: ${attr(title)}">
      <button class="pin-btn" type="button" aria-label="${note.pinned ? 'Soltar nota' : 'Fijar nota'}" aria-pressed="${Boolean(note.pinned)}" title="${note.pinned ? 'Soltar nota' : 'Fijar nota'}">
        <svg class="i" aria-hidden="true"><use href="#i-pin"/></svg>
      </button>
      <h2 class="note-title">${highlight(title)}</h2>
      ${excerpt ? `<p class="note-body">${highlight(excerpt, true)}</p>` : ''}
      ${tags ? `<div class="note-tags">${tags}</div>` : ''}
      <div class="note-foot">
        <span class="note-date" title="${attr(longDate(note.updated))}">Editada ${escapeHtml(date)}</span>
      </div>
    </article>`;
  }

  function renderEmpty(count) {
    const empty = count === 0;
    els.empty.hidden = !empty;
    if (!empty) return;

    let title = '';
    let text = '';
    let action = '';
    let actionLabel = '';
    const term = state.query.trim();

    if (term) {
      title = 'Sin resultados';
      text = `No hay notas que coincidan con «${term}». Prueba con otra palabra o etiqueta.`;
      action = 'clear-search';
      actionLabel = 'Limpiar búsqueda';
    } else if (state.filter.kind === 'trash') {
      title = 'La papelera está vacía.';
      text = 'Las notas que elimines aparecerán aquí antes de borrarse del todo.';
      action = 'go-all';
      actionLabel = 'Volver a las notas';
    } else if (state.filter.kind === 'archived') {
      title = 'Nada archivado.';
      text = 'Archiva las notas que quieras apartar sin borrarlas.';
      action = 'go-all';
      actionLabel = 'Ver todas las notas';
    } else if (state.filter.kind === 'tag') {
      title = `Sin notas en #${state.filter.tag}`;
      text = 'Añade la etiqueta a una nota o elige otra etiqueta.';
      action = 'go-all';
      actionLabel = 'Ver todas las notas';
    } else {
      title = 'Tu mesa está limpia.';
      text = 'Escribe tu primera nota. Todo se guarda en Markdown, solo en este equipo.';
      action = 'new';
      actionLabel = 'Escribir una nota';
    }

    els.empty.innerHTML = `<div class="empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
      ${action ? `<button class="primary-btn" type="button" data-empty-action="${action}">${escapeHtml(actionLabel)}</button>` : ''}`;

    const button = els.empty.querySelector('[data-empty-action]');
    if (button) {
      button.addEventListener('click', () => {
        const kind = button.dataset.emptyAction;
        if (kind === 'new') openEditor();
        else if (kind === 'clear-search') clearSearch();
        else setFilter('all');
      });
    }
  }

  // ---------------------------------------------------------------- guardado

  function markDirty() {
    if (!state.editing) return;
    state.dirty = true;
    setStatus('saving');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushSave(), SAVE_DELAY);
  }

  function setStatus(kind, text) {
    const labels = {
      saved: 'Guardado',
      saving: 'Guardando…',
      error: 'No se pudo guardar',
      idle: 'Sin guardar',
    };
    const classes = { saving: ' is-saving', error: ' is-error', idle: ' is-idle' };
    els.saveStatus.className = 'save-status' + (classes[kind] || '');
    els.saveStatus.innerHTML = `<i aria-hidden="true"></i><span>${escapeHtml(text || labels[kind] || '')}</span>`;
  }

  async function flushSave() {
    clearTimeout(state.saveTimer);
    if (!state.editing) return true;
    if (state.savePromise) await state.savePromise;
    if (!state.editing) return true;

    const target = state.editing;
    if (!target.id && !hasContent(target)) {
      if (!target.title && !target.body && !target.tags.length) setStatus('idle');
      return true;
    }
    if (!state.dirty) return true;

    const snapshot = contentSnapshot(target);
    const payload = { ...target, tags: [...target.tags] };
    setStatus('saving');

    const promise = (async () => {
      try {
        const saved = await api.save_note(payload);
        if (state.editing === target) {
          Object.assign(target, saved);
          if (contentSnapshot(target) === snapshot) state.dirty = false;
          setStatus('saved');
          updateWordCount();
        }
        upsert(saved);
        renderSidebar();
        renderGrid();
        return true;
      } catch (error) {
        console.error(error);
        if (state.editing === target) setStatus('error');
        toast('No se pudo guardar. Revisa los permisos de la carpeta de notas.', null, null, true);
        return false;
      }
    })();

    state.savePromise = promise;
    const ok = await promise;
    state.savePromise = null;

    if (ok && state.dirty && state.editing === target) return flushSave();
    return ok;
  }

  async function saveConfig(patch) {
    try {
      const config = await api.save_config(patch);
      if (config) {
        state.config = {
          theme: THEMES.includes(config.theme) ? config.theme : state.config.theme,
          view: VIEWS.includes(config.view) ? config.view : state.config.view,
          sort: SORTS.includes(config.sort) ? config.sort : state.config.sort,
        };
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function syncFromDisk() {
    if (state.editing || state.savePromise) return;
    const signature = (notes) => notes.map((note) => `${note.id}:${note.updated}:${note.mtime || ''}`).sort().join('|');
    const before = signature(state.notes);
    try {
      const fresh = await api.sync();
      if (Array.isArray(fresh) && signature(fresh) !== before) {
        state.notes = fresh;
        renderAll();
      }
    } catch (_) { /* silencioso: se reintenta al volver a enfocar */ }
  }

  // ---------------------------------------------------------------- editor

  function openEditor(id) {
    let note;
    if (id) {
      const found = state.notes.find((item) => item.id === id);
      if (!found) return;
      note = { ...found, tags: [...found.tags] };
    } else {
      if (state.query) {
        state.query = '';
        els.search.value = '';
        els.searchClear.hidden = true;
        els.search.classList.remove('has-query');
      }
      note = {
        id: null,
        title: '',
        body: '',
        color: 'papel',
        pinned: false,
        archived: false,
        trashed: false,
        tags: state.filter.kind === 'tag' ? [state.filter.tag] : [],
        created: isoLocal(),
        updated: isoLocal(),
        filename: null,
      };
      if (state.filter.kind !== 'all' && state.filter.kind !== 'tag') {
        setFilter('all');
      }
    }

    state.editing = note;
    state.dirty = false;
    state.preview = false;
    state.lastFocus = document.activeElement;

    els.sheet.classList.toggle('is-trashed', Boolean(note.trashed));
    els.sheet.style.setProperty('--sheet', colorHex(note.color));
    els.noteTitle.value = note.title;
    els.noteTitle.readOnly = Boolean(note.trashed);
    els.noteBody.value = note.body;
    els.noteBody.readOnly = Boolean(note.trashed);
    els.colorDot.style.background = colorHex(note.color);
    els.pinToggle.setAttribute('aria-pressed', String(Boolean(note.pinned)));
    els.pinToggle.hidden = Boolean(note.trashed);
    els.colorBtn.parentElement.hidden = Boolean(note.trashed);
    els.tagInput.hidden = Boolean(note.trashed);
    els.formatBar.hidden = Boolean(note.trashed);
    els.tagInput.value = '';

    renderEditorTags();
    updateTagOptions();
    syncArchiveButton();
    updateWordCount();
    applyPreview(Boolean(note.trashed), false);

    if (note.trashed) {
      setStatus('idle', 'En papelera');
      els.saveStatus.hidden = false;
      els.deleteBtn.querySelector('span').textContent = 'Eliminar para siempre';
    } else {
      els.saveStatus.hidden = false;
      els.deleteBtn.querySelector('span').textContent = 'Eliminar';
      setStatus(note.id ? 'saved' : 'idle');
    }

    closePalette();
    els.overlay.hidden = false;
    document.body.classList.add('is-editing');

    requestAnimationFrame(() => {
      if (note.trashed) {
        els.doneBtn.focus();
      } else if (!note.title) {
        els.noteTitle.focus();
      } else {
        els.noteBody.focus();
        const end = els.noteBody.value.length;
        els.noteBody.setSelectionRange(end, end);
      }
    });
  }

  function dismissEditor() {
    clearTimeout(state.saveTimer);
    els.overlay.hidden = true;
    document.body.classList.remove('is-editing');
    els.notePreview.innerHTML = '';
    state.editing = null;
    state.dirty = false;
    state.preview = false;
    state.savePromise = null;
  }

  async function closeEditor() {
    if (!state.editing || state.closing) return;
    state.closing = true;
    const ok = await flushSave();
    state.closing = false;
    if (!ok) return;

    const previous = state.lastFocus;
    dismissEditor();
    renderAll();
    if (previous && document.contains(previous)) previous.focus();
    else els.search.focus();
  }

  function updateWordCount() {
    if (!state.editing) return;
    const text = state.editing.body.trim();
    const words = text ? text.split(/\s+/).length : 0;
    els.wordCount.textContent = words ? `${countLabel(words, 'palabra', 'palabras')}` : '';
  }

  function syncArchiveButton() {
    const note = state.editing;
    if (!note) return;
    const use = els.archiveBtn.querySelector('use');
    const label = els.archiveBtn.querySelector('span');
    if (note.trashed) {
      use.setAttribute('href', '#i-restore');
      label.textContent = 'Restaurar';
      els.archiveBtn.classList.remove('danger');
      els.archiveBtn.hidden = false;
      els.pinToggle.hidden = true;
    } else if (note.archived) {
      use.setAttribute('href', '#i-restore');
      label.textContent = 'Desarchivar';
      els.archiveBtn.hidden = false;
    } else {
      use.setAttribute('href', '#i-archive');
      label.textContent = 'Archivar';
      els.archiveBtn.hidden = false;
    }
  }

  function renderEditorTags() {
    const note = state.editing;
    if (!note) return;
    els.tagEditor.querySelectorAll('.tag-chip').forEach((chip) => chip.remove());
    const html = note.tags
      .map(
        (tag) => `<span class="tag-chip"><span class="hash">#</span>${escapeHtml(tag)}${
          note.trashed
            ? ''
            : `<button class="chip-x" type="button" data-remove-tag="${attr(tag)}" aria-label="Quitar etiqueta ${attr(tag)}" title="Quitar etiqueta"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button>`
        }</span>`
      )
      .join('');
    els.tagInput.insertAdjacentHTML('beforebegin', html);
  }

  function updateTagOptions() {
    if (!state.editing) return;
    const current = new Set(state.editing.tags.map((tag) => tag.toLowerCase()));
    const all = new Map();
    state.notes.forEach((note) => {
      note.tags.forEach((tag) => {
        if (!current.has(tag.toLowerCase())) all.set(tag.toLowerCase(), tag);
      });
    });
    els.tagOptions.innerHTML = Array.from(all.values())
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
      .map((tag) => `<option value="${attr(tag)}"></option>`)
      .join('');
  }

  function onTagKeydown(event) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(els.tagInput.value);
    } else if (event.key === 'Backspace' && !els.tagInput.value && state.editing && state.editing.tags.length) {
      event.preventDefault();
      removeTag(state.editing.tags[state.editing.tags.length - 1]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      els.tagInput.blur();
    }
  }

  function addTag(raw) {
    const note = state.editing;
    if (!note) return;
    const tag = String(raw || '').trim().replace(/^#+/, '').trim().slice(0, 40);
    if (!tag) return;
    if (note.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) {
      els.tagInput.value = '';
      return;
    }
    if (note.tags.length >= 24) {
      els.tagInput.value = '';
      return;
    }
    note.tags.push(tag);
    els.tagInput.value = '';
    renderEditorTags();
    updateTagOptions();
    markDirty();
    els.tagInput.focus();
  }

  function removeTag(tag) {
    const note = state.editing;
    if (!note) return;
    note.tags = note.tags.filter((item) => item.toLowerCase() !== String(tag).toLowerCase());
    renderEditorTags();
    updateTagOptions();
    markDirty();
  }

  async function togglePinInEditor() {
    const note = state.editing;
    if (!note) return;
    note.pinned = !note.pinned;
    els.pinToggle.setAttribute('aria-pressed', String(note.pinned));
    if (note.id) await flushSave();
    else markDirty();
  }

  function buildPalette() {
    els.palette.innerHTML = COLOR_KEYS.map((key) => {
      const color = COLORS[key];
      return `<button type="button" role="menuitemradio" aria-checked="false" data-color="${key}" title="${attr(color.name)}" aria-label="${attr(color.name)}" style="background:${colorHex(key)}"></button>`;
    }).join('');
  }

  function openPalette() {
    if (!state.editing) return;
    COLOR_KEYS.forEach((key) => {
      const button = els.palette.querySelector(`[data-color="${key}"]`);
      if (button) button.setAttribute('aria-checked', String(key === state.editing.color));
    });
    els.palette.hidden = false;
    els.colorBtn.setAttribute('aria-expanded', 'true');
  }

  function closePalette() {
    els.palette.hidden = true;
    els.colorBtn.setAttribute('aria-expanded', 'false');
  }

  function applyColor(key) {
    const note = state.editing;
    if (!note || !COLORS[key]) return;
    note.color = key;
    els.sheet.style.setProperty('--sheet', colorHex(key));
    els.colorDot.style.background = colorHex(key);
    markDirty();
  }

  // ---------------------------------------------------------------- markdown

  function applyPreview(on, focus = true) {
    const note = state.editing;
    if (!note) return;
    state.preview = on;
    els.previewToggle.setAttribute('aria-pressed', String(on));
    els.previewToggle.querySelector('span').textContent = on ? 'Editar' : 'Vista';
    els.previewToggle.querySelector('use').setAttribute('href', on ? '#i-pen' : '#i-eye');
    els.formatBar.classList.toggle('is-preview', on);
    els.noteBody.hidden = on;
    els.notePreview.hidden = !on;
    if (on) {
      renderPreview();
    } else if (focus && !note.trashed) {
      requestAnimationFrame(() => els.noteBody.focus());
    }
  }

  function renderPreview() {
    const note = state.editing;
    if (!note) return;
    const scroll = els.notePreview.scrollTop;
    const source = note.body || '';

    let html;
    if (window.marked && typeof window.marked.parse === 'function') {
      html = window.marked.parse(source, { gfm: true, breaks: true });
    } else {
      html = escapeHtml(source).replace(/\n/g, '<br>');
    }

    if (window.DOMPurify) {
      html = window.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_TAGS: ['input'],
        ADD_ATTR: ['checked', 'disabled', 'type', 'target', 'rel'],
      });
    }

    els.notePreview.innerHTML = html;

    els.notePreview.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.disabled = false;
      const item = input.closest('li');
      if (item) item.classList.add('task-list-item');
    });
    els.notePreview.querySelectorAll('a[href]').forEach((link) => {
      link.setAttribute('rel', 'noreferrer noopener');
    });

    els.notePreview.scrollTop = scroll;
  }

  function onPreviewClick(event) {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (checkbox) {
      event.preventDefault();
      const boxes = Array.from(els.notePreview.querySelectorAll('input[type="checkbox"]'));
      toggleTask(boxes.indexOf(checkbox));
      return;
    }
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') || '';
    if (!/^(https?:|mailto:)/i.test(href)) return;
    api.open_url(href).catch(() => toast('No se pudo abrir el enlace.', null, null, true));
  }

  function toggleTask(index) {
    const note = state.editing;
    if (!note || index < 0) return;
    let seen = -1;
    const next = note.body.replace(/^(\s*[-*+] \[)( |x|X)(\])/gm, (match, start, mark, end) => {
      seen += 1;
      if (seen !== index) return match;
      return start + (mark === ' ' ? 'x' : ' ') + end;
    });
    if (seen < index) return;
    note.body = next;
    els.noteBody.value = next;
    markDirty();
    const scroll = els.notePreview.scrollTop;
    renderPreview();
    els.notePreview.scrollTop = scroll;
  }

  function onBodyKeydown(event) {
    if (event.key === 'Tab') {
      event.preventDefault();
      const textarea = els.noteBody;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText('  ', start, end, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      continueList(event);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        event.preventDefault();
        applyMarkdown(key === 'b' ? 'bold' : 'italic');
      }
    }
  }

  function continueList(event) {
    const textarea = els.noteBody;
    if (textarea.selectionStart !== textarea.selectionEnd) return;
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = before.slice(lineStart);
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/);
    if (!match) return;
    if (line !== match[0]) return;

    event.preventDefault();
    if (!match[3]) {
      textarea.setRangeText('', lineStart, pos, 'end');
    } else {
      let marker = match[2];
      if (/^\d+\.$/.test(marker)) marker = `${parseInt(marker, 10) + 1}.`;
      const insert = '\n' + match[1] + marker + ' [ ] ';
      textarea.setRangeText(insert, pos, pos, 'end');
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyMarkdown(action) {
    const textarea = els.noteBody;
    if (!state.editing || state.editing.trashed) return;
    textarea.focus();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);

    const replace = (nextValue, selectStart, selectEnd) => {
      textarea.value = nextValue;
      textarea.setSelectionRange(selectStart, selectEnd);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const wrap = (left, right, placeholder) => {
      const text = selected || placeholder;
      const next = value.slice(0, start) + left + text + right + value.slice(end);
      replace(next, start + left.length, start + left.length + text.length);
    };

    const prefixLines = (prefix) => {
      const from = value.lastIndexOf('\n', start - 1) + 1;
      const toIndex = value.indexOf('\n', end);
      const to = toIndex === -1 ? value.length : toIndex;
      const block = value.slice(from, to);
      const lines = block.split('\n');
      if (lines.every((line) => line.startsWith(prefix))) {
        const next = lines.map((line) => line.slice(prefix.length)).join('\n');
        replace(value.slice(0, from) + next + value.slice(to), start - prefix.length, end - prefix.length);
      } else {
        const next = lines.map((line) => prefix + line).join('\n');
        replace(value.slice(0, from) + next + value.slice(to), start + prefix.length, end + prefix.length);
      }
    };

    switch (action) {
      case 'bold':
        wrap('**', '**', 'texto');
        break;
      case 'italic':
        wrap('*', '*', 'texto');
        break;
      case 'heading':
        prefixLines('## ');
        break;
      case 'list':
        prefixLines('- ');
        break;
      case 'task':
        prefixLines('- [ ] ');
        break;
      case 'quote':
        prefixLines('> ');
        break;
      case 'code': {
        if (selected.includes('\n')) {
          const next = value.slice(0, start) + '```\n' + selected + '\n```' + value.slice(end);
          replace(next, start + 4, start + 4 + selected.length);
        } else {
          wrap('`', '`', 'código');
        }
        break;
      }
      case 'link': {
        const label = selected || 'texto';
        const url = 'https://';
        const next = value.slice(0, start) + `[${label}](${url})` + value.slice(end);
        const urlStart = start + label.length + 3;
        replace(next, urlStart, urlStart + url.length);
        break;
      }
      default:
        break;
    }
    textarea.focus();
  }

  // ---------------------------------------------------------------- acciones

  async function togglePinCard(id) {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return;
    const wanted = !note.pinned;
    note.pinned = wanted;
    renderGrid();
    try {
      const updated = await api.set_flag(id, 'pinned', wanted);
      if (updated) {
        upsert(updated);
        renderAll();
      }
    } catch (error) {
      console.error(error);
      note.pinned = !wanted;
      renderGrid();
      toast('No se pudo cambiar el estado de la nota.', null, null, true);
    }
  }

  async function onArchiveClick() {
    const note = state.editing;
    if (!note || state.closing) return;

    if (note.trashed) {
      try {
        await api.set_flag(note.id, 'trashed', false);
        dismissEditor();
        await syncFromDisk();
        renderAll();
        toast('Nota restaurada.');
      } catch (error) {
        console.error(error);
        toast('No se pudo restaurar la nota.', null, null, true);
      }
      return;
    }

    const wanted = !note.archived;
    if (!note.id && !hasContent(note)) {
      dismissEditor();
      renderAll();
      return;
    }
    note.archived = wanted;
    const ok = await flushSave();
    if (!ok) {
      note.archived = !wanted;
      return;
    }
    if (!note.id) return;
    try {
      await api.set_flag(note.id, 'archived', wanted);
      const id = note.id;
      dismissEditor();
      await syncFromDisk();
      renderAll();
      toast(wanted ? 'Nota archivada.' : 'Nota desarchivada.', 'Deshacer', async () => {
        await api.set_flag(id, 'archived', !wanted);
        await syncFromDisk();
        renderAll();
      });
    } catch (error) {
      console.error(error);
      toast('No se pudo archivar la nota.', null, null, true);
    }
  }

  async function onDeleteClick() {
    const note = state.editing;
    if (!note) return;

    if (note.trashed) {
      const yes = await confirmAction({
        title: 'Eliminar para siempre',
        text: 'La nota se borrará del disco. Esta acción no se puede deshacer.',
        ok: 'Eliminar para siempre',
      });
      if (!yes) return;
      try {
        await api.delete_forever(note.id);
        state.notes = state.notes.filter((item) => item.id !== note.id);
        dismissEditor();
        renderAll();
        toast('Nota eliminada para siempre.');
      } catch (error) {
        console.error(error);
        toast('No se pudo eliminar la nota.', null, null, true);
      }
      return;
    }

    if (!note.id && !hasContent(note)) {
      dismissEditor();
      renderAll();
      return;
    }

    const ok = await flushSave();
    if (!ok || !note.id) return;
    const id = note.id;

    try {
      await api.set_flag(id, 'trashed', true);
      dismissEditor();
      await syncFromDisk();
      renderAll();
      toast('Nota movida a la papelera.', 'Deshacer', async () => {
        await api.set_flag(id, 'trashed', false);
        await syncFromDisk();
        renderAll();
      });
    } catch (error) {
      console.error(error);
      toast('No se pudo mover la nota a la papelera.', null, null, true);
    }
  }

  async function emptyTrash() {
    const trashed = state.notes.filter((note) => note.trashed);
    if (!trashed.length) return;
    const yes = await confirmAction({
      title: 'Vaciar la papelera',
      text:
        trashed.length === 1
          ? 'Se eliminará 1 nota para siempre. No se puede deshacer.'
          : `Se eliminarán ${trashed.length} notas para siempre. No se puede deshacer.`,
      ok: 'Vaciar papelera',
    });
    if (!yes) return;
    try {
      const count = await api.empty_trash();
      state.notes = state.notes.filter((note) => !note.trashed);
      renderAll();
      toast(count === 1 ? 'Se eliminó 1 nota.' : `Se eliminaron ${count} notas.`);
    } catch (error) {
      console.error(error);
      toast('No se pudo vaciar la papelera.', null, null, true);
    }
  }

  // ---------------------------------------------------------------- diálogos

  function confirmAction({ title, text, ok }) {
    return new Promise((resolve) => {
      state.confirmResolve = resolve;
      state.confirmFocus = document.activeElement;
      els.confirmTitle.textContent = title;
      els.confirmText.textContent = text;
      els.confirmOk.textContent = ok || 'Eliminar';
      els.confirmLayer.hidden = false;
      els.confirmCancel.focus();
    });
  }

  function resolveConfirm(value) {
    const resolve = state.confirmResolve;
    state.confirmResolve = null;
    els.confirmLayer.hidden = true;
    if (resolve) resolve(Boolean(value));
    const previous = state.confirmFocus;
    if (previous && document.contains(previous)) previous.focus();
    else if (state.editing) els.doneBtn.focus();
  }

  let toastTimer = null;
  function toast(message, actionLabel, action, isError = false) {
    clearTimeout(toastTimer);
    els.toast.className = 'toast' + (isError ? ' is-error' : '');
    els.toast.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    els.toast.appendChild(text);
    if (actionLabel && action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = actionLabel;
      button.addEventListener('click', () => {
        hideToast();
        action();
      });
      els.toast.appendChild(button);
    }
    els.toast.hidden = false;
    toastTimer = setTimeout(hideToast, actionLabel ? 6500 : 3600);
  }

  function hideToast() {
    els.toast.hidden = true;
  }

  // ---------------------------------------------------------------- arranque

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
