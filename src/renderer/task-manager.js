// Task Manager: a live table of every terminal with what it is running right now, CPU, memory and time.
// The main process samples each pty's process tree (`pty:stats`); we only ask while the panel is open.

const TM_INTERVAL = 2000;
const TM_HISTORY = 30; // samples kept for the sparklines
const TM_HOT_CPU_CORE = 80; // percent of one core (stats are percent of the whole machine)
const TM_HOT_MEM = 1024 ** 3;
const TM_QUIET_MS = 5 * 60 * 1000;

const tmBtn = document.getElementById('taskmgr-btn');
const tmBody = h('tbody', {});
const tmFoot = h('div', { class: 'tm-foot muted' });
const tmCols = [
  ['name', 'Terminal'], ['status', 'Status'], ['task', 'Current task'], ['cpu', 'CPU'], ['mem', 'Memory'], ['tokens', 'Tokens'], ['limit', 'Limit'], ['up', 'Uptime'], ['since', 'In state'], ['busy', 'Busy'],
];
let tmSort = { key: 'cpu', dir: -1 };
const tmHead = h('tr', {}, ...tmCols.map(([key, label]) => h('th', { 'data-key': key, onclick: () => {
  tmSort = { key, dir: tmSort.key === key ? -tmSort.dir : (key === 'name' || key === 'task' || key === 'status' ? 1 : -1) };
  renderTaskManager();
} }, label)), h('th', {}));
const tmPanel = h('div', { id: 'taskmgr-panel', class: 'hidden' },
  h('div', { class: 'tp-head' }, h('strong', {}, 'Task manager'), h('button', { title: 'Close (K)', onclick: () => toggleTaskManager(false) }, '✕')),
  h('div', { class: 'tm-scroll' }, h('table', { class: 'tm-table' }, h('thead', {}, tmHead), tmBody)),
  tmFoot);
document.body.append(tmPanel);

let tmStats = { procs: {}, cores: 1 };
let tmStatsError = '';
const tmTrack = new Map(); // node id -> { status, since, busyMs, busyFrom, cpu: [], mem: [] }
// Agent usage is read per provider (the CLI's account), not per terminal: a terminal running that agent shows the provider's figures.
function tmProvider(n, fg) {
  const first = (n.data.command || '').trim().split(/\s+/)[0].split(/[\/]/).pop().replace(/\.(cmd|exe|bat)$/i, '');
  const hay = fg ? `${fg.name} ${fg.cmd}`.toLowerCase() : '';
  const words = hay.split(/[\s\/]+/).map((x) => x.replace(/\.(cmd|exe|js)$/, ''));
  return usageData.find((pr) => pr.command && (pr.command === first || words.some((x) => x === pr.command || x.startsWith(pr.command + '-'))));
}
const tmWinName = (w) => (w.minutes >= 1440 && w.minutes % 1440 === 0 ? `${w.minutes / 1440}d` : w.minutes % 60 === 0 ? `${w.minutes / 60}h` : `${w.minutes}m`);
function tmUsageTip(pr) {
  const lines = (pr.windows || []).map((w) => `${w.label}: ${fmtTokens(sumTokens(w.tokens))} tokens` + (w.percent != null ? ` · ${w.percent}% of limit` + (w.resetsAt ? `, resets ${fmtWhen(w.resetsAt)}` : '') : ''));
  return lines.join('\n') + `\n(${pr.name} usage is account-wide, summed from its local session logs)`;
}
const tmOpen = () => !tmPanel.classList.contains('hidden');

const fmtBytes = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB' : n >= 1024 ** 2 ? Math.round(n / 1024 ** 2) + ' MB' : Math.round(n / 1024) + ' KB');
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d) return `${d}d ${hh}h`;
  if (hh) return `${hh}h ${String(mm).padStart(2, '0')}m`;
  if (mm) return `${mm}m ${String(ss).padStart(2, '0')}s`;
  return `${ss}s`;
}

function tmSpark(values, max) {
  if (values.length < 2) return null;
  const w = 56, hgt = 16, top = Math.max(max, 1);
  const pts = values.map((v, i) => `${((i / (TM_HISTORY - 1)) * w).toFixed(1)},${(hgt - 1 - Math.min(v / top, 1) * (hgt - 2)).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tm-spark'); svg.setAttribute('width', w); svg.setAttribute('height', hgt); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', pts); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.4');
  svg.append(line);
  return svg;
}

// Folds the latest status and sample of one terminal into its tracked history.
function tmUpdateTrack(n, status, st, now) {
  let t = tmTrack.get(n.id);
  if (!t) { t = { status, since: now, busyMs: 0, busyFrom: status === 'running' ? now : 0, cpu: [], mem: [] }; tmTrack.set(n.id, t); }
  if (t.status !== status) {
    if (t.status === 'running' && t.busyFrom) { t.busyMs += now - t.busyFrom; t.busyFrom = 0; }
    if (status === 'running') t.busyFrom = now;
    t.status = status; t.since = now;
  }
  return t;
}

function taskRows() {
  const now = Date.now();
  const rows = [];
  for (const f of allFloors()) {
    for (const n of f.nodes) {
      if (n.kind !== 'terminal') continue;
      const entry = rt.get(f.id)?.live.get(n.id);
      const status = entry?.api.status?.() || 'starting';
      const st = tmStats.procs[n.id];
      const t = tmUpdateTrack(n, status, st, now);
      const alive = st && !st.gone;
      const fg = alive ? st.fg : null;
      const ownTask = alive && fg.pid !== st.pid; // something other than the shell itself is running
      const prov = alive || n.data.command ? tmProvider(n, fg) : null;
      const win = prov && !prov.error ? prov.windows?.[0] : null;
      const pcts = (prov?.windows || []).map((w) => w.percent).filter((x) => x != null);
      const lastOut = entry?.api.lastOutput?.() || 0;
      rows.push({
        f, n, entry, status, st, t, alive, fg, ownTask,
        prov, win, pct: pcts.length ? Math.max(...pcts) : -1, tokens: win ? sumTokens(win.tokens) : -1,
        task: alive ? (ownTask ? fg.name : 'idle shell') : '—',
        cpu: alive ? st.cpu : -1, mem: alive ? st.mem : -1,
        up: alive && st.startedAt ? now - st.startedAt : -1, since: now - t.since,
        busy: t.busyMs + (t.busyFrom ? now - t.busyFrom : 0),
        stuck: alive && ownTask && status !== 'exited' && lastOut && now - lastOut > TM_QUIET_MS,
        hot: alive && (st.cpu * tmStats.cores >= TM_HOT_CPU_CORE || st.mem >= TM_HOT_MEM),
      });
    }
  }
  const { key, dir } = tmSort;
  const val = (r) => (key === 'name' ? r.n.title.toLowerCase() : key === 'status' ? r.status : key === 'task' ? r.task.toLowerCase() : r[key]);
  rows.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * dir);
  return rows;
}

function renderTaskManager() {
  if (!tmOpen()) return;
  for (const th of tmHead.children) th.classList.toggle('sorted', th.dataset.key === tmSort.key), th.dataset.dir = th.dataset.key === tmSort.key ? (tmSort.dir > 0 ? '▲' : '▼') : '';
  const rows = taskRows();
  tmBody.replaceChildren(...(rows.length ? rows.map((r) => {
    const { f, n, t, st } = r;
    const act = (title, label, fn) => h('button', { class: 'tm-act', title, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    return h('tr', { class: 'tm-row' + (r.hot ? ' hot' : '') + (r.stuck ? ' stuck' : ''), 'data-id': n.id, onclick: () => jumpToNode(f, n) },
      h('td', { class: 'tm-name', title: `${n.title} (${f.name})` }, h('span', { class: 'status-dot', 'data-status': r.status }), h('b', {}, n.title), h('span', { class: 'muted' }, ` ${f.name}`)),
      h('td', {}, STATUS_TEXT[r.status] || r.status),
      h('td', { class: 'tm-task', title: r.alive ? `${r.fg.cmd || r.fg.name} (pid ${r.fg.pid})${r.stuck ? ' — no output for 5+ minutes' : ''}` : '' },
        r.alive ? [r.task, r.st.count > 1 ? h('span', { class: 'muted' }, ` · ${r.st.count} procs`) : null, r.stuck ? h('span', { class: 'tm-flag' }, ' quiet') : null] : '—'),
      h('td', { class: 'tm-num' }, r.alive ? [`${r.cpu.toFixed(1)}%`, tmSpark(t.cpu, 100)] : '—'),
      h('td', { class: 'tm-num' }, r.alive ? [fmtBytes(r.mem), tmSpark(t.mem, Math.max(...t.mem, 1))] : '—'),
      h('td', { class: 'tm-num', title: r.prov && !r.prov.error ? tmUsageTip(r.prov) : '' }, r.win ? [fmtTokens(r.tokens), h('span', { class: 'muted' }, ` / ${tmWinName(r.win)}`)] : '—'),
      h('td', { class: 'tm-num' + (r.pct >= USAGE_WARN_PERCENT ? ' tm-warn' : ''), title: r.prov && !r.prov.error ? tmUsageTip(r.prov) : '' },
        r.pct >= 0 ? `${r.pct}%` : r.win ? h('span', { class: 'muted', title: 'This provider reports no limit; set one in its definition (Usage > Edit definitions)' }, 'no limit') : '—'),
      h('td', { class: 'tm-num' }, r.up >= 0 ? fmtDur(r.up) : '—'),
      h('td', { class: 'tm-num' }, fmtDur(r.since)),
      h('td', { class: 'tm-num' }, fmtDur(r.busy)),
      h('td', { class: 'tm-actions' },
        act('Interrupt (Ctrl+C)', '⌃C', () => r.entry?.api.interrupt?.()),
        act('End the running task (keeps the shell)', '■', async () => { await call('pty:killForeground', n.id); sampleTaskManager(); }),
        act('Restart the terminal process', '⟳', () => r.entry?.api.restart?.()),
        act('Copy pid', '#', () => st && navigator.clipboard?.writeText(String(st.pid)).catch(() => {}))));
  }) : [h('tr', {}, h('td', { colspan: tmCols.length + 1, class: 'muted', style: 'padding:10px' }, 'No terminals yet. Use + Add > Terminal.'))]));
  const live = rows.filter((r) => r.alive);
  const provs = [...new Set(rows.map((r) => r.prov).filter((x) => x && !x.error))];
  const usageNote = provs.length ? ' · ' + provs.map((pr) => `${pr.name} ${fmtTokens(sumTokens(pr.windows[0].tokens))} tokens/${tmWinName(pr.windows[0])}`).join(', ') : '';
  tmFoot.textContent = tmStatsError ? `Sampling failed: ${tmStatsError}` :
    `${rows.length} terminals · ${live.length} with a live process · CPU ${live.reduce((a, r) => a + r.cpu, 0).toFixed(1)}% of the machine (${tmStats.cores} cores) · memory ${fmtBytes(live.reduce((a, r) => a + r.mem, 0))}${usageNote}`;
}

let tmSampling = false, tmUsageAt = 0;
async function sampleTaskManager() {
  if (tmSampling || !tmOpen()) return;
  tmSampling = true;
  if (Date.now() - tmUsageAt > 30000) { tmUsageAt = Date.now(); refreshUsage().then(renderTaskManager); }
  try {
    const r = await call('pty:stats');
    tmStatsError = r.error || '';
    tmStats = { procs: r.procs || {}, cores: r.cores || 1 };
    for (const [id, st] of Object.entries(tmStats.procs)) {
      if (st.gone) continue;
      let t = tmTrack.get(id);
      if (!t) { t = { status: 'running', since: Date.now(), busyMs: 0, busyFrom: 0, cpu: [], mem: [] }; tmTrack.set(id, t); }
      t.cpu.push(st.cpu); t.mem.push(st.mem);
      if (t.cpu.length > TM_HISTORY) { t.cpu.shift(); t.mem.shift(); }
    }
  } catch (err) { tmStatsError = String(err.message || err); }
  tmSampling = false;
  renderTaskManager();
}

function toggleTaskManager(force) {
  tmPanel.classList.toggle('hidden', force === undefined ? tmOpen() : !force);
  tmBtn.classList.toggle('active', tmOpen());
  renderTaskManager();
  sampleTaskManager();
}

tmBtn.onclick = () => toggleTaskManager();
addEventListener('keydown', (e) => {
  if (!shortcutMatch(e, 'taskManager') || modalOpen() || isTyping(e.target)) return;
  toggleTaskManager();
});
addEventListener('terminal-status', () => { if (tmOpen()) renderTaskManager(); });
// Sampling runs only while the panel is open; the timer itself is a no-op otherwise.
setInterval(() => { if (tmOpen()) sampleTaskManager(); }, TM_INTERVAL);
// Forget terminals that were removed.
setInterval(() => {
  const live = new Set(allFloors().flatMap((f) => f.nodes.map((n) => n.id)));
  for (const id of tmTrack.keys()) if (!live.has(id)) tmTrack.delete(id);
}, 30000);

// ---------- per-terminal Processes popover ----------
let procPop = null;
function closeProcesses() { procPop?.close(); }
function processesPopover(node, anchor, onClose) {
  closeProcesses();
  const body = h('div', { class: 'proc-body' }, h('div', { class: 'muted' }, 'Loading…'));
  const el = h('div', { class: 'proc-pop menu' }, h('div', { class: 'proc-title' }, `Processes in ${node.title}`), body,
    h('div', { class: 'muted proc-hint' }, 'Stop ends one process and its children. Shift-click forces it.'));
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(r.left, innerWidth - 460)) + 'px';
  el.style.top = Math.min(r.bottom + 4, innerHeight - 120) + 'px';
  let timer = null, dead = false;
  const refresh = async () => {
    if (dead) return;
    let res;
    try { res = await call('pty:processes', node.id); } catch (err) { res = { error: String(err.message || err), list: [] }; }
    if (dead) return;
    if (res.gone || res.error || !res.list.length) { body.replaceChildren(h('div', { class: 'muted' }, res.error || 'No live process in this terminal.')); return; }
    body.replaceChildren(...res.list.map((p) => h('div', { class: 'proc-row', 'data-pid': p.pid },
      h('span', { class: 'proc-name', style: `padding-left:${p.depth * 12}px`, title: p.cmd || p.name }, p.name || '?'),
      h('span', { class: 'muted proc-pid' }, String(p.pid)),
      h('span', { class: 'proc-num' }, `${p.cpu.toFixed(1)}%`),
      h('span', { class: 'proc-num' }, fmtBytes(p.rss)),
      p.depth === 0 ? h('span', { class: 'muted proc-shell', title: 'The shell itself: use Restart to end it' }, 'shell')
        : h('button', { class: 'tm-act', title: 'Stop this process', onclick: async (e) => { const f = e.shiftKey; await call('pty:killPid', node.id, p.pid, f); setTimeout(refresh, 300); } }, 'Stop'))));
  };
  const close = () => { dead = true; clearInterval(timer); el.remove(); removeEventListener('mousedown', away, true); removeEventListener('keydown', esc, true); procPop = null; onClose?.(); };
  const away = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('mousedown', away, true);
  addEventListener('keydown', esc, true);
  procPop = { close };
  refresh();
  timer = setInterval(refresh, 1500);
}
