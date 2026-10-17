// Note: markdown with an edit/preview toggle, pasted or dropped images, a color, and optional backing by a real file.
// node.data: { text, mode: 'edit' | 'preview', color, file }
NodeKinds.note = {
  label: 'Note', w: 300, h: 220,
  mount({ node, body, entry, floor, addButton, linked, flash, save }) {
    const d = node.data;
    const ta = h('textarea', { class: 'note', placeholder: 'Write markdown. Paste or drop images. Link this note to a terminal or chat, then press play.' });
    const view = h('div', { class: 'note-view scroll', title: 'Double-click to edit' });
    const bar = h('div', { class: 'note-bar' });
    body.classList.add('note-body');
    body.append(bar, ta, view);

    const tint = () => { body.style.background = (d.color && STACK_COLORS[d.color]) || ''; };
    const text = () => ta.value;

    // ---- file backing ----
    let dirty = false, saveTimer, lastDisk = null;
    const writeFile = async () => {
      if (!d.file) return;
      const r = await call('files:write', d.file, ta.value);
      if (r.error) { bar.dataset.err = r.error; refreshBar(); } else { lastDisk = ta.value; delete bar.dataset.err; dirty = false; refreshBar(); }
    };
    const reloadFile = async () => {
      if (!d.file) return;
      const r = await call('files:read', d.file);
      if (r.error) { bar.dataset.err = r.error; refreshBar(); return; }
      delete bar.dataset.err;
      if (r.content === lastDisk || r.content === ta.value) { lastDisk = r.content; refreshBar(); return; }
      if (dirty) { bar.dataset.conflict = '1'; refreshBar(); return; } // unsaved local edits: do not clobber them
      lastDisk = r.content; ta.value = r.content; d.text = r.content; save(); render(); refreshBar();
    };
    const linkFile = async (file) => {
      d.file = file;
      await call('notes:watch', node.id, file);
      const r = await call('files:read', file);
      if (r.content != null && (r.content || !ta.value)) { ta.value = r.content; d.text = r.content; lastDisk = r.content; }
      else { await writeFile(); }
      save(); render(); refreshBar();
    };
    const unlinkFile = async () => { await call('notes:unwatch', node.id); d.file = null; lastDisk = null; delete bar.dataset.err; delete bar.dataset.conflict; save(); refreshBar(); };

    // ---- editing ----
    ta.value = d.text || '';
    ta.addEventListener('input', () => {
      d.text = ta.value; save();
      if (d.file) { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(writeFile, 500); }
    });

    const insertAtCursor = (s) => {
      const a = ta.selectionStart, b = ta.selectionEnd;
      ta.setRangeText(s, a, b, 'end');
      ta.dispatchEvent(new Event('input'));
    };
    const addImages = async (files) => {
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const ext = f.type.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const r = await call('notes:saveImage', btoa(bin), ext);
        if (r.error) { alertModal('Image not added', r.error); continue; }
        insertAtCursor(`![image](images/${r.name})\n`);
      }
    };
    ta.addEventListener('paste', (e) => {
      const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!imgs.length) return;
      e.preventDefault();
      addImages(imgs);
    });
    body.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
    body.addEventListener('drop', (e) => {
      const imgs = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!imgs.length) return;
      e.preventDefault(); e.stopPropagation();
      if (d.mode === 'preview') setMode('edit');
      addImages(imgs);
    });

    // ---- modes ----
    function render() { view.replaceChildren(renderMarkdown(ta.value)); }
    function setMode(mode) {
      d.mode = mode; save();
      ta.style.display = mode === 'edit' ? '' : 'none';
      view.style.display = mode === 'preview' ? '' : 'none';
      if (mode === 'preview') render(); else ta.focus();
      refreshBar();
    }
    view.addEventListener('dblclick', (e) => { if (!e.target.closest('a, button')) setMode('edit'); });

    function refreshBar() {
      const file = d.file ? d.file.split(/[\\/]/).pop() : '';
      bar.replaceChildren(
        h('button', { class: d.mode !== 'preview' ? 'on' : '', onclick: () => setMode('edit') }, 'Edit'),
        h('button', { class: d.mode === 'preview' ? 'on' : '', onclick: () => setMode('preview') }, 'Preview'),
        file ? h('span', { class: 'note-file' + (bar.dataset.err || bar.dataset.conflict ? ' bad' : ''), title: bar.dataset.err || d.file }, '📄 ' + file + (dirty ? ' •' : '')) : null,
        bar.dataset.conflict ? h('button', { title: 'The file changed on disk while you had unsaved edits', onclick: () => { delete bar.dataset.conflict; dirty = false; reloadFile(); } }, 'Reload from disk') : null);
      tint();
    }

    entry.api.focus = () => (d.mode === 'preview' ? view : ta).focus();
    entry.api.append = (s) => { ta.value += s; ta.dispatchEvent(new Event('input')); render(); };
    entry.api.setText = (s) => { ta.value = s; ta.dispatchEvent(new Event('input')); render(); };
    entry.api.getText = text;

    addButton('▶', 'Send text to linked terminals and chats', () => {
      for (const t of linked()) {
        flash(t.node.id);
        t.api.send?.(ta.value);
      }
    });
    addButton('✉', 'Open in the prompter (@ mentions, attachments)', () => prompterDialog({ floor, text: ta.value, targets: linked().map((t) => t.node.id) }));
    addButton('🎨', 'Note color', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      popupMenu(r.left, r.bottom, Object.keys(STACK_COLORS).map((c) => ({ label: (d.color || 'none') === c ? `✓ ${c}` : c, onClick: () => { d.color = c === 'none' ? null : c; save(); tint(); } })));
    });
    addButton('📄', 'Link to a markdown file on disk', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      popupMenu(r.left, r.bottom, d.file ? [
        { label: 'Reveal file', onClick: () => call('files:reveal', d.file) },
        { label: 'Unlink from file', onClick: unlinkFile },
      ] : [
        { label: 'Open an existing file…', onClick: async () => { const f = await call('notes:pickFile', false); if (f) linkFile(f); } },
        { label: 'Save as a new file…', onClick: async () => { const f = await call('notes:pickFile', true); if (f) { await call('files:write', f, ta.value); linkFile(f); } } },
      ]);
    });

    const off = api.on('notes:changed', (id) => { if (id === node.id) reloadFile(); });
    if (d.file) { call('notes:watch', node.id, d.file).then(reloadFile); }
    setMode(d.mode === 'preview' ? 'preview' : 'edit');
    if (d.mode !== 'preview') ta.blur();
    return () => { off(); clearTimeout(saveTimer); if (d.file) call('notes:unwatch', node.id); };
  },
};
