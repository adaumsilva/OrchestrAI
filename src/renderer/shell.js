// App shell: top bar, view tabs, activity feed, status bar and the minimised agent cards.
// Loaded last. Agent terminals start minimised (a compact card) except the Maestro; the user can open or minimise any of them.

const MINI = 96; // card size on the canvas (the label hangs below it)
const MAESTRO_SIZE = { w: 640, h: 420 };
const $ = (id) => document.getElementById(id);

// ---------- agent state ----------
// Working = producing output, Waiting = flagged for attention, Idle = quiet or stopped.
function agentState(entry) {
  const st = entry.api.status?.() || 'starting';
  if (entry.el.classList.contains('attention')) return { key: 'waiting', label: 'Waiting' };
  if (st === 'running') return { key: 'working', label: 'Working' };
  if (st === 'starting') return { key: 'working', label: 'Starting' };
  if (st === 'exited') return { key: 'idle', label: 'Exited' };
  if (st === 'error') return { key: 'idle', label: 'Error' };
  return { key: 'idle', label: 'Idle' };
}

function eachAgent(fn, floors = allFloors()) {
  for (const f of floors) {
    const R = rt.get(f.id);
    for (const n of f.nodes) {
      if (n.kind !== 'terminal') continue;
      const e = R?.live.get(n.id);
      if (e) fn(f, n, e);
    }
  }
}

const maestroOf = (f) => f.nodes.find((n) => n.kind === 'terminal' && n.data?.maestro);

// ---------- minimised cards ----------
function setupMini(f, node, entry, { head, el, startMove }) {
  const d = node.data;
  const icon = h('span', { class: 'mini-icon' });
  const dot = h('span', { class: 'mini-dot' });
  const expand = h('button', { class: 'mini-expand', title: 'Open terminal' }, '⤢');
  const name = h('div', { class: 'mini-name' });
  const stat = h('div', { class: 'mini-stat' });
  const card = h('div', { class: 'mini-card' }, h('div', { class: 'mini-tile' }, icon, dot, expand), h('div', { class: 'mini-label' }, name, stat));
  el.append(card);
  el.classList.add('agent');

  const chip = h('span', { class: 'chip-orch' }, 'Orchestrator');
  const headState = h('span', { class: 'head-state' });
  head.querySelector('.title').after(chip, headState, h('span', { class: 'head-spacer' }));
  const minBtn = h('button', { class: 'min-btn', title: 'Minimize to a card', onclick: () => setMin(true) }, '–');
  head.querySelector('button.close').before(minBtn);

  const refresh = () => {
    const s = agentState(entry);
    el.dataset.agent = s.key;
    icon.textContent = d.icon || '❯_';
    name.textContent = node.title;
    stat.textContent = s.label;
    headState.textContent = s.label;
    chip.hidden = !d.maestro;
    el.classList.toggle('maestro', !!d.maestro);
  };

  function setMin(min, reveal) {
    const was = !!d.min;
    if (min === was && d.min !== undefined) return;
    const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
    if (min) {
      if (!was) { d.fullW = node.w; d.fullH = node.h; }
      node.w = node.h = MINI;
    } else {
      const big = d.maestro ? MAESTRO_SIZE : { w: NodeKinds.terminal.w, h: NodeKinds.terminal.h };
      node.w = d.fullW > MINI ? d.fullW : big.w;
      node.h = d.fullH > MINI ? d.fullH : big.h;
    }
    node.x = cx - node.w / 2;
    node.y = cy - node.h / 2;
    d.min = min;
    el.classList.toggle('mini', min);
    place(node, el);
    drawRopes(f);
    if (!min) { el.style.zIndex = ++zTop; if (reveal && f.id === state.active) centerOn(f, node); setTimeout(() => entry.api.focus?.(), 80); }
    save();
  }

  // Default: minimised, except the Maestro. Saved choices are kept.
  if (d.min === undefined) setMin(!d.maestro);
  else el.classList.toggle('mini', !!d.min);
  refresh();

  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.mini-expand')) return;
    e.preventDefault();
    startMove(e);
    const sx = e.clientX, sy = e.clientY;
    addEventListener('mouseup', (u) => {
      const connectingNow = typeof connecting !== 'undefined' && connecting;
      if (Math.hypot(u.clientX - sx, u.clientY - sy) < 4 && !connectingNow) setMin(false, true);
    }, { once: true });
  });
  expand.addEventListener('click', () => setMin(false, true));
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    popupMenu(e.clientX, e.clientY, [
      { label: 'Open terminal', onClick: () => setMin(false, true) },
      { label: 'Terminal settings…', onClick: () => terminalDialog({ mode: 'edit', floor: f, node }) },
      { label: 'Restart', onClick: () => entry.api.restart?.() },
      { label: 'Connections…', onClick: () => connectionsDialog({ nodeId: node.id }) },
      { separator: true },
      { label: 'Close', onClick: () => removeNode(f, node.id) },
    ]);
  });
  // Renames come through the title span; appearance changes through applyAppearance.
  new MutationObserver(refresh).observe(head.querySelector('.title'), { childList: true, characterData: true, subtree: true });
  const origAppearance = entry.api.applyAppearance;
  entry.api.applyAppearance = () => { origAppearance?.(); refresh(); };

  entry.api.setMin = setMin;
  entry.api.isMin = () => !!d.min;
  entry.api.refreshAgent = refresh;
}

// Collision check in world coordinates; the label under a card needs ~44px.
const hits = (a, b) => a.x < b.x + b.w + 24 && a.x + a.w + 24 > b.x && a.y < b.y + b.h + 48 && a.y + a.h + 48 > b.y;

// A new minimised agent goes into the next free slot beside the Maestro (left, right, left, ...).
function placeNewAgent(f, node) {
  if (node.kind !== 'terminal' || !node.data.min || node.data.maestro) return;
  const m = maestroOf(f);
  if (!m) return;
  const others = f.nodes.filter((n) => n !== node);
  const minis = others.filter((n) => n.kind === 'terminal' && n.data.min && !n.data.maestro).length;
  for (let i = minis; i < minis + 60; i++) {
    const right = i % 2 === 1, row = Math.floor(i / 2);
    const x = right ? m.x + m.w + 150 : m.x - 150 - MINI;
    const y = m.y + row * 160;
    const cand = { x, y, w: MINI, h: MINI };
    if (!others.some((n) => hits(cand, n))) { Object.assign(node, cand); break; }
  }
  place(node, rt.get(f.id).live.get(node.id).el);
  drawRopes(f);
}

function arrangeAgents(f = activeFloor()) {
  const m = maestroOf(f);
  const minis = f.nodes.filter((n) => n.kind === 'terminal' && n.data.min && !n.data.maestro);
  if (!minis.length) return hint('No minimised agents to arrange');
  const rows = Math.ceil(minis.length / 2);
  const mid = m ? m.y + m.h / 2 : minis[0].y;
  const cx = m ? m.x + m.w / 2 : minis[0].x;
  const halfW = m ? m.w / 2 + 150 : 190;
  const top = mid - (rows * 160 - 54) / 2;
  minis.forEach((n, i) => {
    const right = i % 2 === 1;
    n.x = right ? cx + halfW : cx - halfW - MINI;
    n.y = top + Math.floor(i / 2) * 160;
    place(n, rt.get(f.id).live.get(n.id).el);
  });
  drawRopes(f);
  save();
}

function revealAgent(f, node) {
  const e = rt.get(f.id)?.live.get(node.id);
  if (!e) return;
  e.api.setMin?.(false);
  jumpToNode(f, node);
}

function focusMaestro() {
  const f = activeFloor();
  const m = maestroOf(f);
  if (!m) { hint('No Maestro on this floor: turn on Maestro in a terminal’s settings'); setTimeout(() => hint(''), 3000); return; }
  revealAgent(f, m);
}

// ---------- activity feed ----------
const events = [];
const lastState = new Map();
let unread = 0;
let actFilter = 'all';
const actList = h('div', { class: 'act-list' });
const actSelect = h('select', { onchange: () => { actFilter = actSelect.value; renderActivity(); } },
  h('option', { value: 'all' }, 'All events'), h('option', { value: 'working' }, 'Working'), h('option', { value: 'waiting' }, 'Waiting'), h('option', { value: 'idle' }, 'Idle'));
const activityEl = $('activity');
activityEl.append(h('div', { class: 'act-head' }, h('strong', {}, 'Activity'), actSelect), actList);
const clock = (t) => t.toTimeString().slice(0, 8);

function renderActivity() {
  const shown = events.filter((ev) => actFilter === 'all' || ev.key === actFilter).slice(0, 150);
  actList.replaceChildren(...(shown.length ? shown.map((ev) => h('div', { class: 'act-item', 'data-k': ev.key },
    h('span', { class: 'act-dot' }),
    h('div', { class: 'act-main' },
      h('div', { class: 'act-top' }, h('span', { class: 'act-text' }, ev.text), h('span', { class: 'act-time' }, clock(ev.t))),
      ev.detail ? h('div', { class: 'act-detail' }, ev.detail) : null,
      ev.review ? h('button', { class: 'act-review', onclick: () => { const f = allFloors().find((x) => x.id === ev.floorId); const n = f?.nodes.find((x) => x.id === ev.nodeId); if (n) revealAgent(f, n); } }, 'Review') : null)))
    : [h('div', { class: 'muted', style: 'padding:14px' }, 'Agent status changes appear here.')]));
}

function pushEvent(f, n, e, s) {
  const text = s.key === 'working' ? `${n.title} started working` : s.key === 'waiting' ? `${n.title} needs attention` : `${n.title} is ${s.label.toLowerCase()}`;
  const detail = e.api.lastLine?.().slice(0, 90) || f.name;
  events.unshift({ t: new Date(), key: s.key, text, detail, review: s.key === 'waiting', floorId: f.id, nodeId: n.id });
  if (events.length > 300) events.length = 300;
  if (!document.body.classList.contains('act-open')) unread++;
  renderActivity();
  renderBell();
}

function onStatus(ev) {
  const id = ev.detail?.id;
  eachAgent((f, n, e) => {
    if (id && n.id !== id) return;
    e.api.refreshAgent?.();
    const s = agentState(e);
    const prev = lastState.get(n.id);
    lastState.set(n.id, s.key);
    if (prev && prev !== s.key) pushEvent(f, n, e, s);
  });
  renderCounts();
}

// ---------- counts: canvas heading and status bar ----------
function countStates(floors) {
  const c = { working: 0, waiting: 0, idle: 0 };
  eachAgent((f, n, e) => { c[agentState(e).key]++; }, floors);
  return c;
}

function renderCounts() {
  const f = activeFloor();
  if (!f) return;
  const c = countStates([f]);
  const chips = (cc) => ['working', 'waiting', 'idle'].map((k) => h('span', { class: 'cnt', 'data-k': k }, h('i', {}), `${cc[k]} ${k}`));
  const m = maestroOf(f);
  $('canvas-head').replaceChildren(
    h('h1', {}, f.name),
    h('p', {}, m ? 'One conductor. Every agent in view.' : 'Turn on Maestro in a terminal to conduct the others.'),
    h('div', { class: 'cnt-row' }, ...chips(c)));
  const w = countStates(currentWs()?.floors || [f]);
  $('st-ws').textContent = currentWs()?.name || '';
  $('st-counts').replaceChildren(...['working', 'waiting', 'idle'].map((k) => h('span', { class: 'cnt', 'data-k': k }, h('i', {}), `${k[0].toUpperCase() + k.slice(1)} (${w[k]})`)));
  const ws = currentWs();
  const crumbs = $('crumbs');
  crumbs.replaceChildren(h('span', { class: 'crumb-ws' }, ws?.name || ''), h('span', { class: 'crumb-sep' }, '/'), h('span', { class: 'crumb-floor' }, f.name));
}

function renderBell() {
  const b = $('bell-btn').querySelector('.badge');
  b.textContent = String(unread);
  b.classList.toggle('hidden', !unread);
}

// ---------- panels and tabs ----------
const tabs = [
  { id: 'canvas', label: 'Canvas', icon: '▦' },
  { id: 'tasks', label: 'Tasks', icon: '☰' },
  { id: 'activity', label: 'Activity', icon: '∿' },
];
const tabEls = {};
const viewtabs = $('viewtabs');
for (const t of tabs) {
  tabEls[t.id] = h('button', { class: 'vtab', onclick: () => showView(t.id) }, h('span', { class: 'vt-ico' }, t.icon), t.label);
  viewtabs.append(tabEls[t.id]);
}

const tasksOpen = () => typeof tmOpen === 'function' && tmOpen();
function setActivity(open) {
  document.body.classList.toggle('act-open', open);
  if (open) { unread = 0; renderBell(); renderActivity(); }
  try { localStorage.setItem('activity', open ? '1' : '0'); } catch {}
  syncTabs();
  requestAnimationFrame(() => { const f = activeFloor(); if (f) applyView(f); });
}
function showView(id) {
  if (id === 'canvas') { if (tasksOpen()) toggleTaskManager(false); }
  else if (id === 'tasks') toggleTaskManager(!tasksOpen());
  else if (id === 'activity') setActivity(!document.body.classList.contains('act-open'));
  syncTabs();
}
function syncTabs() {
  const act = document.body.classList.contains('act-open'), tasks = tasksOpen();
  tabEls.canvas.classList.toggle('active', !tasks);
  tabEls.tasks.classList.toggle('active', tasks);
  tabEls.activity.classList.toggle('active', act);
}
new MutationObserver(syncTabs).observe(document.getElementById('taskmgr-panel'), { attributes: true, attributeFilter: ['class'] });
$('bell-btn').onclick = () => setActivity(!document.body.classList.contains('act-open'));
$('focus-btn').onclick = focusMaestro;

// Secondary tools live behind one menu; they click the original (hidden) buttons so every existing handler keeps working.
$('tools-btn').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const via = (label, id) => ({ label, onClick: () => $(id).click() });
  popupMenu(r.right - 200, r.bottom + 4, [
    via('Minimap', 'minimap-btn'), via('Terminals overview', 'terminals-btn'), via('Saved layouts', 'layouts-btn'),
    via('Scheduled routines', 'routines-btn'), via('Agent usage', 'usage-btn'),
    { label: 'Arrange agents around Maestro', onClick: () => arrangeAgents() },
    { separator: true },
    via('Terminal settings', 'settings-btn'), via('Export, import and backups', 'workspace-btn'), via('Keyboard shortcuts', 'help-btn'),
  ]);
};

// ---------- sidebar navigation (under the workspace list) ----------
const baseRenderSidebar = renderSidebar;
renderSidebar = function () {
  baseRenderSidebar();
  if (sidebar.classList.contains('hidden')) return;
  let agents = 0;
  eachAgent(() => { agents++; });
  const nav = (label, ico, fn, count) => h('button', { class: 'sb-nav-item', onclick: fn }, h('span', { class: 'nav-ico' }, ico), h('span', { class: 'nav-label' }, label), count ? h('span', { class: 'nav-count' }, String(count)) : null);
  sidebar.append(h('div', { class: 'sb-nav' },
    nav('Overview', '⌂', () => { showView('canvas'); const f = activeFloor(); if (f?.nodes.length) fitFloor(f); }),
    nav('Agents', '☺', () => $('terminals-btn').click(), agents),
    nav('Runs', '▷', () => $('routines-btn').click()),
    nav('Settings', '⚙', () => $('settings-btn').click())));
};

// Keep the heading, counts and sidebar fresh when floors or workspaces change.
const baseSwitchFloor = switchFloor;
switchFloor = function (id) { baseSwitchFloor(id); renderCounts(); };
const baseRenderTabs = renderTabs;
renderTabs = function () { baseRenderTabs(); renderCounts(); };
addEventListener('terminal-status', onStatus);
setInterval(() => { renderCounts(); if (!sidebar.classList.contains('hidden')) renderSidebar(); }, 2500);

registerCommand({ id: 'arrange-agents', label: 'Arrange agents around Maestro', run: () => arrangeAgents() });
registerCommand({ id: 'focus-maestro', label: 'Focus Maestro', run: focusMaestro });
registerCommand({ id: 'toggle-activity', label: 'Toggle activity panel', run: () => showView('activity') });

// Seed states silently (no events for what already exists), then show the panel by default on wide windows.
setTimeout(() => { eachAgent((f, n, e) => lastState.set(n.id, agentState(e).key)); renderCounts(); renderSidebar(); }, 1200);
let actPref = null;
try { actPref = localStorage.getItem('activity'); } catch {}
setActivity(actPref === null ? innerWidth >= 1280 : actPref === '1');
renderActivity();
