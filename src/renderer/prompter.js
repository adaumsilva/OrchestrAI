// Prompter: a composer for talking to agents. `@` completes terminals, floors and files; pasted images and files become
// attachments saved to a temp folder; long pastes collapse into a chip that expands again on delivery.
const PASTE_COLLAPSE_LINES = 6, PASTE_COLLAPSE_CHARS = 600;

function prompterTargets(f) {
  const R = rt.get(f.id);
  return f.nodes.filter((n) => (n.kind === 'terminal' || n.kind === 'chat') && R?.live.get(n.id)?.api.send);
}

// Text sent to a terminal is bracketed-pasted when it spans lines, so an agent CLI receives one prompt, not several commands.
function deliverTo(f, node, text) {
  const entry = rt.get(f.id)?.live.get(node.id);
  if (!entry?.api.send) return false;
  entry.api.send(node.kind === 'terminal' && text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
  return true;
}

function prompterDialog({ floor: f = activeFloor(), text = '', targets } = {}) {
  const sel = selectedNode(f);
  const defaults = new Set(targets || (sel && ['terminal', 'chat'].includes(sel.kind) ? [sel.id] : linkedNodes(f, sel?.id || '').map((e) => e.node.id)));
  if (!defaults.size) { const only = prompterTargets(f); if (only.length === 1) defaults.add(only[0].id); }
  const attachments = []; // absolute paths
  const pastes = new Map(); // token -> full text
  let pasteCount = 0;

  const ta = h('textarea', { class: 'prompter-text', placeholder: 'Write a prompt. @ mentions terminals, floors and files. Paste images or long text.', rows: 8, value: text });
  const list = h('div', { class: 'prompter-complete hidden' });
  const chips = h('div', { class: 'prompter-chips' });
  const nodes = prompterTargets(f);
  const pick = h('div', { class: 'prompter-targets' }, nodes.length
    ? nodes.map((n) => h('label', {}, h('input', { type: 'checkbox', checked: defaults.has(n.id), 'data-id': n.id }), `${n.kind === 'chat' ? '💬' : '❯_'} ${n.title}`))
    : h('span', { class: 'muted' }, 'No terminal or chat on this floor to deliver to.'));

  const renderChips = () => chips.replaceChildren(...attachments.map((p, i) => h('span', { class: 'chip', title: p },
    p.split(/[\\/]/).pop(), h('button', { title: 'Remove', onclick: () => { attachments.splice(i, 1); renderChips(); } }, '×'))));

  // ---------- @ completion ----------
  let items = [], active = 0, token = null, searchSeq = 0;
  const hide = () => { list.classList.add('hidden'); items = []; token = null; };
  const insert = (it) => {
    const start = token.start, end = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + it.insert + ' ' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + it.insert.length + 1;
    hide(); ta.focus();
  };
  const showList = () => {
    list.replaceChildren(...items.map((it, i) => h('div', { class: 'item' + (i === active ? ' on' : ''), onmousedown: (e) => { e.preventDefault(); insert(it); } },
      h('span', { class: 'ico' }, it.icon), h('span', { class: 'lbl' }, it.label), it.hint ? h('span', { class: 'muted' }, it.hint) : null)));
    list.classList.toggle('hidden', !items.length);
  };
  const root = () => f.dir || (prompterTargets(f)[0]?.data?.cwd) || '';
  async function complete() {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = /(^|\s)@([^\s@]*)$/.exec(before);
    if (!m) return hide();
    token = { start: before.length - m[2].length - 1 };
    const q = m[2].toLowerCase();
    const local = [
      ...f.nodes.filter((n) => n.kind === 'terminal').map((n) => ({ icon: '❯_', label: n.title, hint: 'terminal', insert: '@' + n.title.replace(/\s+/g, '-') })),
      ...state.floors.map((fl) => ({ icon: '▦', label: fl.name, hint: 'floor', insert: '@floor:' + fl.name.replace(/\s+/g, '-') })),
    ].filter((it) => it.label.toLowerCase().includes(q) || it.insert.toLowerCase().includes(q));
    items = local.slice(0, 6); active = 0; showList();
    if (q.length >= 1 && root()) {
      const seq = ++searchSeq;
      const found = await call('files:search', root(), q);
      if (seq !== searchSeq || !token) return;
      const rel = (p) => p.slice(root().length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
      items = [...local.slice(0, 4), ...found.filter((r) => !r.isDir).slice(0, 8).map((r) => ({ icon: '📄', label: rel(r.path), insert: '@' + rel(r.path) }))];
      active = Math.min(active, Math.max(0, items.length - 1)); showList();
    }
  }
  ta.addEventListener('input', complete);
  ta.addEventListener('click', complete);
  ta.addEventListener('keydown', (e) => {
    if (!items.length || list.classList.contains('hidden')) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; showList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; showList(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
  });

  // ---------- paste: images/files become attachments, long text collapses ----------
  ta.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    const files = [...(cd?.files || [])];
    if (files.length) {
      e.preventDefault();
      for (const file of files) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        attachments.push(await call('files:saveAttachment', file.name || 'pasted-image.png', btoa(bin)));
      }
      renderChips();
      return;
    }
    const pasted = cd?.getData('text/plain') || '';
    const lines = pasted.split('\n').length;
    if (lines > PASTE_COLLAPSE_LINES || pasted.length > PASTE_COLLAPSE_CHARS) {
      e.preventDefault();
      const tokenText = `[Pasted text #${++pasteCount} (${lines} lines)]`;
      pastes.set(tokenText, pasted);
      ta.setRangeText(tokenText, ta.selectionStart, ta.selectionEnd, 'end');
    }
  });

  const compose = () => {
    let out = ta.value;
    for (const [t, full] of pastes) out = out.split(t).join(full);
    if (attachments.length) out += `\n\nAttachments:\n${attachments.map((p) => `- ${p}`).join('\n')}`;
    return out.trim();
  };
  const chosen = () => [...pick.querySelectorAll('input:checked')].map((i) => f.nodes.find((n) => n.id === i.dataset.id)).filter(Boolean);
  function send() {
    const prompt = compose(), to = chosen();
    if (!prompt) return;
    if (!to.length) return alertModal('No target', 'Tick at least one terminal or chat to deliver to.');
    const failed = to.filter((n) => !deliverTo(f, n, prompt));
    closeModal();
    if (failed.length) alertModal('Not delivered', failed.map((n) => n.title).join(', '));
  }

  modal({
    title: 'Prompter',
    content: h('div', { class: 'prompter' },
      h('div', { class: 'prompter-box' }, ta, list),
      chips,
      h('div', { class: 'row' }, h('button', { onclick: async () => { attachments.push(...(await call('files:pickFiles'))); renderChips(); } }, 'Attach files…'),
        h('span', { class: 'muted' }, 'Ctrl+Enter sends')),
      h('div', { class: 'muted' }, 'Deliver to:'), pick),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Send', primary: true, onClick: () => send() }],
  });
  ta.focus();
  return { ta, send, compose };
}

addEventListener('keydown', (e) => {
  if (!shortcutMatch(e, 'prompter') || isTyping(e.target) || modalOpen()) return;
  const f = activeFloor();
  if (f) { e.preventDefault(); prompterDialog({ floor: f }); }
});
