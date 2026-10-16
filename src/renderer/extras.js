// Selection actions, tidy, minimap, keyboard navigation, shortcuts help and the workspace dialog.
// Loaded after renderer.js and ropes.js; uses their globals at call time.

const KIND_COLORS = { terminal: '#8e8e93', note: '#ffd60a', files: '#64d2ff', git: '#ff9f0a', chat: '#bf5af2', portal: '#30d158', device: '#ff453a', draw: '#ff375f' };
const modalOpen = () => !!document.getElementById('modal-root').firstChild;

// ---------- selection ----------
async function deleteSelection() {
  const f = activeFloor();
  if (!f || !selection.size) return;
  const ids = [...selection];
  const live = ids.filter((id) => f.nodes.find((n) => n.id === id)?.kind === 'terminal').length;
  if (ids.length > 1 || live) {
    const what = ids.length === 1 ? 'this terminal' : `${ids.length} nodes`;
    if (!(await confirmModal('Delete', `Delete ${what}?${live ? ' Running terminals are closed.' : ''}`, 'Delete'))) return;
  }
  ids.forEach((id) => removeNode(f, id, true));
  selection.clear();
  wakeRopes();
  save();
}

function selectAll() {
  const f = activeFloor();
  if (f) setSelection(f, f.nodes.map((n) => n.id));
}

// ---------- tidy ----------
function glide(f, ms = 450) {
  const R = rt.get(f.id);
  R.world.classList.add('tidying');
  const t0 = performance.now();
  (function loop() {
    wakeRopes();
    if (performance.now() - t0 < ms) requestAnimationFrame(loop); else R.world.classList.remove('tidying');
  })();
}

// Lay the selected nodes (or every node when fewer than two are selected) out as rows, top-left aligned.
function tidy() {
  const f = activeFloor();
  if (!f || !f.nodes.length) return;
  const picked = selection.size > 1 ? f.nodes.filter((n) => selection.has(n.id)) : f.nodes.slice();
  const nodes = picked.sort((a, b) => (Math.abs(a.y - b.y) > 80 ? a.y - b.y : a.x - b.x));
  const gap = 28;
  const left = Math.min(...nodes.map((n) => n.x)), top = Math.min(...nodes.map((n) => n.y));
  const widest = nodes.reduce((s, n) => s + n.w + gap, 0);
  const rowMax = Math.max(1400, Math.min(widest, 2400) / Math.ceil(Math.sqrt(nodes.length / 2 + 0.01)));
  let x = left, y = top, rowH = 0;
  for (const n of nodes) {
    if (x > left && x + n.w > left + rowMax) { x = left; y += rowH + gap; rowH = 0; }
    n.x = x; n.y = y;
    x += n.w + gap;
    rowH = Math.max(rowH, n.h);
  }
  glide(f);
  nodes.forEach((n) => place(n, rt.get(f.id).live.get(n.id).el));
  save();
}

// ---------- navigation ----------
function centerOn(f, node) {
  const R = rt.get(f.id), r = viewport.getBoundingClientRect(), v = f.view;
  R.world.classList.add('gliding');
  v.x = r.width / 2 - (node.x + node.w / 2) * v.zoom;
  v.y = r.height / 2 - (node.y + node.h / 2) * v.zoom;
  applyView(f);
  setTimeout(() => R.world.classList.remove('gliding'), 320);
  save();
}

function cycleNode(f, dir) {
  if (!f.nodes.length) return;
  const cur = selection.size === 1 ? f.nodes.findIndex((n) => n.id === [...selection][0]) : -1;
  const next = f.nodes[(cur + dir + f.nodes.length) % f.nodes.length];
  setSelection(f, [next.id]);
  const entry = rt.get(f.id).live.get(next.id);
  entry.el.style.zIndex = ++zTop;
  centerOn(f, next);
  entry.api.focus?.();
}

function cycleFloor(dir) {
  const i = state.floors.findIndex((x) => x.id === state.active);
  switchFloor(state.floors[(i + dir + state.floors.length) % state.floors.length].id);
}

// ---------- minimap ----------
const minimap = h('div', { id: 'minimap', class: 'hidden' }, h('canvas', { width: 220, height: 140 }));
document.body.append(minimap);
const mmCanvas = minimap.firstChild;
let mmTimer = null;

function mmGeometry(f) {
  const r = viewport.getBoundingClientRect(), v = f.view;
  const view = { x: -v.x / v.zoom, y: -v.y / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom };
  const all = [view, ...f.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))];
  const x0 = Math.min(...all.map((b) => b.x)) - 60, y0 = Math.min(...all.map((b) => b.y)) - 60;
  const x1 = Math.max(...all.map((b) => b.x + b.w)) + 60, y1 = Math.max(...all.map((b) => b.y + b.h)) + 60;
  const scale = Math.min(mmCanvas.width / (x1 - x0), mmCanvas.height / (y1 - y0));
  return { view, x0, y0, scale, offX: (mmCanvas.width - (x1 - x0) * scale) / 2, offY: (mmCanvas.height - (y1 - y0) * scale) / 2 };
}

function drawMinimap() {
  const f = activeFloor();
  if (!f || minimap.classList.contains('hidden')) return;
  const ctx = mmCanvas.getContext('2d'), g = mmGeometry(f);
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
  const sx = (x) => (x - g.x0) * g.scale + g.offX, sy = (y) => (y - g.y0) * g.scale + g.offY;
  ctx.globalAlpha = 0.85;
  for (const n of f.nodes) {
    ctx.fillStyle = KIND_COLORS[n.kind] || '#8e8e93';
    ctx.fillRect(sx(n.x), sy(n.y), Math.max(3, n.w * g.scale), Math.max(3, n.h * g.scale));
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#0a84ff';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = (css.getPropertyValue('--accent').trim() || '#0a84ff') + '22';
  ctx.fillRect(sx(g.view.x), sy(g.view.y), g.view.w * g.scale, g.view.h * g.scale);
  ctx.strokeRect(sx(g.view.x), sy(g.view.y), g.view.w * g.scale, g.view.h * g.scale);
}

function toggleMinimap(force) {
  const show = force ?? minimap.classList.contains('hidden');
  minimap.classList.toggle('hidden', !show);
  document.getElementById('minimap-btn')?.classList.toggle('active', show);
  clearInterval(mmTimer);
  if (show) { drawMinimap(); mmTimer = setInterval(drawMinimap, 200); }
  try { localStorage.setItem('minimap', show ? '1' : '0'); } catch {}
}

mmCanvas.addEventListener('mousedown', (e) => {
  const f = activeFloor();
  if (!f) return;
  e.preventDefault();
  const pan = (m) => {
    const g = mmGeometry(f), r = mmCanvas.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    const cx = ((m.clientX - r.left) * (mmCanvas.width / r.width) - g.offX) / g.scale + g.x0;
    const cy = ((m.clientY - r.top) * (mmCanvas.height / r.height) - g.offY) / g.scale + g.y0;
    f.view.x = vr.width / 2 - cx * f.view.zoom;
    f.view.y = vr.height / 2 - cy * f.view.zoom;
    applyView(f);
    drawMinimap();
  };
  pan(e);
  drag(pan);
});

// ---------- shortcuts ----------
const SHORTCUTS = [
  ['Pan', 'Drag the background'],
  ['Zoom', 'Scroll wheel, or the − / + buttons'],
  ['Move a node', 'Drag its header, or Alt+drag anywhere on it'],
  ['Select several', 'Ctrl+click, Shift+click a header, or Shift+drag a box on the canvas'],
  ['Select all', 'Ctrl+A'],
  ['Connect nodes', 'Select a node, press C, click another node (Esc cancels)'],
  ['Remove a connection', 'Hover the rope and click ×'],
  ['Tidy', 'T arranges the selection, or all nodes'],
  ['Minimap', 'M'],
  ['Delete selection', 'Delete or Backspace'],
  ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z (nodes, ropes, layout)'],
  ['Next / previous node', 'Alt+] / Alt+['],
  ['Next / previous floor', 'Ctrl+PageDown / Ctrl+PageUp'],
  ['Shortcuts', '?'],
];

function helpDialog() {
  modal({
    title: 'Keyboard & mouse',
    content: h('div', { style: 'display:grid;grid-template-columns:auto 1fr;gap:6px 16px' },
      SHORTCUTS.flatMap(([a, b]) => [h('span', { class: 'muted' }, a), h('span', {}, b)])),
    actions: [{ label: 'Close', primary: true, onClick: (c) => c() }],
  });
}

addEventListener('keydown', (e) => {
  if (modalOpen()) return;
  const f = activeFloor();
  if (!f) return;
  // These also work while a terminal has focus (terminal.js lets them through).
  if (e.altKey && (e.key === '[' || e.key === ']')) { e.preventDefault(); cycleNode(f, e.key === ']' ? 1 : -1); return; }
  if (e.ctrlKey && (e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); cycleFloor(e.key === 'PageDown' ? 1 : -1); return; }
  if (isTyping(e.target)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 't') tidy();
  else if (k === 'm') toggleMinimap();
  else if (e.key === '?') helpDialog();
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
});

// ---------- workspace dialog (export, import, backups) ----------
async function replaceWorkspace(data) {
  if (!(await confirmModal('Replace workspace', 'This replaces every floor and closes all running terminals. A backup of the current workspace is kept.', 'Replace'))) return;
  await call('data:backupNow');
  api.ptyKillAll();
  await call('workspace:save', data);
  location.reload();
}

async function workspaceDialog() {
  const backups = await call('data:backups');
  const list = h('div', { class: 'scroll bordered', style: 'max-height:180px' },
    backups.length ? backups.map((b) => h('div', {
      class: 'change',
      async onclick() {
        const r = await call('data:restore', b.name);
        if (r.error) return alertModal('Restore failed', r.error);
        closeModal();
        replaceWorkspace(r.data);
      },
    }, h('span', {}, new Date(b.mtime).toLocaleString()), h('span', { class: 'muted', style: 'margin-left:auto' }, `${Math.max(1, Math.round(b.size / 1024))} KB`)))
      : h('div', { class: 'muted', style: 'padding:6px' }, 'No backups yet. One is made every 10 minutes when something changed, and on quit.'));
  modal({
    title: 'Workspace',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('div', { class: 'row' },
        h('button', {
          async onclick() {
            const r = await call('data:export', state);
            if (r.path) alertModal('Exported', r.path);
          },
        }, 'Export…'),
        h('button', {
          async onclick() {
            const r = await call('data:import');
            if (r.error) return alertModal('Import failed', r.error);
            if (r.data) { closeModal(); replaceWorkspace(r.data); }
          },
        }, 'Import…'),
        h('button', { onclick: () => call('data:revealBackups') }, 'Open backups folder')),
      h('div', { class: 'muted' }, 'Restore a backup (click to restore):'), list),
    actions: [{ label: 'Close', primary: true, onClick: (c) => c() }],
  });
}

// ---------- toolbar wiring ----------
document.getElementById('tidy-btn').onclick = tidy;
document.getElementById('minimap-btn').onclick = () => toggleMinimap();
document.getElementById('help-btn').onclick = helpDialog;
document.getElementById('workspace-btn').onclick = workspaceDialog;
try { if (localStorage.getItem('minimap') === '1') toggleMinimap(true); } catch {}
