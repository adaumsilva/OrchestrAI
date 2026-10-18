// Workspaces: a level above floors. Each workspace has its own floors, default folder and default shell.
// Every workspace stays mounted while you work in another one, so its terminals keep running.

const sidebar = h('div', { id: 'sidebar', class: 'hidden' });
document.body.append(sidebar);
const currentWs = () => state.workspaces.find((w) => w.id === state.activeWs);

function setSidebar(open) {
  sidebar.classList.toggle('hidden', !open);
  document.body.classList.toggle('sb-open', open);
  document.getElementById('sidebar-btn')?.classList.toggle('active', open);
  try { localStorage.setItem('sidebar', open ? '1' : '0'); } catch {}
  if (open) renderSidebar();
  requestAnimationFrame(() => { const f = activeFloor(); if (f) applyView(f); });
}
const toggleSidebar = () => setSidebar(sidebar.classList.contains('hidden'));

function renderSidebar() {
  if (sidebar.classList.contains('hidden') || !state.workspaces) return;
  sidebar.replaceChildren(
    h('div', { class: 'sb-head' }, h('strong', {}, 'Workspaces'),
      h('button', { title: 'New workspace', onclick: () => workspaceDialog2(null) }, '+'),
      h('button', { title: 'Hide sidebar', onclick: () => setSidebar(false) }, '‹')),
    h('div', { class: 'sb-list' }, state.workspaces.map((w, i) => h('div', {
      class: 'sb-item' + (w.id === state.activeWs ? ' active' : ''), 'data-id': w.id, title: w.dir || w.name,
      onclick: () => switchWorkspace(w.id),
      oncontextmenu: (e) => { e.preventDefault(); workspaceMenu(w, e.clientX, e.clientY); },
    }, h('span', { class: 'sb-name' }, w.name), h('span', { class: 'sb-count' }, `${w.floors.length} floor${w.floors.length === 1 ? '' : 's'}`),
    h('span', { class: 'menu-dot', title: 'Workspace options', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); workspaceMenu(w, r.left, r.bottom); } }, '⋮')))));
}

function switchWorkspace(id) {
  const w = state.workspaces.find((x) => x.id === id);
  if (!w || w.id === state.activeWs && activeFloor()) return;
  if (!w.floors.length) { const nf = newFloor({ name: 'Main', dir: w.dir }); w.floors.push(nf); mountFloor(nf); }
  const f = w.floors.find((x) => x.id === w.active) || w.floors[0];
  switchFloor(f.id);
}

function cycleWorkspace(dir) {
  const i = state.workspaces.findIndex((w) => w.id === state.activeWs);
  switchWorkspace(state.workspaces[(i + dir + state.workspaces.length) % state.workspaces.length].id);
}

function addWorkspace(opts = {}) {
  const w = { id: uid(), name: opts.name || `Workspace ${state.workspaces.length + 1}`, dir: opts.dir || '', profileId: opts.profileId || '', floors: opts.floors || [], active: null };
  state.workspaces.push(w);
  if (!w.floors.length) w.floors.push(newFloor({ name: 'Main', dir: w.dir }));
  w.floors.forEach(mountFloor);
  switchFloor(w.floors[0].id);
  if (!opts.floors && !w.floors[0].nodes.length) addNode('terminal');
  save();
  return w;
}

// Fresh ids for every floor, node and rope so a copy (or an imported file) never clashes with what exists.
function cloneFloors(floors) {
  return floors.map((f) => {
    const copy = JSON.parse(JSON.stringify(f));
    const map = new Map();
    copy.id = uid();
    copy.nodes.forEach((n) => { map.set(n.id, uid()); n.id = map.get(n.id); });
    copy.ropes = copy.ropes.filter((r) => map.has(r.a) && map.has(r.b)).map((r) => ({ ...r, id: uid(), a: map.get(r.a), b: map.get(r.b) }));
    // A worktree belongs to one floor; the copy becomes an ordinary floor on the same folder.
    copy.repo = null; copy.branch = null;
    return copy;
  });
}

function duplicateWorkspace(w) {
  addWorkspace({ name: `${w.name} copy`, dir: w.dir, profileId: w.profileId, floors: cloneFloors(w.floors) });
}

function moveWorkspace(w, dir) {
  const i = state.workspaces.indexOf(w), j = i + dir;
  if (j < 0 || j >= state.workspaces.length) return;
  state.workspaces.splice(i, 1);
  state.workspaces.splice(j, 0, w);
  save(); renderSidebar();
}

async function deleteWorkspace(w) {
  if (state.workspaces.length < 2) return alertModal('Delete workspace', 'This is the only workspace.');
  const nodes = w.floors.reduce((n, f) => n + f.nodes.length, 0);
  if (!(await confirmModal('Delete workspace', `Delete "${w.name}" with ${w.floors.length} floor(s) and ${nodes} node(s)? Running terminals in it are closed.`, 'Delete'))) return;
  if (w.id === state.activeWs) switchWorkspace(state.workspaces.find((x) => x.id !== w.id).id);
  for (const f of w.floors) {
    [...f.nodes].forEach((n) => removeNode(f, n.id, true));
    rt.get(f.id)?.root.remove();
    rt.delete(f.id);
  }
  state.workspaces = state.workspaces.filter((x) => x.id !== w.id);
  save(); renderSidebar();
}

async function exportWorkspace(w) {
  const r = await call('data:export', { orchestraiWorkspace: 1, workspace: { name: w.name, dir: w.dir, profileId: w.profileId, floors: w.floors, active: w.active } });
  if (r.path) alertModal('Exported', r.path);
}

function importWorkspace(data) {
  const w = data.workspace;
  addWorkspace({ name: w.name || 'Imported', dir: w.dir || '', profileId: w.profileId || '', floors: cloneFloors(w.floors) });
}

function workspaceMenu(w, x, y) {
  const i = state.workspaces.indexOf(w);
  popupMenu(x, y, [
    { label: 'Rename / settings…', onClick: () => workspaceDialog2(w) },
    { label: 'Duplicate', onClick: () => duplicateWorkspace(w) },
    { label: 'Move up', disabled: i === 0, onClick: () => moveWorkspace(w, -1) },
    { label: 'Move down', disabled: i === state.workspaces.length - 1, onClick: () => moveWorkspace(w, 1) },
    { label: 'Export…', onClick: () => exportWorkspace(w) },
    { separator: true },
    { label: 'Delete…', disabled: state.workspaces.length < 2, onClick: () => deleteWorkspace(w) },
  ]);
}

// Create (w == null) or edit a workspace: name, default folder and default shell for new terminals.
async function workspaceDialog2(w) {
  const name = h('input', { value: w ? w.name : `Workspace ${state.workspaces.length + 1}` });
  const dir = h('input', { value: w?.dir || '', placeholder: 'Default folder for new floors (optional)' });
  const browse = h('button', { onclick: async () => { const d = await call('files:pickDirectory'); if (d) dir.value = d; } }, 'Browse');
  const { detected, custom, fallback } = await loadProfiles();
  const shell = h('select', {}, h('option', { value: '' }, `Global default (${fallback.label})`), ...[...custom, ...detected].map((p) => h('option', { value: p.id }, `${p.group}: ${p.label}`)));
  shell.value = w?.profileId || '';
  const ides = await ideList();
  const ide = h('select', {}, h('option', { value: '' }, ides.length ? `Automatic (${ides[0].label})` : 'None found'), ...ides.map((i) => h('option', { value: i.id }, i.label)));
  ide.value = w?.ide || '';
  modal({
    title: w ? 'Workspace settings' : 'New workspace',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('label', {}, 'Name', name), h('label', {}, 'Folder', h('div', { class: 'row' }, dir, browse)), h('label', {}, 'Default shell', shell), h('label', {}, 'Editor for “Open in IDE”', ide)),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: w ? 'Save' : 'Create', primary: true, onClick: (c) => {
          c();
          if (w) { w.name = name.value.trim() || w.name; w.dir = dir.value.trim(); w.profileId = shell.value; w.ide = ide.value; save(); renderSidebar(); }
          else addWorkspace({ name: name.value.trim() || undefined, dir: dir.value.trim(), profileId: shell.value }).ide = ide.value;
        },
      },
    ],
  });
}

// Ctrl+Alt+PageUp / PageDown cycle workspaces (before the floor shortcut sees the same keys).
addEventListener('keydown', (e) => {
  const dir = shortcutMatch(e, 'nextWorkspace') ? 1 : shortcutMatch(e, 'prevWorkspace') ? -1 : 0;
  if (!dir) return;
  e.preventDefault(); e.stopImmediatePropagation();
  cycleWorkspace(dir);
}, true);

document.getElementById('sidebar-btn').onclick = toggleSidebar;
registerCommand({ id: 'toggle-sidebar', label: 'Toggle workspace sidebar', run: toggleSidebar });
registerCommand({ id: 'new-workspace', label: 'New workspace…', run: () => workspaceDialog2(null) });
registerCommand({ id: 'next-workspace', label: 'Next workspace', hint: 'Ctrl+Alt+PageDown', run: () => cycleWorkspace(1) });
registerCommand({ id: 'prev-workspace', label: 'Previous workspace', hint: 'Ctrl+Alt+PageUp', run: () => cycleWorkspace(-1) });
registerCommand({ id: 'switch-workspace', label: 'Switch workspace…', run: async () => {
  const it = await openPalette({ items: state.workspaces.map((w) => ({ key: 'ws:' + w.id, label: w.name, sub: `${w.floors.length} floors`, icon: '▤', ws: w })), placeholder: 'Switch to workspace…', noRun: true, recent: false });
  if (it) switchWorkspace(it.ws.id);
} });
try { setSidebar(localStorage.getItem('sidebar') !== '0'); } catch { setSidebar(true); } // open unless the user closed it
