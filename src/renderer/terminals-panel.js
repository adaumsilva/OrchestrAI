// Terminals overview: every terminal on every floor with its status, role and attention flag. Click to jump.
// terminal.js fires a 'terminal-status' event whenever a status or attention flag changes; the panel and the
// toolbar/tray badge refresh from it.

const terminalsBtn = document.getElementById('terminals-btn');
const terminalsBadge = h('span', { class: 'badge hidden' });
terminalsBtn.append(terminalsBadge);
const terminalsList = h('div', { class: 'tp-list' });
const terminalsPanel = h('div', { id: 'terminals-panel', class: 'hidden' },
  h('div', { class: 'tp-head' }, h('strong', {}, 'Terminals'), h('button', { title: 'Close (L)', onclick: () => toggleTerminalsPanel(false) }, '✕')),
  terminalsList);
document.body.append(terminalsPanel);

const STATUS_TEXT = { restored: 'Restored', idle: 'Idle', starting: 'Starting', running: 'Running', exited: 'Exited', error: 'Error' };

function terminalRows() {
  const rows = [];
  for (const f of state.floors) {
    for (const n of f.nodes) {
      if (n.kind !== 'terminal') continue;
      const entry = rt.get(f.id)?.live.get(n.id);
      rows.push({ f, n, status: entry?.api.status?.() || 'starting', attention: !!entry?.el.classList.contains('attention') });
    }
  }
  return rows;
}

function jumpToNode(f, node) {
  if (f.id !== state.active) switchFloor(f.id);
  const entry = rt.get(f.id)?.live.get(node.id);
  if (!entry) return;
  setSelection(f, [node.id]);
  entry.el.style.zIndex = ++zTop;
  centerOn(f, node);
  entry.api.focus?.();
}

let attentionSent = -1;
function renderTerminalsPanel() {
  const rows = terminalRows();
  const attention = rows.filter((r) => r.attention).length;
  terminalsBadge.textContent = String(attention);
  terminalsBadge.classList.toggle('hidden', !attention);
  if (attention !== attentionSent) { attentionSent = attention; call('app:attentionCount', attention); }
  if (terminalsPanel.classList.contains('hidden')) return;
  // Terminals that need attention first, then by floor order.
  const ordered = [...rows].sort((a, b) => Number(b.attention) - Number(a.attention));
  terminalsList.replaceChildren(...(ordered.length ? ordered.map(({ f, n, status, attention: att }) => {
    const role = n.data.roleId && roleById(n.data.roleId)?.name;
    return h('div', { class: 'tp-row' + (att ? ' attention' : '') + (selection.has(n.id) && f.id === state.active ? ' sel' : ''), onclick: () => jumpToNode(f, n) },
      h('span', { class: 'status-dot', 'data-status': status, title: STATUS_TEXT[status] || status }),
      h('div', { class: 'tp-main' },
        h('div', { class: 'tp-title' }, (n.data.icon ? n.data.icon + ' ' : '') + n.title),
        h('div', { class: 'tp-sub' }, [f.name, role, att ? 'needs attention' : STATUS_TEXT[status]].filter(Boolean).join(' · '))));
  }) : [h('div', { class: 'muted', style: 'padding:10px' }, 'No terminals yet. Use + Add > Terminal.')]));
}

let panelFrame = 0;
const refreshTerminalsPanel = () => { cancelAnimationFrame(panelFrame); panelFrame = requestAnimationFrame(renderTerminalsPanel); };

function toggleTerminalsPanel(force) {
  terminalsPanel.classList.toggle('hidden', force === undefined ? !terminalsPanel.classList.contains('hidden') : !force);
  terminalsBtn.classList.toggle('active', !terminalsPanel.classList.contains('hidden'));
  renderTerminalsPanel();
}

addEventListener('terminal-status', refreshTerminalsPanel);
terminalsBtn.onclick = () => toggleTerminalsPanel();
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'l' || e.ctrlKey || e.metaKey || e.altKey || modalOpen() || isTyping(e.target)) return;
  toggleTerminalsPanel();
});
// Nodes are added, renamed and removed without a status event; poll cheaply while the panel is open.
setInterval(() => { if (!terminalsPanel.classList.contains('hidden')) renderTerminalsPanel(); }, 2000);
setTimeout(renderTerminalsPanel, 1500);
