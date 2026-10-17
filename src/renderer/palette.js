// Command palette (Ctrl+K): fuzzy search over commands, nodes on every floor, floors and presets.
// Also exposes pickNode({kind, exclude}) so other features can reuse the same search to choose a target.

const PALETTE_COMMANDS = []; // { id, label, hint, run }
function registerCommand(cmd) {
  const i = PALETTE_COMMANDS.findIndex((c) => c.id === cmd.id);
  if (i >= 0) PALETTE_COMMANDS[i] = cmd; else PALETTE_COMMANDS.push(cmd);
}

const clickBtn = (id) => () => document.getElementById(id).click();
[
  { id: 'new-terminal', label: 'New terminal…', run: () => terminalDialog({ mode: 'new', floor: activeFloor() }) },
  { id: 'tidy', label: 'Tidy nodes', hint: 'T', run: () => tidy() },
  { id: 'connect', label: 'Connect selected node…', hint: 'C', run: clickBtn('link-mode') },
  { id: 'minimap', label: 'Toggle minimap', hint: 'M', run: () => toggleMinimap() },
  { id: 'terminals', label: 'Terminals overview', hint: 'L', run: () => toggleTerminalsPanel() },
  { id: 'tasks', label: 'Task manager', hint: 'K', run: clickBtn('taskmgr-btn') },
  { id: 'usage', label: 'Agent usage', run: clickBtn('usage-btn') },
  { id: 'settings', label: 'Terminal settings', run: clickBtn('settings-btn') },
  { id: 'workspace', label: 'Workspace: export, import, backups', run: clickBtn('workspace-btn') },
  { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', run: () => helpDialog() },
  { id: 'undo', label: 'Undo', hint: 'Ctrl+Z', run: clickBtn('undo-btn') },
  { id: 'redo', label: 'Redo', hint: 'Ctrl+Shift+Z', run: clickBtn('redo-btn') },
  { id: 'new-floor', label: 'New floor…', run: () => createFloorDialog() },
  { id: 'next-floor', label: 'Next floor', hint: 'Ctrl+PageDown', run: () => cycleFloor(1) },
  { id: 'prev-floor', label: 'Previous floor', hint: 'Ctrl+PageUp', run: () => cycleFloor(-1) },
  { id: 'select-all', label: 'Select all nodes', hint: 'Ctrl+A', run: () => selectAll() },
  { id: 'fit', label: 'Fit floor to view', run: () => fitFloor(activeFloor()) },
].forEach(registerCommand);

// Score a query against text: exact > prefix > word prefix > substring > subsequence. 0 = no match.
function fuzzyScore(query, text) {
  const q = query.toLowerCase().trim(), t = String(text).toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const wi = t.search(new RegExp('[\\s/\\-_.:]' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  if (wi >= 0) return 600 - wi;
  const si = t.indexOf(q);
  if (si >= 0) return 400 - si;
  let ti = 0, gaps = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return 0;
    gaps += at - ti;
    ti = at + 1;
  }
  return Math.max(1, 200 - gaps);
}

const paletteRecent = (() => { try { return JSON.parse(localStorage.getItem('palette-recent') || '[]'); } catch { return []; } })();
function rememberRecent(key) {
  const i = paletteRecent.indexOf(key);
  if (i >= 0) paletteRecent.splice(i, 1);
  paletteRecent.unshift(key);
  paletteRecent.length = Math.min(paletteRecent.length, 12);
  try { localStorage.setItem('palette-recent', JSON.stringify(paletteRecent)); } catch {}
}

function nodeItems({ kind, exclude } = {}) {
  const items = [];
  for (const f of allFloors()) {
    for (const n of f.nodes) {
      if (kind && n.kind !== kind) continue;
      if (exclude && exclude.includes(n.id)) continue;
      items.push({
        key: 'node:' + n.id, group: 'Nodes', icon: KIND_ICONS[n.kind] || '□', label: n.title || NodeKinds[n.kind]?.label || n.kind,
        sub: `${NodeKinds[n.kind]?.label || n.kind} · ${state.workspaces.length > 1 ? wsOfFloor(f.id).name + ' / ' : ''}${f.name}`, node: n, floor: f,
        run: () => jumpToNode(f, n),
      });
    }
  }
  return items;
}

function paletteItems() {
  const items = [];
  for (const c of PALETTE_COMMANDS) items.push({ key: 'cmd:' + c.id, group: 'Commands', icon: '›', label: c.label, hint: c.hint, run: c.run });
  for (const [kind, k] of Object.entries(NodeKinds)) {
    if (kind === 'terminal') continue;
    items.push({ key: 'add:' + kind, group: 'Commands', icon: KIND_ICONS[kind] || '+', label: `Add ${k.label.toLowerCase()}`, run: () => addNode(kind) });
  }
  for (const p of state.settings?.presets || []) {
    if (!p.command) continue;
    items.push({ key: 'preset:' + p.id, group: 'Presets', icon: p.icon || '❯_', label: `New terminal: ${p.name}`, sub: p.command, run: () => addNode('terminal', { title: p.name, data: { command: p.command, icon: p.icon } }) });
  }
  for (const f of allFloors()) items.push({ key: 'floor:' + f.id, group: 'Floors', icon: '▭', label: `Floor: ${f.name}`, sub: f.id === state.active ? 'current' : `${state.workspaces.length > 1 ? wsOfFloor(f.id).name + ' · ' : ''}${f.nodes.length} nodes`, run: () => switchFloor(f.id) });
  items.push(...nodeItems());
  return items;
}

let paletteEl = null;
// openPalette({items, placeholder}) resolves with the chosen item (after running it unless noRun) or null.
function openPalette({ items = paletteItems(), placeholder = 'Search commands, terminals, notes…', noRun = false, recent = true } = {}) {
  if (paletteEl) closePalette(null);
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const input = h('input', { class: 'pal-input', placeholder, spellcheck: 'false' });
    const list = h('div', { class: 'pal-list' });
    const box = h('div', { class: 'pal-box' }, input, list);
    const root = h('div', { id: 'palette', onmousedown: (e) => { if (e.target === root) closePalette(null); } }, box);
    let shown = [], sel = 0;
    const render = () => {
      const q = input.value;
      const scored = items.map((it) => {
        const s = Math.max(fuzzyScore(q, it.label), it.sub ? fuzzyScore(q, it.sub) * 0.5 : 0);
        const r = recent ? paletteRecent.indexOf(it.key) : -1;
        return { it, s: q.trim() ? s : (r >= 0 ? 100 - r : 1) };
      }).filter((x) => x.s > 0);
      scored.sort((a, b) => b.s - a.s);
      shown = scored.slice(0, 60).map((x) => x.it);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.replaceChildren(...(shown.length ? shown.map((it, i) => h('div', {
        class: 'pal-row' + (i === sel ? ' sel' : ''), 'data-key': it.key,
        onmousemove: () => { if (sel !== i) { sel = i; mark(); } },
        onclick: () => choose(it),
      }, h('span', { class: 'pal-ico' }, it.icon || ''), h('span', { class: 'pal-label' }, it.label), it.sub ? h('span', { class: 'pal-sub' }, it.sub) : null,
        it.hint ? h('kbd', {}, it.hint) : h('span', { class: 'pal-group' }, it.group || ''))) : [h('div', { class: 'pal-empty' }, 'No matches')]));
    };
    const mark = () => { [...list.children].forEach((c, i) => c.classList.toggle('sel', i === sel)); list.children[sel]?.scrollIntoView({ block: 'nearest' }); };
    function choose(it) { closePalette(it); if (!noRun) { rememberRecent(it.key); it.run?.(); } }
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) choose(shown[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(null); }
    });
    paletteEl = { root, resolve, prevFocus };
    document.body.append(root);
    render();
    input.focus();
  });
}

function closePalette(result) {
  if (!paletteEl) return;
  const { root, resolve, prevFocus } = paletteEl;
  paletteEl = null;
  root.remove();
  try { prevFocus?.focus?.(); } catch {}
  resolve(result);
}

// pickNode({kind?, exclude?, placeholder?}) -> Promise<{floor, node} | null>. Does not jump or select.
async function pickNode(opts = {}) {
  const it = await openPalette({ items: nodeItems(opts), placeholder: opts.placeholder || 'Choose a node…', noRun: true, recent: false });
  return it ? { floor: it.floor, node: it.node } : null;
}

addEventListener('keydown', (e) => {
  const isOpen = (e.ctrlKey || e.metaKey) && !e.altKey && ((e.key.toLowerCase() === 'k' && !e.shiftKey) || (e.shiftKey && e.key.toLowerCase() === 'p'));
  if (!isOpen) return;
  if (modalOpen() && !paletteEl) return;
  e.preventDefault();
  if (paletteEl) closePalette(null); else openPalette();
}, true);

document.getElementById('palette-btn')?.addEventListener('click', () => openPalette());
