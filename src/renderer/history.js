// Undo / redo for the canvas: nodes (position, size, title, data) and ropes, per floor.
// Every save() schedules a debounced snapshot; consecutive changes within a moment become one undo step.
// Terminals cannot be resurrected mid-process: undoing a close starts a fresh shell in the same place.
const HISTORY_LIMIT = 60;
const histories = new Map(); // floor id -> { undo: string[], redo: string[], prev: string }
let restoring = false;
let historyTimer = null;

function snapshotOf(f) {
  return JSON.stringify({
    nodes: f.nodes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h), data: n.data })),
    ropes: f.ropes,
  });
}

function historyBaseline(f) {
  if (f && !histories.has(f.id)) histories.set(f.id, { undo: [], redo: [], prev: snapshotOf(f) });
  updateHistoryButtons();
}

function onStateChanged() {
  if (restoring) return;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(flushHistory, 500);
}

function flushHistory() {
  clearTimeout(historyTimer);
  const f = activeFloor();
  if (!f) return;
  const hist = histories.get(f.id);
  if (!hist) { historyBaseline(f); return; }
  const cur = snapshotOf(f);
  if (cur === hist.prev) return;
  hist.undo.push(hist.prev);
  if (hist.undo.length > HISTORY_LIMIT) hist.undo.shift();
  hist.redo = [];
  hist.prev = cur;
  updateHistoryButtons();
}

function unmountNode(f, id) {
  const R = rt.get(f.id), entry = R.live.get(id);
  try { entry?.dispose?.(); } catch {}
  entry?.el.remove();
  R.live.delete(id);
}

function applySnapshot(f, snap) {
  restoring = true;
  try {
    const R = rt.get(f.id);
    const wanted = new Set(snap.nodes.map((n) => n.id));
    for (const n of [...f.nodes]) if (!wanted.has(n.id)) { unmountNode(f, n.id); f.nodes = f.nodes.filter((x) => x.id !== n.id); }
    for (const s of snap.nodes) {
      const existing = f.nodes.find((n) => n.id === s.id);
      if (!existing) {
        const node = JSON.parse(JSON.stringify(s));
        f.nodes.push(node);
        mountNode(f, node);
        continue;
      }
      const dataChanged = JSON.stringify(existing.data) !== JSON.stringify(s.data);
      Object.assign(existing, { title: s.title, x: s.x, y: s.y, w: s.w, h: s.h });
      if (dataChanged) {
        // Re-mount so the node's UI reflects the restored data (note text, drawing strokes, chat history...).
        existing.data = JSON.parse(JSON.stringify(s.data));
        unmountNode(f, existing.id);
        mountNode(f, existing);
      } else {
        const entry = R.live.get(existing.id);
        entry.el.querySelector('.title').textContent = existing.title;
        place(existing, entry.el);
      }
    }
    f.ropes = JSON.parse(JSON.stringify(snap.ropes));
    if (typeof reconcileCrossRopes === 'function') reconcileCrossRopes(f);
    setSelection(f, []);
    wakeRopes();
    glide?.(f, 300);
    call('workspace:save', state);
  } finally {
    restoring = false;
  }
}

function stepHistory(direction) {
  flushHistory();
  const f = activeFloor();
  const hist = f && histories.get(f.id);
  if (!hist) return;
  const from = direction < 0 ? hist.undo : hist.redo;
  const to = direction < 0 ? hist.redo : hist.undo;
  if (!from.length) { hint(direction < 0 ? 'Nothing to undo' : 'Nothing to redo'); setTimeout(() => hint(''), 1500); return; }
  to.push(snapshotOf(f));
  applySnapshot(f, JSON.parse(from.pop()));
  hist.prev = snapshotOf(f);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const f = activeFloor();
  const hist = f && histories.get(f.id);
  const u = document.getElementById('undo-btn'), r = document.getElementById('redo-btn');
  if (u) u.disabled = !hist || !hist.undo.length;
  if (r) r.disabled = !hist || !hist.redo.length;
}

document.getElementById('undo-btn').onclick = () => stepHistory(-1);
document.getElementById('redo-btn').onclick = () => stepHistory(1);
addEventListener('keydown', (e) => {
  if (isTyping(e.target) || document.getElementById('modal-root').firstChild) return;
  if (shortcutMatch(e, 'undo')) { e.preventDefault(); stepHistory(-1); }
  else if (shortcutMatch(e, 'redo')) { e.preventDefault(); stepHistory(1); }
});
updateHistoryButtons();
