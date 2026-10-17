// Layout templates: save a selection (nodes, ropes, positions, commands, roles - never scrollback), keep a library,
// insert it on any floor with variables like {{dir}} filled in, and export/import the library as JSON.

const TPL_VAR = /\{\{(\w+)\}\}/g;

// Everything under a group frame travels with it.
function captureSelection(f) {
  const ids = new Set(selection);
  for (const n of f.nodes) if (ids.has(n.id) && n.kind === 'group') (n.data.members || []).forEach((m) => ids.add(m));
  const picked = f.nodes.filter((n) => ids.has(n.id));
  if (!picked.length) return null;
  const x0 = Math.min(...picked.map((n) => n.x)), y0 = Math.min(...picked.map((n) => n.y));
  let json = JSON.stringify(picked.map((n) => ({ id: n.id, kind: n.kind, title: n.title, x: Math.round(n.x - x0), y: Math.round(n.y - y0), w: Math.round(n.w), h: Math.round(n.h), data: n.data })));
  // The floor's folder becomes a variable so the layout works on another project.
  if (f.dir) json = json.split(JSON.stringify(f.dir).slice(1, -1)).join('{{dir}}');
  return { nodes: JSON.parse(json), ropes: f.ropes.filter((r) => !r.rf && ids.has(r.a) && ids.has(r.b)).map((r) => ({ a: r.a, b: r.b })) };
}

function templateVars(t) {
  const names = new Set();
  JSON.stringify(t.nodes).replace(TPL_VAR, (_m, v) => names.add(v));
  return [...names];
}

function insertTemplate(t, f, values = {}) {
  let json = JSON.stringify(t.nodes);
  json = json.replace(TPL_VAR, (_m, v) => JSON.stringify(String(values[v] ?? '')).slice(1, -1));
  const nodes = JSON.parse(json);
  const r = viewport.getBoundingClientRect(), v = f.view;
  const w = Math.max(...nodes.map((n) => n.x + n.w)), hh = Math.max(...nodes.map((n) => n.y + n.h));
  const ox = (r.width / 2 - v.x) / v.zoom - w / 2, oy = (r.height / 2 - v.y) / v.zoom - hh / 2;
  const map = new Map();
  const made = nodes.map((n) => {
    const node = addNode(n.kind, { title: n.title, x: ox + n.x, y: oy + n.y, w: n.w, h: n.h, data: n.data }, f);
    map.set(n.id, node.id);
    return node;
  });
  for (const n of made) if (n.kind === 'group') n.data.members = (n.data.members || []).map((m) => map.get(m)).filter(Boolean);
  for (const rp of t.ropes) if (map.has(rp.a) && map.has(rp.b)) f.ropes.push({ id: uid(), a: map.get(rp.a), b: map.get(rp.b) });
  if (f.id !== state.active) switchFloor(f.id);
  setSelection(f, made.map((n) => n.id));
  save(); wakeRopes();
  return made;
}

function askText(title, label, value = '') {
  return new Promise((resolve) => {
    const input = h('input', { value });
    modal({ title, content: h('label', {}, label, input), actions: [{ label: 'Cancel', onClick: (c) => { c(); resolve(null); } }, { label: 'OK', primary: true, onClick: (c) => { c(); resolve(input.value.trim() || null); } }] });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.querySelector('#modal-root .primary')?.click(); });
  });
}

function askVars(t, f) {
  const names = templateVars(t);
  if (!names.length) return Promise.resolve({});
  return new Promise((resolve) => {
    const inputs = names.map((n) => h('input', { value: n === 'dir' ? (f.dir || '') : '', 'data-var': n }));
    modal({
      title: `Insert “${t.name}”`,
      content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:420px' }, h('div', { class: 'muted' }, 'Fill in the variables used by this layout.'), ...names.map((n, i) => h('label', {}, n, inputs[i]))),
      actions: [{ label: 'Cancel', onClick: (c) => { c(); resolve(null); } }, { label: 'Insert', primary: true, onClick: (c) => { c(); resolve(Object.fromEntries(names.map((n, i) => [n, inputs[i].value]))); } }],
    });
  });
}

async function insertWithPrompt(t, f = activeFloor()) {
  const values = await askVars(t, f);
  if (values) insertTemplate(t, f, values);
}

async function saveSelectionAsTemplate(update) {
  const f = activeFloor();
  const cap = captureSelection(f);
  if (!cap) { alertModal('Save layout', 'Select the nodes you want to save first.'); return null; }
  const name = update ? update.name : await askText('Save layout', 'Name', 'My layout');
  if (!name) return null;
  const r = await call('templates:save', { id: update?.id, name, ...cap });
  if (!r.ok) { alertModal('Save layout', r.error); return null; }
  return r.template;
}

async function templatesDialog() {
  const list = await call('templates:list');
  const reopen = () => { closeModal(); templatesDialog(); };
  const rows = list.length ? list.map((t) => h('div', { class: 'routine-row', 'data-id': t.id },
    h('div', { class: 'routine-main' },
      h('div', {}, h('b', {}, t.name)),
      h('div', { class: 'muted' }, `${t.nodes.length} node${t.nodes.length === 1 ? '' : 's'} · ${t.ropes.length} rope${t.ropes.length === 1 ? '' : 's'}${templateVars(t).length ? ' · variables: ' + templateVars(t).join(', ') : ''}`)),
    h('button', { class: 'primary', onclick: () => { closeModal(); insertWithPrompt(t); } }, 'Insert'),
    h('button', { title: 'Replace this layout with the current selection', onclick: async () => { if (selection.size && await confirmModal('Update layout', `Replace “${t.name}” with the ${selection.size} selected node(s)?`, 'Update')) { await saveSelectionAsTemplate(t); } reopen(); } }, 'Update'),
    h('button', { onclick: async () => { const n = await askText('Rename layout', 'Name', t.name); if (n) await call('templates:rename', t.id, n); reopen(); } }, 'Rename'),
    h('button', { onclick: async () => { const r = await call('templates:export', [t.id]); if (r.error) alertModal('Export failed', r.error); } }, 'Export'),
    h('button', { class: 'danger', onclick: async () => { if (await confirmModal('Delete layout', `Delete “${t.name}”?`, 'Delete')) await call('templates:remove', t.id); reopen(); } }, '✕')))
    : [h('div', { class: 'muted', style: 'padding:8px' }, 'No layouts yet. Select some nodes and choose “Save selection…”.')];
  modal({
    title: 'Layouts',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:600px' },
      h('div', { class: 'scroll bordered', style: 'max-height:300px' }, rows),
      h('div', { class: 'muted' }, 'Layouts keep nodes, ropes, positions, commands and roles. Terminal history is never saved.')),
    actions: [
      { label: 'Save selection…', primary: true, onClick: async () => { closeModal(); await saveSelectionAsTemplate(); templatesDialog(); } },
      { label: 'Import…', onClick: async () => { const r = await call('templates:import'); if (r.error) alertModal('Import failed', r.error); else reopen(); } },
      { label: 'Export all…', onClick: async () => { const r = await call('templates:export'); if (r.error) alertModal('Export failed', r.error); } },
      { label: 'Close', onClick: (c) => c() },
    ],
  });
}

document.getElementById('layouts-btn').onclick = templatesDialog;
registerCommand({ id: 'layouts', label: 'Layouts…', run: templatesDialog });
registerCommand({ id: 'layout-save', label: 'Save selection as a layout…', run: () => saveSelectionAsTemplate() });
