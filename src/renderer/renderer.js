// Canvas, floors, node framework and ropes.
const viewport = document.getElementById('viewport');
const floorbar = document.getElementById('floorbar');

let state = { floors: [], active: null };

// State holds workspaces[]; each has its own floors. state.floors / state.active are accessors for the CURRENT workspace
// (not serialized), so code written for a single workspace keeps working. allFloors() spans every workspace.
function adoptState(s) {
  if (!Array.isArray(s.workspaces) || !s.workspaces.length) {
    s.workspaces = [{ id: Math.random().toString(36).slice(2, 10), name: 'Workspace 1', dir: '', profileId: '', floors: s.floors || [], active: s.active || null }];
    s.activeWs = s.workspaces[0].id;
  }
  if (!s.workspaces.some((w) => w.id === s.activeWs)) s.activeWs = s.workspaces[0].id;
  delete s.floors; delete s.active;
  const cur = () => s.workspaces.find((w) => w.id === s.activeWs);
  Object.defineProperty(s, 'floors', { get: () => cur().floors, set: (v) => { cur().floors = v; }, enumerable: false, configurable: true });
  Object.defineProperty(s, 'active', { get: () => cur().active, set: (v) => { cur().active = v; }, enumerable: false, configurable: true });
  return s;
}
const allFloors = () => state.workspaces.flatMap((w) => w.floors);
const wsOfFloor = (id) => state.workspaces.find((w) => w.floors.some((f) => f.id === id));
const wsOfNode = (nodeId) => state.workspaces.find((w) => w.floors.some((f) => f.nodes.some((n) => n.id === nodeId)));
const rt = new Map(); // floor id -> { root, world, nodesEl, ropesEl, live: Map(node id -> entry) }
let zTop = 1;
const selection = new Set(); // node ids selected on the active floor

function setSelection(f, ids) {
  selection.clear();
  ids.forEach((id) => selection.add(id));
  rt.get(f.id)?.live.forEach((e, id) => e.el.classList.toggle('selected', selection.has(id)));
}
const KIND_ICONS = { link: '🔗', group: '▢', terminal: '❯_', note: '✎', stack: '🗃', files: '🗂', git: '⑂', chat: '💬', portal: '🌐', device: '📱', draw: '✏' };

const uid = () => Math.random().toString(36).slice(2, 10);
let saveTimer;
const save = () => {
  if (typeof onStateChanged === 'function') onStateChanged(); // undo history (history.js)
  if (typeof syncMemLimits === 'function') syncMemLimits(); // memory limits live in the main process
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => call('workspace:save', state), 300);
};
const activeFloor = () => state.floors.find((f) => f.id === state.active);

function newFloor(partial = {}) {
  return { id: uid(), name: 'Floor', dir: '', repo: null, branch: null, view: { x: 0, y: 0, zoom: 1 }, nodes: [], ropes: [], ...partial };
}

// ---------- floors ----------
function mountFloor(f) {
  const world = h('div', { class: 'world' });
  const ropesEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ropesEl.setAttribute('class', 'ropes');
  const nodesEl = h('div', { class: 'nodes' });
  world.append(ropesEl, nodesEl);
  const root = h('div', { class: 'floor-root hidden' }, world);
  viewport.append(root);
  const entry = { root, world, nodesEl, ropesEl, live: new Map() };
  rt.set(f.id, entry);
  applyView(f);
  f.nodes.forEach((n) => mountNode(f, n));
}

function applyView(f) {
  const { x, y, zoom } = f.view;
  rt.get(f.id).world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  if (f.id !== state.active) return;
  const cell = 32 * zoom;
  viewport.style.setProperty("--cell", cell + "px");
  viewport.style.setProperty("--gx", (x % cell) + "px");
  viewport.style.setProperty("--gy", (y % cell) + "px");
  document.getElementById("zoom-pct").textContent = Math.round(zoom * 100) + "%";
}

// ---------- idle floors: stop idle terminals on floors nobody has opened for a while ----------
let lazyStart = false; // true while booting: terminals on hidden floors wait to be opened
const idleSince = new Map(); // floor id -> when it was last left
setInterval(() => {
  const min = state.settings?.terminal?.suspendIdleMin;
  if (!(min > 0)) return;
  const now = Date.now();
  for (const f of allFloors()) {
    if (f.id === state.active || now - (idleSince.get(f.id) || now) < min * 60000) continue;
    for (const e of rt.get(f.id)?.live.values() || []) e.api?.suspend?.();
  }
}, 60000);

function switchFloor(id) {
  if (state.active && state.active !== id) idleSince.set(state.active, Date.now());
  idleSince.delete(id);
  for (const e of rt.get(id)?.live.values() || []) e.api?.wake?.();
  if (typeof flushHistory === 'function') flushHistory();
  selection.clear();
  if (typeof cancelConnect === 'function') cancelConnect();
  const ws = wsOfFloor(id);
  if (ws && ws.id !== state.activeWs) state.activeWs = ws.id;
  state.active = id;
  if (typeof renderSidebar === 'function') renderSidebar();
  for (const [fid, e] of rt) e.root.classList.toggle('hidden', fid !== id);
  renderTabs();
  applyView(activeFloor());
  if (typeof historyBaseline === 'function') historyBaseline(activeFloor());
  if (typeof wakeRopes === 'function') wakeRopes();
  save();
}

function renderTabs() {
  floorbar.replaceChildren(
    ...state.floors.map((f) =>
      h('div', { class: 'floor-tab' + (f.id === state.active ? ' active' : ''), onclick: () => switchFloor(f.id) },
        f.repo ? h('span', { class: 'iso', title: `Isolated worktree (${f.branch})` }, '⑂') : null,
        h('span', {}, f.name),
        typeof prBadge === 'function' ? prBadge(f) : null,
        typeof floorStatusBadge === 'function' ? floorStatusBadge(f) : null,
        h('span', { class: 'menu-dot', title: 'Floor options', onclick: (e) => { e.stopPropagation(); floorMenu(f); } }, '⋮'))),
    h('button', { id: 'add-floor', title: 'New floor', onclick: createFloorDialog }, '+'));
}

async function createFloorDialog() {
  const name = h('input', { placeholder: 'Floor name', value: `Floor ${state.floors.length + 1}` });
  const dir = h('input', { placeholder: 'Working directory (optional)', value: state.workspaces.find((w) => w.id === state.activeWs)?.dir || '' });
  const iso = h('input', { type: 'checkbox' });
  const setup = h('input', { placeholder: 'e.g. npm install (optional)' });
  const note = h('div', { class: 'muted' });
  const browse = h('button', { onclick: async () => { const d = await call('files:pickDirectory'); if (d) { dir.value = d; check(); } } }, 'Browse');
  const isoLabel = h('label', { class: 'check' }, iso, 'Isolated floor (git worktree on its own branch)');
  const fromPr = h('button', { onclick: () => { closeModal(); floorFromPrDialog(); } }, 'Or create from a pull request…');
  let repoOk = false;
  const check = async () => {
    repoOk = dir.value ? await call('git:isRepo', dir.value) : false;
    iso.disabled = !repoOk;
    if (!repoOk) iso.checked = false;
    note.textContent = dir.value ? (repoOk ? 'Git repository detected.' : 'Not a git repository; isolation unavailable.') : '';
  };
  dir.addEventListener('change', check);
  iso.disabled = true;
  modal({
    title: 'New floor',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('label', {}, 'Name', name), h('label', {}, 'Directory', h('div', { class: 'row' }, dir, browse)), isoLabel, note,
      h('label', {}, 'Setup command (runs in a terminal when the floor opens)', setup), fromPr),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Create', primary: true, onClick: async (c) => {
          const f = newFloor({ name: name.value.trim() || 'Floor', dir: dir.value.trim(), hooks: { setup: setup.value.trim(), beforeLand: '' } });
          if (iso.checked) {
            const root = await call('app:worktreeRoot');
            const r = await withProgress('New floor', 'Creating a worktree…', () => call('git:worktreeAdd', f.dir, { name: f.name, root }));
            if (!r.ok) { alertModal('Could not create worktree', r.err); return; }
            f.repo = r.repo; f.branch = r.branch; f.dir = r.dir;
          }
          c();
          state.floors.push(f);
          mountFloor(f);
          switchFloor(f.id);
          if (f.hooks.setup) runSetup(f);
          if (!f.nodes.length) addNode('terminal');
        },
      },
    ],
  });
}

function floorMenu(f) {
  const buttons = [
    h('button', { onclick: () => { closeModal(); renameFloor(f); } }, 'Rename'),
    h('button', { onclick: () => { closeModal(); floorStatusDialog(f); } }, 'Set status…'),
    h('button', { onclick: () => { closeModal(); duplicateFloorDialog(f); } }, 'Duplicate'),
    h('button', { onclick: () => { closeModal(); hooksDialog(f); } }, 'Hooks…'),
    h('button', { onclick: () => { closeModal(); configDialog(f); } }, 'Config files…'),
    h('button', { onclick: () => { closeModal(); prDialog(f); } }, 'Pull request…'),
    f.dir ? h('button', { onclick: () => { closeModal(); openInIde(f.dir, { floor: f }); } }, 'Open in IDE') : null,
    f.repo ? h('button', { onclick: () => { closeModal(); testLanding(f); } }, 'Test landing (dry run)') : null,
    f.repo ? h('button', { class: 'primary', onclick: () => { closeModal(); landDialog(f); } }, 'Land (merge into ' + 'base branch)') : null,
    h('button', { onclick: () => { closeModal(); deleteFloor(f); } }, f.repo ? 'Discard floor and branch' : 'Delete floor'),
  ];
  modal({
    title: f.name,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
      h('div', { class: 'muted mono' }, [f.dir || 'No directory', f.repo ? `\nbranch ${f.branch}\nbase ${f.repo}` : '']), ...buttons),
    actions: [{ label: 'Close', onClick: (c) => c() }],
  });
}

// Floor hooks: a setup command typed into a terminal, and a check that must pass before landing.
function runSetup(f) {
  const t = addNode('terminal', { title: 'Setup' });
  setTimeout(() => rt.get(f.id).live.get(t.id)?.api.send?.(f.hooks.setup), 900);
}

function hooksDialog(f) {
  f.hooks ||= { setup: '', beforeLand: '' };
  const setup = h('input', { value: f.hooks.setup, placeholder: 'npm install' });
  const before = h('input', { value: f.hooks.beforeLand, placeholder: 'npm test' });
  modal({
    title: `Hooks for ${f.name}`,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('label', {}, 'Setup command', h('div', { class: 'row' }, setup, h('button', { title: 'Run it now in a new terminal', onclick: () => { f.hooks.setup = setup.value.trim(); if (f.hooks.setup) { closeModal(); if (f.id !== state.active) switchFloor(f.id); runSetup(f); } } }, 'Run now'))),
      h('label', {}, 'Check before landing (non-zero exit blocks landing until you confirm)', h('div', { class: 'row' }, before, h('button', { onclick: async (e) => { f.hooks.beforeLand = before.value.trim(); if (!f.hooks.beforeLand) return; e.target.disabled = true; const res = await runHookRecorded(f, 'check', f.hooks.beforeLand); closeModal(); alertModal(res.code === 0 ? 'Check passed' : `Check failed (exit ${res.code})`, res.output.trim() || '(no output)'); } }, 'Run now'))),
      h('div', { class: 'muted' }, 'Both run in the floor’s directory.'), hookHistoryEl(f)),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', primary: true, onClick: (c) => { f.hooks.setup = setup.value.trim(); f.hooks.beforeLand = before.value.trim(); save(); c(); } }],
  });
}

function renameFloor(f) {
  const input = h('input', { value: f.name });
  modal({
    title: 'Rename floor', content: input,
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Rename', primary: true, onClick: (c) => { f.name = input.value.trim() || f.name; c(); renderTabs(); save(); } }],
  });
}

async function deleteFloor(f) {
  const msg = f.repo ? `Discard "${f.name}"? Its worktree and branch ${f.branch} are deleted, including unmerged work.` : `Delete "${f.name}" and close its nodes?`;
  if (!(await confirmModal('Delete floor', msg, 'Delete'))) return;
  await removeFloor(f);
  if (f.repo) {
    const r = await withProgress('Discard floor', 'Removing the worktree and branch…', () => call('git:discardWorktree', { repo: f.repo, dir: f.dir, branch: f.branch }));
    if (r && r.ok === false) alertModal('Could not remove the worktree', r.err || 'Unknown error');
  }
}

async function removeFloor(f) {
  [...f.nodes].forEach((n) => removeNode(f, n.id, true));
  rt.get(f.id)?.root.remove();
  rt.delete(f.id);
  state.floors = state.floors.filter((x) => x.id !== f.id);
  if (!state.floors.length) {
    const nf = newFloor({ name: 'Main' });
    state.floors.push(nf);
    mountFloor(nf);
  }
  switchFloor(state.floors[0].id);
}

async function landDialog(f) {
  const pre = await call('git:landPreflight', { repo: f.repo, dir: f.dir, branch: f.branch });
  const msg = h('input', { value: `Land ${f.name}` });
  const commit = h('input', { type: 'checkbox', checked: true });
  const files = await call('git:landFiles', { repo: f.repo, dir: f.dir, branch: f.branch });
  const diffEl = h('div', { class: 'mono scroll bordered', style: 'max-height:200px;display:none' });
  const fileList = h('div', { class: 'scroll', style: 'max-height:120px' },
    files.length ? files.map((x) => h('div', {
      class: 'change',
      async onclick() {
        const text = await call('git:landFileDiff', { repo: f.repo, dir: f.dir, branch: f.branch, file: x.file, committed: x.committed });
        diffEl.style.display = '';
        diffEl.replaceChildren(...String(text || '(no diff)').split('\n').map((l) =>
          h('div', { class: l.startsWith('+') && !l.startsWith('+++') ? 'diff-add' : l.startsWith('-') && !l.startsWith('---') ? 'diff-del' : l.startsWith('@@') ? 'diff-hunk' : '' }, l || ' ')));
      },
    }, h('span', { class: 'st' }, x.status), h('span', {}, x.file), x.committed ? null : h('span', { class: 'muted', style: 'margin-left:auto' }, 'uncommitted')))
      : h('div', { class: 'muted' }, 'No changes in this floor.'));
  const hook = f.hooks?.beforeLand;
  let checkState = hook ? 'pending' : 'none'; // pending | passed | failed
  const checkOut = h('div', { class: 'mono bordered scroll', style: 'max-height:140px;display:none' });
  const checkLine = hook ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Check:'), h('span', { class: 'mono' }, hook)) : null;
  const runCheck = async () => {
    checkOut.style.display = '';
    checkOut.textContent = 'Running…';
    const res = await runHookRecorded(f, 'before landing', hook);
    checkState = res.code === 0 ? 'passed' : 'failed';
    checkOut.textContent = (res.timedOut ? '[timed out]\n' : '') + (res.output.trim() || '(no output)') + `\n\nexit code ${res.code}`;
    checkOut.classList.toggle('err', res.code !== 0);
    return res.code === 0;
  };
  const warn = [];
  if (pre.targetDirty) warn.push('The base checkout has uncommitted changes; the merge may fail.');
  if (pre.worktreeDirty) warn.push('This floor has uncommitted changes; they are committed first if the box is checked.');
  modal({
    title: `Land ${f.name}`,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('div', {}, `Merge ${f.branch} into ${pre.target} (${pre.commitsAhead} commit${pre.commitsAhead === 1 ? '' : 's'} ahead).`),
      h('div', { class: 'mono muted' }, pre.stat || 'No committed changes yet.'),
      h('div', { class: 'muted' }, 'Click a file to review its diff:'), fileList, diffEl,
      warn.map((w) => h('div', { class: 'err' }, w)),
      checkLine, checkOut,
      h('button', { onclick: async () => { closeModal(); await testLanding(f); landDialog(f); } }, 'Test landing (dry run)'),
      h('label', { class: 'check' }, commit, 'Commit uncommitted changes first'),
      h('label', {}, 'Merge message', msg)),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Land', primary: true, onClick: async (c) => {
          if (hook && checkState === 'pending') {
            if (!(await runCheck())) { checkOut.append('\nThe check failed. Press Land again to land anyway.'); return; }
          } else if (checkState === 'failed') { /* second press: land anyway */ }
          const r = await call('git:land', { repo: f.repo, dir: f.dir, branch: f.branch, message: msg.value, commitFirst: commit.checked });
          if (!r.ok) { alertModal('Landing failed (merge aborted)', r.err); return; }
          c();
          await removeFloor(f);
        },
      },
    ],
  });
}

// ---------- pan / zoom ----------
function startMarquee(f, e) {
  const box = h('div', { class: 'marquee' });
  viewport.append(box);
  const r = viewport.getBoundingClientRect();
  const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
  const base = e.ctrlKey || e.metaKey ? [...selection] : [];
  const onMove = (m) => {
    const x1 = m.clientX - r.left, y1 = m.clientY - r.top;
    const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), hgt = Math.abs(y1 - y0);
    Object.assign(box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: hgt + 'px' });
    const v = f.view;
    const wl = (l - v.x) / v.zoom, wt = (t - v.y) / v.zoom, wr = (l + w - v.x) / v.zoom, wb = (t + hgt - v.y) / v.zoom;
    setSelection(f, [...base, ...f.nodes.filter((n) => n.x < wr && n.x + n.w > wl && n.y < wb && n.y + n.h > wt).map((n) => n.id)]);
  };
  const up = () => { box.remove(); removeEventListener('mousemove', onMove); removeEventListener('mouseup', up); };
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', up);
}

function drag(onMove) {
  const up = () => { removeEventListener('mousemove', onMove); removeEventListener('mouseup', up); save(); };
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', up);
}

viewport.addEventListener('mousedown', (e) => {
  const f = activeFloor();
  if (!f || !e.target.classList.contains('floor-root') && e.target !== viewport && !e.target.classList.contains('world') && !e.target.classList.contains('nodes')) return;
  if (e.shiftKey) { startMarquee(f, e); return; }
  setSelection(f, []);
  const sx = e.clientX, sy = e.clientY, ox = f.view.x, oy = f.view.y;
  viewport.classList.add('panning');
  addEventListener('mouseup', () => viewport.classList.remove('panning'), { once: true });
  drag((m) => { f.view.x = ox + m.clientX - sx; f.view.y = oy + m.clientY - sy; applyView(f); });
});

viewport.addEventListener('wheel', (e) => {
  const f = activeFloor();
  if (!f || e.target.closest('.xterm, textarea, .scroll, .msgs, .tree, webview')) return;
  e.preventDefault();
  const v = f.view, old = v.zoom;
  v.zoom = Math.min(2, Math.max(0.25, old * (e.deltaY < 0 ? 1.1 : 0.9)));
  const r = viewport.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  v.x = px - (px - v.x) * (v.zoom / old);
  v.y = py - (py - v.y) * (v.zoom / old);
  applyView(f);
  save();
}, { passive: false });

// ---------- nodes ----------
function addNode(kind, partial = {}, floor = activeFloor()) {
  const f = floor, k = NodeKinds[kind];
  const r = viewport.getBoundingClientRect(), v = f.view;
  const node = {
    id: uid(), kind, title: k.label, data: {},
    x: (r.width / 2 - v.x) / v.zoom - k.w / 2 + Math.random() * 40,
    y: (r.height / 2 - v.y) / v.zoom - k.h / 2 + Math.random() * 40,
    w: k.w, h: k.h, ...partial,
  };
  f.nodes.push(node);
  mountNode(f, node);
  if (typeof placeNewAgent === 'function') placeNewAgent(f, node);
  save();
  if (kind === 'terminal' && f.id === state.active) setTimeout(() => rt.get(f.id)?.live.get(node.id)?.api.focus?.(), 0);
  return node;
}

function mountNode(f, node) {
  const k = NodeKinds[node.kind];
  const R = rt.get(f.id);
  node.data ||= {};
  const title = h('span', { class: 'title', contenteditable: 'false', spellcheck: 'false', title: 'Double-click to rename' }, node.title);
  const headBtns = h('span', { style: 'display:flex;gap:2px' });
  const connect = h('button', { title: 'Connect to another node (C)', onclick: () => startConnect(f, node.id) }, '🔗');
  const close = h('button', { class: 'close', title: 'Close', onclick: () => removeNode(f, node.id) }, '✕');
  const head = h('div', { class: 'node-head' }, h('span', { class: 'kind', title: k.label }, KIND_ICONS[node.kind] || '□'), title, headBtns, connect, close);
  const body = h('div', { class: 'node-body' });
  const grip = h('div', { class: 'resize' });
  const el = h('div', { class: 'node' }, head, body, grip);
  const entry = { el, node, api: {}, dispose: null };
  R.live.set(node.id, entry);
  place(node, el);
  R.nodesEl.append(el);

  const ctx = {
    node, floor: f, body, el, head, entry,
    save,
    addButton: (label, tip, fn) => { const b = h('button', { title: tip, onclick: fn }, label); headBtns.append(b); return b; },
    linked: () => linkedNodes(f, node.id),
    flash: (otherId) => flashRope(f, node.id, otherId),
    cwd: () => f.dir || undefined,
  };
  try {
    entry.dispose = k.mount(ctx) || null;
  } catch (err) {
    body.append(h('div', { class: 'err mono' }, `Failed to mount ${node.kind}: ${err.message}`));
  }

  el.addEventListener('mousedown', (e) => {
    // Ctrl/Cmd-click anywhere, or Shift-click on the header, toggles membership; a plain click selects just this node
    // unless it is already part of a multi-selection (so the group can be dragged).
    const multi = e.ctrlKey || e.metaKey || (e.shiftKey && head.contains(e.target));
    if (multi) setSelection(f, selection.has(node.id) ? [...selection].filter((i) => i !== node.id) : [...selection, node.id]);
    else if (!selection.has(node.id)) setSelection(f, [node.id]);
    el.style.zIndex = ++zTop; // bring to front (re-appending would swallow the click)
    entry.api.clearAttention?.();
  }, true);
  const startMove = (e) => {
    const ids = selection.has(node.id) ? [...selection] : [node.id];
    // Moving a group frame carries its members along.
    const carried = new Set(ids);
    for (const id of ids) { const g = f.nodes.find((n) => n.id === id); if (g?.kind === 'group') (g.data.members || []).forEach((m) => carried.add(m)); }
    const moving = [...carried].map((id) => f.nodes.find((n) => n.id === id)).filter(Boolean).map((n) => ({ n, ox: n.x, oy: n.y }));
    const sx = e.clientX, sy = e.clientY;
    drag((m) => {
      for (const { n, ox, oy } of moving) {
        n.x = ox + (m.clientX - sx) / f.view.zoom;
        n.y = oy + (m.clientY - sy) / f.view.zoom;
        place(n, rt.get(f.id).live.get(n.id).el);
      }
      drawRopes(f);
    });
    // Dropping a lone note or stack onto another one stacks them.
    if (ids.length === 1 && (node.kind === 'note' || node.kind === 'stack')) {
      addEventListener('mouseup', (up) => { if (Math.hypot(up.clientX - sx, up.clientY - sy) > 6) setTimeout(() => stackDrop(f, node, up), 0); }, { once: true });
    }
  };
  // The whole header drags; double-click the title to rename it.
  head.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    popupMenu(e.clientX, e.clientY, [
      ...(node.kind === 'terminal' ? [{ label: 'Terminal settings…', onClick: () => terminalDialog({ mode: 'edit', floor: f, node }) }, { label: 'Restart', onClick: () => entry.api.restart?.() }, { separator: true }] : []),
      { label: 'Connections…', onClick: () => connectionsDialog({ nodeId: node.id }) },
      { label: 'Rename', onClick: () => title.dispatchEvent(new MouseEvent('dblclick')) },
      { label: 'Close', onClick: () => removeNode(f, node.id) },
    ]);
  });
  head.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || title.isContentEditable) return;
    e.preventDefault(); // no text selection while dragging
    startMove(e);
    // preventDefault above also stops the click from moving keyboard focus; give it to the node (e.g. the terminal).
    setTimeout(() => { if (!title.isContentEditable) entry.api.focus?.(); }, 0);
  });
  title.addEventListener('dblclick', () => {
    title.contentEditable = 'true';
    title.focus();
    getSelection().selectAllChildren(title);
  });
  const endRename = () => { title.contentEditable = 'false'; node.title = title.textContent.trim() || k.label; title.textContent = node.title; save(); };
  title.addEventListener('blur', endRename);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  // Alt+drag moves the node from anywhere inside it (terminals, editors, ...).
  el.addEventListener('mousedown', (e) => {
    if (!e.altKey || e.target === grip) return;
    e.preventDefault();
    e.stopPropagation();
    startMove(e);
  }, true);
  grip.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = node.w, oh = node.h;
    drag((m) => { node.w = Math.max(220, ow + (m.clientX - sx) / f.view.zoom); node.h = Math.max(140, oh + (m.clientY - sy) / f.view.zoom); place(node, el); drawRopes(f); });
  });
  // Agent terminals can be minimised to a compact card (shell.js).
  if (k.minimizable && typeof setupMini === 'function') setupMini(f, node, entry, { head, el, startMove });
  drawRopes(f);
}

function place(node, el) {
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';
  el.style.width = node.w + 'px';
  el.style.height = node.h + 'px';
}

function removeNode(f, id, skipSave) {
  selection.delete(id);
  const R = rt.get(f.id), entry = R?.live.get(id);
  try { entry?.dispose?.(); } catch {}
  entry?.el.remove();
  R?.live.delete(id);
  f.nodes = f.nodes.filter((n) => n.id !== id);
  f.ropes = f.ropes.filter((r) => r.a !== id && r.b !== id);
  if (typeof dropRemoteRopesTo === 'function') dropRemoteRopesTo(f.id, id); // cross-floor ropes end here too
  if (!skipSave) { drawRopes(f); save(); }
}

// ---------- ropes (engine in ropes.js) ----------
function linkedNodes(f, id) {
  const R = rt.get(f.id);
  return f.ropes
    .filter((r) => r.a === id || (r.b === id && !r.rf))
    .map((r) => (r.rf ? rt.get(r.rf)?.live.get(r.b) : R.live.get(r.a === id ? r.b : r.a)))
    .filter(Boolean);
}

// ---------- toolbar ----------
function buildToolbar() {
  const wrap = document.querySelector(".menu-wrap");
  const btn = document.getElementById("add-btn");
  let menu = null;
  const close = () => { menu?.remove(); menu = null; };
  btn.onclick = (e) => {
    e.stopPropagation();
    if (menu) return close();
    menu = h("div", { class: "menu" }, Object.entries(NodeKinds).map(([kind, k]) =>
      h("button", { class: "menu-item", onclick: () => { close(); if (kind === 'terminal') terminalDialog({ mode: 'new', floor: activeFloor() }); else if (kind === 'link') PALETTE_COMMANDS.find((c) => c.id === 'add-link').run(); else addNode(kind); } }, h("span", { class: "ico" }, KIND_ICONS[kind] || ""), k.label)));
    wrap.append(menu);
  };
  addEventListener("click", close);
  addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); closeModal(); } });

  document.getElementById("link-mode").onclick = () => {
    if (connecting) return cancelConnect();
    const f = activeFloor();
    startConnect(f, selectedNode(f)?.id);
  };

  const zoomBy = (factor) => {
    const f = activeFloor(), v = f.view, old = v.zoom;
    v.zoom = Math.min(2, Math.max(0.25, factor ? old * factor : 1));
    const r = viewport.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
    v.x = cx - (cx - v.x) * (v.zoom / old);
    v.y = cy - (cy - v.y) * (v.zoom / old);
    applyView(f); save();
  };
  document.getElementById("zoom-in").onclick = () => zoomBy(1.2);
  document.getElementById("zoom-out").onclick = () => zoomBy(1 / 1.2);
  document.getElementById("zoom-pct").onclick = () => zoomBy(0);
}

// ---------- boot ----------
(async () => {
  // Classic scripts after this one (ropes.js) must finish loading before nodes mount.
  if (document.readyState === 'loading') await new Promise((res) => addEventListener('DOMContentLoaded', res));
  const saved = await call('workspace:load');
  if (saved?.floors || saved?.workspaces) state = saved;
  else if (saved?.nodes) {
    // v0.1 single-canvas workspace: migrate into one floor
    state = { floors: [newFloor({ name: 'Main', view: saved.view, ropes: saved.ropes || [], nodes: (saved.nodes || []).map((n) => ({ ...n, data: n.kind === 'note' ? { text: n.text || '' } : {} })) })], active: null };
  }
  state = adoptState(state);
  if (!state.floors.length) state.floors.push(newFloor({ name: 'Main' }));
  normalizeSettings();
  buildToolbar();
  lazyStart = true;
  allFloors().forEach(mountFloor);
  lazyStart = false;
  switchFloor(state.floors.find((f) => f.id === state.active)?.id || state.floors[0].id);
  for (const f of allFloors()) if (f.id !== state.active) idleSince.set(f.id, Date.now());
  const f = activeFloor();
  if (!f.nodes.length) addNode('terminal');
  if (typeof startI18n === 'function') startI18n();
})();
