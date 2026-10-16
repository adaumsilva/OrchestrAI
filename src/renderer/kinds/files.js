// File tree with git status badges and a small text editor.
NodeKinds.files = {
  label: 'Files', w: 620, h: 420,
  mount({ node, body, cwd, floor, save }) {
    const root = () => node.data.root || cwd() || '';
    const expanded = new Set(node.data.expanded || []);
    const badges = new Map(); // relative path (forward slashes) -> status letter
    let selected = null, dirty = false, current = null;

    const tree = h('div', { class: 'tree' });
    const status = h('span', { class: 'muted' });
    const rootInput = h('input', { value: root(), placeholder: 'Root directory' });
    const search = h('input', { placeholder: 'Search filenames', style: 'width:120px;flex:none' });
    const editorPath = h('div', { class: 'muted', style: 'padding:2px 0' }, 'No file open');
    const area = h('textarea', { spellcheck: 'false', disabled: true });
    const saveBtn = h('button', { disabled: true, onclick: saveFile }, 'Save');
    const editor = h('div', { class: 'editor' }, h('div', { class: 'row' }, editorPath, saveBtn), area);

    body.append(
      h('div', { class: 'row' },
        rootInput,
        h('button', { title: 'Choose folder', onclick: async () => { const d = await call('files:pickDirectory'); if (d) setRoot(d); } }, '…'),
        h('button', { title: 'New file', onclick: () => createDialog(false) }, '+F'),
        h('button', { title: 'New folder', onclick: () => createDialog(true) }, '+D'),
        h('button', { title: 'Refresh', onclick: refresh }, '⟳'),
        search),
      h('div', { class: 'split' }, tree, editor),
      status);

    const rel = (p) => p.slice(root().length).replace(/^[\\/]+/, '').replace(/\\/g, '/');

    function setRoot(d) { node.data.root = d; rootInput.value = d; expanded.clear(); save(); refresh(); }
    rootInput.addEventListener('change', () => setRoot(rootInput.value.trim()));

    async function loadBadges() {
      badges.clear();
      const r = root();
      if (!r) return;
      const st = await call('git:state', r);
      for (const c of st.changes || []) badges.set(c.file, c.untracked ? 'U' : (c.worktree !== ' ' ? c.worktree : c.index));
    }

    async function renderDir(dir, depth, into) {
      const list = await call('files:list', dir);
      if (list.error) { into.append(h('div', { class: 'err' }, list.error)); return; }
      for (const e of list) {
        const full = joinPath(dir, e.name);
        const badge = badges.get(rel(full)) || (e.isDir && [...badges.keys()].some((k) => k.startsWith(rel(full) + '/')) ? '•' : '');
        const item = h('div', { class: 'tree-item' + (selected === full ? ' sel' : ''), style: `padding-left:${depth * 14 + 4}px` },
          h('span', {}, e.isDir ? (expanded.has(full) ? '▾' : '▸') : ' '),
          h('span', {}, e.name),
          badge ? h('span', { class: 'git-badge' }, badge) : null);
        item.addEventListener('click', () => (e.isDir ? toggle(full) : openFile(full)));
        item.addEventListener('contextmenu', (ev) => { ev.preventDefault(); itemMenu(full, e.isDir); });
        into.append(item);
        if (e.isDir && expanded.has(full)) await renderDir(full, depth + 1, into);
      }
    }

    async function refresh() {
      if (!root()) { tree.replaceChildren(h('div', { class: 'muted' }, 'Set a root directory or give this floor one.')); return; }
      await loadBadges();
      const next = h('div', {});
      await renderDir(root(), 0, next);
      tree.replaceChildren(...next.childNodes);
      call('files:watch', node.id, root());
    }

    function toggle(dir) {
      expanded.has(dir) ? expanded.delete(dir) : expanded.add(dir);
      node.data.expanded = [...expanded];
      save();
      refresh();
    }

    async function openFile(file) {
      if (dirty && !(await confirmModal('Unsaved changes', `Discard changes to ${current}?`, 'Discard'))) return;
      selected = file;
      const r = await call('files:read', file);
      current = file; dirty = false;
      editorPath.textContent = file;
      saveBtn.disabled = true;
      if (r.content != null) { area.disabled = false; area.value = r.content; }
      else { area.disabled = true; area.value = r.tooLarge ? 'File is larger than 1 MB.' : r.binary ? 'Binary file.' : r.error || ''; }
      refresh();
    }

    async function saveFile() {
      const r = await call('files:write', current, area.value);
      if (r.error) return alertModal('Save failed', r.error);
      dirty = false; saveBtn.disabled = true;
      refresh();
    }
    area.addEventListener('input', () => { dirty = true; saveBtn.disabled = false; });
    area.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (dirty) saveFile(); } });

    function createDialog(isDir) {
      const input = h('input', { placeholder: isDir ? 'folder name' : 'file name' });
      const base = selected && !selected.includes('.') ? selected : root();
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
      const name = full.split(/[\\/]/).pop();
      modal({
        title: name,
        content: h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
          h('button', { onclick: () => { closeModal(); call('files:reveal', full); } }, 'Reveal in Explorer'),
          h('button', { onclick: () => { closeModal(); navigator.clipboard.writeText(full); } }, 'Copy path'),
          h('button', {
            onclick: () => {
              const input = h('input', { value: name });
              modal({
                title: 'Rename', content: input,
                actions: [{ label: 'Cancel', onClick: (c) => c() }, {
                  label: 'Rename', primary: true, onClick: async (c) => {
                    const to = joinPath(full.slice(0, full.length - name.length), input.value.trim());
                    const r = await call('files:rename', full, to);
                    if (r.error) return alertModal('Rename failed', r.error);
                    c(); refresh();
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
              if (current === full) { current = null; area.value = ''; area.disabled = true; editorPath.textContent = 'No file open'; }
              refresh();
            },
          }, isDir ? 'Move folder to trash' : 'Move to trash')),
        actions: [{ label: 'Close', onClick: (c) => c() }],
      });
    }

    let searchTimer;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        if (!search.value.trim()) return refresh();
        const res = await call('files:search', root(), search.value.trim());
        tree.replaceChildren(...res.map((r) => h('div', { class: 'tree-item', onclick: () => !r.isDir && openFile(r.path) }, rel(r.path))));
        status.textContent = `${res.length} match${res.length === 1 ? '' : 'es'}`;
      }, 250);
    });

    const off = api.on('files:changed', (id) => { if (id === node.id && !search.value) refresh(); });
    refresh();
    return () => { off(); call('files:unwatch', node.id); };
  },
};
