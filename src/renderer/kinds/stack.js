// Note stack: several notes piled in one node, one in front, switched with a tab strip.
// Notes live inside node.data.notes (not as canvas nodes) so a stack saves, undoes and links like any other node.
const STACK_COLORS = { none: null, yellow: '#4a4426', blue: '#243a52', green: '#27442f', pink: '#4f2a3d', purple: '#3b2f55' };

NodeKinds.stack = {
  label: 'Note stack', w: 340, h: 260,
  mount({ node, body, floor, entry, addButton, linked, flash, save }) {
    const d = node.data;
    d.notes ||= [{ id: uid(), title: 'Note 1', text: '' }];
    if (!d.notes.some((n) => n.id === d.front)) d.front = d.notes[0].id;
    const front = () => d.notes.find((n) => n.id === d.front);

    const tabs = h('div', { class: 'stack-tabs' });
    const ta = h('textarea', { class: 'note', placeholder: 'Write a note' });
    ta.addEventListener('input', () => { front().text = ta.value; save(); });
    body.append(tabs, ta);
    body.classList.add('stack-body');

    const tint = () => { body.style.background = (d.color && STACK_COLORS[d.color]) || ''; };

    function render() {
      tint();
      tabs.replaceChildren(
        ...d.notes.map((n) => {
          const t = h('div', { class: 'stack-tab' + (n.id === d.front ? ' front' : ''), draggable: 'true', title: n.title }, n.title);
          t.addEventListener('click', () => { d.front = n.id; save(); render(); });
          t.addEventListener('dblclick', () => {
            t.contentEditable = 'true'; t.focus(); getSelection().selectAllChildren(t);
            const done = () => { t.contentEditable = 'false'; n.title = t.textContent.trim() || 'Note'; save(); render(); };
            t.addEventListener('blur', done, { once: true });
            t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); t.blur(); } });
          });
          t.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            const others = floor.nodes.filter((o) => o.kind === 'stack' && o.id !== node.id);
            popupMenu(e.clientX, e.clientY, [
              { label: 'Rename', onClick: () => t.dispatchEvent(new MouseEvent('dblclick')) },
              { label: 'Spill onto canvas', onClick: () => spill([n.id]) },
              { separator: true },
              ...others.map((o) => ({ label: `Move to “${o.title}”`, onClick: () => moveTo(n.id, o) })),
              { label: 'Move to a new stack', onClick: () => moveTo(n.id, null) },
              { separator: true },
              { label: 'Delete note', onClick: () => remove(n.id) },
            ]);
          });
          // Reorder by dragging a tab onto another.
          t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-stack-note', n.id); e.dataTransfer.effectAllowed = 'move'; });
          t.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-stack-note')) e.preventDefault(); });
          t.addEventListener('drop', (e) => {
            const id = e.dataTransfer.getData('text/x-stack-note');
            const from = d.notes.findIndex((x) => x.id === id), to = d.notes.findIndex((x) => x.id === n.id);
            if (from < 0 || from === to) return;
            e.preventDefault();
            d.notes.splice(to, 0, d.notes.splice(from, 1)[0]);
            save(); render();
          });
          return t;
        }),
        h('button', { class: 'stack-add', title: 'Add a note to this stack', onclick: () => api.addNote({ id: uid(), title: `Note ${d.notes.length + 1}`, text: '' }, true) }, '+'));
      ta.value = front().text;
    }

    // Notes leave the stack onto the canvas next to it. An emptied stack removes itself.
    function spill(ids) {
      const picked = d.notes.filter((n) => ids.includes(n.id));
      picked.forEach((n, i) => addNode('note', { title: n.title, x: node.x + node.w + 24 + i * 28, y: node.y + i * 28, data: { text: n.text } }, floor));
      d.notes = d.notes.filter((n) => !ids.includes(n.id));
      afterRemoval();
    }
    function remove(id) { d.notes = d.notes.filter((n) => n.id !== id); afterRemoval(); }
    function afterRemoval() {
      if (!d.notes.length) return removeNode(floor, node.id);
      if (!d.notes.some((n) => n.id === d.front)) d.front = d.notes[0].id;
      save(); render();
    }
    function moveTo(id, target) {
      const n = d.notes.find((x) => x.id === id);
      if (!n) return;
      if (!target) {
        target = addNode('stack', { x: node.x + node.w + 24, y: node.y, data: { notes: [n], front: n.id, color: d.color } }, floor);
        d.notes = d.notes.filter((x) => x.id !== id);
        afterRemoval();
        return;
      }
      d.notes = d.notes.filter((x) => x.id !== id);
      rt.get(floor.id).live.get(target.id)?.api.addNote(n, true);
      afterRemoval();
    }

    const api = entry.api;
    api.addNote = (n, focus) => {
      d.notes.push(n);
      if (focus) d.front = n.id;
      save(); render();
    };
    api.focus = () => ta.focus();

    addButton('▶', 'Send the front note to linked terminals and chats', () => {
      for (const t of linked()) { flash(t.node.id); t.api.send?.(front().text); }
    });
    addButton('🎨', 'Uniform color for the whole stack', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      popupMenu(r.left, r.bottom, Object.keys(STACK_COLORS).map((c) => ({ label: (d.color || 'none') === c ? `✓ ${c}` : c, onClick: () => { d.color = c === 'none' ? null : c; save(); render(); } })));
    });
    addButton('⤴', 'Spill every note onto the canvas and remove the stack', () => spill(d.notes.map((n) => n.id)));
    render();
  },
};

// Dropping a note (or stack) on top of another note/stack merges them. Returns true when the drag was consumed.
function stackDrop(f, node, e) {
  if (node.kind !== 'note' && node.kind !== 'stack') return false;
  const R = rt.get(f.id);
  const under = document.elementsFromPoint(e.clientX, e.clientY);
  const hit = [...R.live.values()].find((en) => en.node.id !== node.id && (en.node.kind === 'note' || en.node.kind === 'stack') && under.includes(en.el));
  if (!hit) return false;
  const target = hit.node;
  const asNotes = (n) => (n.kind === 'stack' ? n.data.notes : [{ id: uid(), title: n.title, text: n.data.text || '' }]);
  // Links on the absorbed node follow its notes to the surviving node.
  const rewire = (from, to) => {
    f.ropes.forEach((r) => { if (r.a === from) r.a = to; if (r.b === from) r.b = to; });
    const seen = new Set();
    f.ropes = f.ropes.filter((r) => { const k = [r.a, r.b].sort().join('|'); if (r.a === r.b || seen.has(k)) return false; seen.add(k); return true; });
  };
  let stack = target;
  if (target.kind === 'note') {
    stack = addNode('stack', { x: target.x, y: target.y, w: target.w, h: target.h, title: 'Stack', data: { notes: asNotes(target), front: null } }, f);
    rewire(target.id, stack.id);
    removeNode(f, target.id, true);
  }
  const api = R.live.get(stack.id).api;
  const incoming = asNotes(node);
  incoming.forEach((n, i) => api.addNote(n, i === incoming.length - 1));
  rewire(node.id, stack.id);
  removeNode(f, node.id, true);
  setSelection(f, [stack.id]);
  drawRopes(f);
  save();
  return true;
}
