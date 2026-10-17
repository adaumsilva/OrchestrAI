// File tree with git badges, editor tabs with syntax highlighting, media preview, grid view, content search and a file clipboard.
const fileClipboard = { mode: null, paths: [] }; // shared by every file tree

NodeKinds.files = {
  label: 'Files', w: 700, h: 460,
  mount({ node, body, cwd, floor, save, addButton }) {
    const root = () => node.data.root || cwd() || '';
    const expanded = new Set(node.data.expanded || []);
    const badges = new Map(); // relative path (forward slashes) -> status letter
    let selected = null, view = node.data.view || 'list', gridDir = null, watchFailed = false;
    const tabs = []; // { path, kind: 'text' | 'media' | 'note', content, saved, media, note }
    let active = -1;

    const tree = h('div', { class: 'tree', tabindex: '0' });
    const status = h('span', { class: 'muted' });
    const rootInput = h('input', { value: root(), placeholder: 'Root directory' });
    const search = h('input', { placeholder: 'Search', style: 'width:110px;flex:none' });
    const modeSel = h('select', { title: 'What to search', style: 'flex:none' }, h('option', { value: 'names' }, 'Names'), h('option', { value: 'content' }, 'Content'));
    const viewBtn = h('button', { title: 'Switch between list and icon grid', onclick: () => { view = view === 'list' ? 'grid' : 'list'; node.data.view = view; gridDir = null; save(); refresh(); } });
    const tabBar = h('div', { class: 'tabbar' });
    const editorPath = h('div', { class: 'muted ellipsis', style: 'flex:1;min-width:0' }, 'No file open');
    const area = h('textarea', { spellcheck: 'false', disabled: true, wrap: 'off' });
    const hl = h('code', {});
    const hlWrap = h('pre', { class: 'hl-layer', 'aria-hidden': 'true' }, hl);
    const codeBox = h('div', { class: 'code-box' }, hlWrap, area);
    const mediaBox = h('div', { class: 'media-box', style: 'display:none' });
    const mdView = h('div', { class: 'md md-pane', style: 'display:none' });
    const saveBtn = h('button', { disabled: true, onclick: () => saveTab(tabs[active]) }, 'Save');
    const saveAllBtn = h('button', { title: 'Save every modified tab', onclick: saveAll }, 'Save all');
    const mdBtn = h('button', { title: 'Toggle markdown preview', style: 'display:none', onclick: () => { mdOn = !mdOn; showActive(); } }, 'Preview');
    let mdOn = false;
    const editor = h('div', { class: 'editor' }, tabBar, h('div', { class: 'row' }, editorPath, mdBtn, saveBtn, saveAllBtn), codeBox, mediaBox, mdView);

    body.append(
      h('div', { class: 'row' },
        rootInput,
        h('button', { title: 'Choose folder', onclick: async () => { const d = await call('files:pickDirectory'); if (d) setRoot(d); } }, '…'),
        h('button', { title: 'New file', onclick: () => createDialog(false) }, '+F'),
        h('button', { title: 'New folder', onclick: () => createDialog(true) }, '+D'),
        h('button', { title: 'Refresh', onclick: refresh }, '⟳'),
        viewBtn, modeSel, search),
      h('div', { class: 'split' }, tree, editor),
      status);

    const rel = (p) => p.slice(root().length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
    const baseName = (p) => p.split(/[\\/]/).pop();
    const parentOf = (p) => p.slice(0, p.length - baseName(p).length).replace(/[\\/]+$/, '') || p;

    function setRoot(d) { node.data.root = d; rootInput.value = d; expanded.clear(); gridDir = null; save(); refresh(); }
    rootInput.addEventListener('change', () => setRoot(rootInput.value.trim()));

    async function loadBadges() {
      badges.clear();
      const r = root();
      if (!r) return;
      const st = await call('git:state', r);
      for (const c of st.changes || []) badges.set(c.file, c.untracked ? 'U' : (c.worktree !== ' ' ? c.worktree : c.index));
    }

    const badgeFor = (full, isDir) => badges.get(rel(full)) || (isDir && [...badges.keys()].some((k) => k.startsWith(rel(full) + '/')) ? '•' : '');
    const iconFor = (name, isDir) => {
      if (isDir) return '📁';
      const k = MEDIA_KINDS[name.split('.').pop().toLowerCase()];
      return k === 'image' ? '🖼' : k === 'video' ? '🎞' : k === 'audio' ? '🎵' : k === 'pdf' ? '📕' : /\.(md|txt)$/i.test(name) ? '📝' : /\.(js|ts|jsx|tsx|py|rs|go|java|c|cpp|cs|rb|sh|ps1)$/i.test(name) ? '⌘' : '📄';
    };

    async function renderDir(dir, depth, into) {
      const list = await call('files:list', dir);
      if (list.error) { into.append(h('div', { class: 'err' }, list.error)); return; }
      for (const e of list) {
        const full = joinPath(dir, e.name);
        const badge = badgeFor(full, e.isDir);
        const item = h('div', { class: 'tree-item' + (selected === full ? ' sel' : ''), style: `padding-left:${depth * 14 + 4}px` },
          h('span', {}, e.isDir ? (expanded.has(full) ? '▾' : '▸') : ' '),
          h('span', {}, e.name),
          badge ? h('span', { class: 'git-badge' }, badge) : null);
        item.addEventListener('click', () => { selected = full; e.isDir ? toggle(full) : openFile(full); });
        item.addEventListener('contextmenu', (ev) => { ev.preventDefault(); selected = full; itemMenu(full, e.isDir); });
        into.append(item);
        if (e.isDir && expanded.has(full)) await renderDir(full, depth + 1, into);
      }
    }

    async function renderGrid(dir, into) {
      const list = await call('files:list', dir);
      if (list.error) { into.append(h('div', { class: 'err' }, list.error)); return; }
      const crumbs = h('div', { class: 'row grid-crumbs' },
        h('button', { disabled: dir === root(), onclick: () => { gridDir = parentOf(dir); refresh(); } }, '↑'),
        h('span', { class: 'muted ellipsis' }, rel(dir) || '/'));
      const grid = h('div', { class: 'icon-grid' }, list.map((e) => {
        const full = joinPath(dir, e.name), badge = badgeFor(full, e.isDir);
        const cell = h('div', { class: 'icon-cell' + (selected === full ? ' sel' : ''), title: e.name },
          h('div', { class: 'icon-glyph' }, iconFor(e.name, e.isDir)), h('div', { class: 'icon-name' }, e.name), badge ? h('span', { class: 'git-badge' }, badge) : null);
        cell.addEventListener('click', () => { selected = full; if (e.isDir) { gridDir = full; refresh(); } else openFile(full); });
        cell.addEventListener('contextmenu', (ev) => { ev.preventDefault(); selected = full; itemMenu(full, e.isDir); });
        return cell;
      }));
      into.append(crumbs, grid);
    }

    async function refresh() {
      viewBtn.textContent = view === 'list' ? '▦' : '☰';
      if (!root()) { tree.replaceChildren(h('div', { class: 'muted' }, 'Set a root directory or give this floor one.')); return; }
      call('files:allowRoot', root());
      await loadBadges();
      const next = h('div', {});
      if (view === 'grid') await renderGrid(gridDir || root(), next); else await renderDir(root(), 0, next);
      tree.replaceChildren(...next.childNodes);
      const watching = await call('files:watch', node.id, root());
      if (!watching !== watchFailed) { watchFailed = !watching; renderStatus(); }
    }

    function renderStatus(text) {
      const parts = [];
      if (watchFailed) parts.push(h('span', { class: 'err' }, 'Not watching for changes. '), h('button', { onclick: refresh }, 'Retry'));
      if (text) parts.push(h('span', { class: 'muted' }, text));
      status.replaceChildren(...parts);
    }

    function toggle(dir) {
      expanded.has(dir) ? expanded.delete(dir) : expanded.add(dir);
      node.data.expanded = [...expanded];
      save();
      refresh();
    }

    // ---------- tabs ----------
    const dirty = (t) => t.kind === 'text' && t.content !== t.saved;
    const langOf = (p) => (baseName(p).split('.').pop() || '').toLowerCase();

    function renderTabBar() {
      tabBar.replaceChildren(...tabs.map((t, i) => h('div', { class: 'tab' + (i === active ? ' active' : ''), title: t.path, onclick: () => { active = i; showActive(); } },
        h('span', { class: 'ellipsis' }, baseName(t.path)), dirty(t) ? h('span', { class: 'dirty-dot', title: 'Unsaved changes' }, '●') : null,
        h('span', { class: 'tab-x', title: 'Close', onclick: (e) => { e.stopPropagation(); closeTab(i); } }, '×'))));
      saveAllBtn.disabled = !tabs.some(dirty);
    }

    function paintHighlight() {
      const t = tabs[active];
      if (!t || t.kind !== 'text') return;
      hl.replaceChildren(mdHighlight(t.content, langOf(t.path)));
      hl.append('\n'); // keeps the last empty line aligned with the textarea
    }

    function showActive() {
      renderTabBar();
      const t = tabs[active];
      saveBtn.disabled = !t || !dirty(t);
      mediaBox.style.display = 'none'; mdView.style.display = 'none'; codeBox.style.display = '';
      mdBtn.style.display = 'none';
      if (!t) { editorPath.textContent = 'No file open'; area.value = ''; area.disabled = true; hl.replaceChildren(); return; }
      editorPath.textContent = t.path;
      node.data.tabs = tabs.map((x) => x.path); node.data.activeTab = t.path; save();
      if (t.kind === 'text') {
        area.disabled = false;
        if (area.value !== t.content) area.value = t.content;
        paintHighlight();
        if (/^(md|markdown)$/.test(langOf(t.path))) {
          mdBtn.style.display = '';
          if (mdOn) { codeBox.style.display = 'none'; mdView.style.display = ''; mdView.replaceChildren(renderMarkdown(t.content)); }
        }
      } else {
        codeBox.style.display = 'none';
        mediaBox.style.display = '';
        mediaBox.replaceChildren(mediaElement(t));
      }
    }

    function mediaElement(t) {
      if (t.kind === 'note') return h('div', { class: 'muted', style: 'padding:12px' }, t.note);
      const m = t.media;
      if (m.kind === 'image') return h('img', { src: m.url, class: 'media-img', alt: baseName(t.path) });
      if (m.kind === 'video') return h('video', { src: m.url, controls: true, class: 'media-video' });
      if (m.kind === 'audio') return h('audio', { src: m.url, controls: true });
      return h('iframe', { src: m.url, class: 'media-pdf', title: baseName(t.path) });
    }

    async function openFile(file, line) {
      let i = tabs.findIndex((t) => t.path === file);
      if (i < 0) {
        const media = await call('files:media', file);
        let tab;
        if (media && media.url) tab = { path: file, kind: 'media', media };
        else if (media && media.error) tab = { path: file, kind: 'note', note: media.error };
        else {
          const r = await call('files:read', file);
          if (r.content != null) tab = { path: file, kind: 'text', content: r.content, saved: r.content };
          else tab = { path: file, kind: 'note', note: r.tooLarge ? 'File is larger than 1 MB.' : r.binary ? 'Binary file.' : r.error || 'Cannot open this file.' };
        }
        tabs.push(tab); i = tabs.length - 1;
      }
      active = i;
      showActive();
      if (line && tabs[i].kind === 'text') {
        const lines = tabs[i].content.split('\n');
        const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
        area.focus(); area.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
        area.scrollTop = Math.max(0, (line - 4) * 16);
        syncScroll();
      }
      refresh();
    }

    async function closeTab(i) {
      const t = tabs[i];
      if (dirty(t) && !(await confirmModal('Unsaved changes', `Discard changes to ${baseName(t.path)}?`, 'Discard'))) return;
      tabs.splice(i, 1);
      active = Math.min(active, tabs.length - 1);
      if (i < active) active = Math.max(0, active - 1);
      showActive();
    }

    async function saveTab(t) {
      if (!t || !dirty(t)) return true;
      const r = await call('files:write', t.path, t.content);
      if (r.error) { alertModal('Save failed', r.error); return false; }
      t.saved = t.content;
      showActive(); refresh();
      return true;
    }
    async function saveAll() { for (const t of tabs) if (!(await saveTab(t))) return; }

    area.addEventListener('input', () => { const t = tabs[active]; if (!t) return; t.content = area.value; paintHighlight(); renderTabBar(); saveBtn.disabled = !dirty(t); });
    const syncScroll = () => { hlWrap.scrollTop = area.scrollTop; hlWrap.scrollLeft = area.scrollLeft; };
    area.addEventListener('scroll', syncScroll);
    area.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); e.shiftKey ? saveAll() : saveTab(tabs[active]); }
      if (e.key === 'Tab' && !e.ctrlKey) { // indent instead of leaving the editor
        e.preventDefault();
        const s = area.selectionStart;
        area.setRangeText('  ', s, area.selectionEnd, 'end');
        area.dispatchEvent(new Event('input'));
      }
    });

    addButton('⌨', 'Open this folder in your IDE', () => openInIde(root(), { floor }));

    // ---------- file clipboard ----------
    const targetDir = () => (selected ? (selected === root() || !/\.[^\\/]+$/.test(baseName(selected)) ? selected : parentOf(selected)) : root());
    const setClip = (mode, paths) => { fileClipboard.mode = mode; fileClipboard.paths = paths; renderStatus(`${mode === 'cut' ? 'Cut' : 'Copied'} ${paths.length} item${paths.length === 1 ? '' : 's'}`); };

    async function pasteInto(dir) {
      let paths = fileClipboard.paths, mode = fileClipboard.mode || 'copy';
      if (!paths.length) { // fall back to absolute paths on the OS clipboard, one per line
        try { paths = (await navigator.clipboard.readText()).split(/\r?\n/).map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => /^([a-zA-Z]:[\\/]|\/)/.test(s)); } catch { paths = []; }
        mode = 'copy';
      }
      if (!paths.length) return renderStatus('Nothing to paste');
      const r = await call('files:transfer', paths, dir, mode);
      if (r.error) alertModal('Paste failed', r.error);
      if (mode === 'move' && r.ok) { fileClipboard.paths = []; fileClipboard.mode = null; }
      refresh();
    }

    tree.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !selected) return;
      if (e.key === 'c') { e.preventDefault(); setClip('copy', [selected]); }
      else if (e.key === 'x') { e.preventDefault(); setClip('cut', [selected]); }
      else if (e.key === 'v') { e.preventDefault(); pasteInto(targetDir()); }
    });

    function createDialog(isDir) {
      const input = h('input', { placeholder: isDir ? 'folder name' : 'file name' });
      const base = targetDir();
      modal({
        title: isDir ? 'New folder' : 'New file', content: h('div', {}, h('div', { class: 'muted mono' }, base), input),
        actions: [{ label: 'Cancel', onClick: (c) => c() }, {
          label: 'Create', primary: true, onClick: async (c) => {
            if (!input.value.trim()) return;
            const r = await call('files:create', joinPath(base, input.value.trim()), isDir);
            if (r.error) return alertModal('Create failed', r.error);
            c(); refresh();
          },
        }],
      });
    }

    function itemMenu(full, isDir) {
      const name = baseName(full);
      modal({
        title: name,
        content: h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
          h('button', { onclick: () => { closeModal(); setClip('copy', [full]); } }, 'Copy'),
          h('button', { onclick: () => { closeModal(); setClip('cut', [full]); } }, 'Cut'),
          h('button', { disabled: !fileClipboard.paths.length, onclick: () => { closeModal(); pasteInto(isDir ? full : parentOf(full)); } }, isDir ? 'Paste into folder' : 'Paste next to it'),
          h('button', { onclick: () => { closeModal(); call('files:reveal', full); } }, 'Reveal in Explorer'),
          h('button', { onclick: () => { closeModal(); openInIde(full, { floor }); } }, 'Open in IDE'),
          h('button', { onclick: () => { closeModal(); navigator.clipboard.writeText(full); } }, 'Copy path'),
          h('button', {
            onclick: () => {
              const input = h('input', { value: name });
              modal({
                title: 'Rename', content: input,
                actions: [{ label: 'Cancel', onClick: (c) => c() }, {
                  label: 'Rename', primary: true, onClick: async (c) => {
                    const to = joinPath(parentOf(full), input.value.trim());
                    const r = await call('files:rename', full, to);
                    if (r.error) return alertModal('Rename failed', r.error);
                    tabs.forEach((t) => { if (t.path === full) t.path = to; });
                    c(); showActive(); refresh();
                  },
                }],
              });
            },
          }, 'Rename'),
          h('button', {
            onclick: async () => {
              closeModal();
              if (!(await confirmModal('Move to trash', `Move ${name} to the trash?`, 'Trash'))) return;
              const r = await call('files:trash', full);
              if (r.error) return alertModal('Failed', r.error);
              for (let i = tabs.length - 1; i >= 0; i--) if (tabs[i].path === full || tabs[i].path.startsWith(full + '\\') || tabs[i].path.startsWith(full + '/')) tabs.splice(i, 1);
              active = Math.min(active, tabs.length - 1);
              showActive(); refresh();
            },
          }, isDir ? 'Move folder to trash' : 'Move to trash')),
        actions: [{ label: 'Close', onClick: (c) => c() }],
      });
    }

    // ---------- search ----------
    let searchTimer;
    const runSearch = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = search.value.trim();
        if (!q) { renderStatus(); return refresh(); }
        if (modeSel.value === 'content') {
          const { results, engine } = await call('files:grep', root(), q, {});
          tree.replaceChildren(...results.map((r) => h('div', { class: 'tree-item grep-hit', onclick: () => openFile(r.path, r.line), title: `${rel(r.path)}:${r.line}` },
            h('span', { class: 'ellipsis' }, `${rel(r.path)}:${r.line}`), h('span', { class: 'muted ellipsis grep-text' }, r.text.trim()))));
          if (!results.length) tree.replaceChildren(h('div', { class: 'muted' }, 'No matches.'));
          renderStatus(`${results.length} match${results.length === 1 ? '' : 'es'} (${engine})`);
        } else {
          const res = await call('files:search', root(), q);
          tree.replaceChildren(...res.map((r) => h('div', { class: 'tree-item', onclick: () => !r.isDir && openFile(r.path) }, rel(r.path))));
          renderStatus(`${res.length} match${res.length === 1 ? '' : 'es'}`);
        }
      }, 250);
    };
    search.addEventListener('input', runSearch);
    modeSel.addEventListener('change', runSearch);

    const off = api.on('files:changed', async (id) => {
      if (id !== node.id) return;
      for (const t of tabs) { // pick up outside edits of files that are not being edited here
        if (t.kind === 'text' && !dirty(t)) {
          const r = await call('files:read', t.path);
          if (r.content != null && r.content !== t.saved) { t.content = t.saved = r.content; if (tabs[active] === t) { area.value = r.content; paintHighlight(); } }
        }
      }
      if (!search.value) refresh();
    });
    refresh().then(async () => { for (const p of node.data.tabs || []) await openFile(p); });
    return () => { off(); call('files:unwatch', node.id); };
  },
};

const MEDIA_KINDS = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', ico: 'image', avif: 'image',
  pdf: 'pdf', mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video', mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
};
