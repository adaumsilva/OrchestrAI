// Cross-floor connections. A rope between nodes on different floors is stored on BOTH floors with the same id:
//   on the floor of node X:  { id, a: X, b: Y, rf: <floor of Y> }
//   on the floor of node Y:  { id, a: Y, b: X, rf: <floor of X> }
// (a is always the local node, b the remote one). Each floor draws a stub next to its end that names the far node and jumps to it.

const remoteRopes = (f) => f.ropes.filter((r) => r.rf);

function nodeOnFloor(floorId, nodeId) {
  const g = allFloors().find((x) => x.id === floorId);
  const n = g?.nodes.find((x) => x.id === nodeId);
  return n ? { floor: g, node: n } : null;
}

function connectAcross(f, node, target) {
  if (!target || target.floor.id === f.id) return false;
  if (f.ropes.some((r) => r.rf === target.floor.id && r.a === node.id && r.b === target.node.id)) return false;
  const id = uid();
  f.ropes.push({ id, a: node.id, b: target.node.id, rf: target.floor.id });
  target.floor.ropes.push({ id, a: target.node.id, b: node.id, rf: f.id });
  save();
  wakeRopes();
  return true;
}

// Make every other floor agree with `f` (the floor that was just changed, e.g. by undo): add or fix the mirror of each
// cross-floor rope on f, and drop mirrors whose rope no longer exists on f.
function reconcileCrossRopes(f) {
  for (const r of remoteRopes(f)) {
    const far = nodeOnFloor(r.rf, r.b);
    if (!far) { f.ropes = f.ropes.filter((x) => x !== r); continue; }
    const mirror = far.floor.ropes.find((x) => x.id === r.id);
    if (mirror) Object.assign(mirror, { a: r.b, b: r.a, rf: f.id });
    else far.floor.ropes.push({ id: r.id, a: r.b, b: r.a, rf: f.id });
  }
  for (const g of allFloors()) {
    if (g === f) continue;
    g.ropes = g.ropes.filter((r) => !(r.rf === f.id && !f.ropes.some((x) => x.id === r.id)));
  }
  wakeRopes();
}

// A node is going away: remove the mirrored ends of its cross-floor ropes elsewhere.
function dropRemoteRopesTo(floorId, nodeId) {
  for (const g of allFloors()) {
    if (g.id === floorId) continue;
    g.ropes = g.ropes.filter((r) => !(r.rf === floorId && r.b === nodeId));
  }
}

function removeRopeEverywhere(id) {
  for (const g of allFloors()) g.ropes = g.ropes.filter((r) => r.id !== id);
}

// ---------- stubs ----------
const stubs = new Map(); // rope id -> element

function drawStubs(f) {
  const R = rt.get(f.id);
  if (!R) return;
  const seen = new Set();
  const perNode = new Map();
  for (const r of remoteRopes(f)) {
    const local = f.nodes.find((n) => n.id === r.a);
    const far = nodeOnFloor(r.rf, r.b);
    if (!local || !far) { removeRopeEverywhere(r.id); continue; } // stale end
    seen.add(r.id);
    const idx = perNode.get(local.id) || 0;
    perNode.set(local.id, idx + 1);
    let el = stubs.get(r.id);
    if (!el) {
      el = h('div', { class: 'rope-stub', 'data-rope': r.id },
        h('span', { class: 'stub-label' }),
        h('button', { class: 'stub-x', title: 'Remove this connection', onclick: (e) => { e.stopPropagation(); removeRopeEverywhere(r.id); save(); wakeRopes(); } }, '✕'));
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      el.firstChild.addEventListener('click', () => { const t = nodeOnFloor(el.dataset.floor, el.dataset.node); if (t) jumpToNode(t.floor, t.node); });
      stubs.set(r.id, el);
    }
    if (el.parentNode !== R.nodesEl) R.nodesEl.append(el);
    el.dataset.floor = r.rf; el.dataset.node = r.b;
    const label = `⇢ ${far.node.title} · ${far.floor.name}`;
    if (el.firstChild.textContent !== label) el.firstChild.textContent = label;
    el.firstChild.title = `Go to ${far.node.title} on ${far.floor.name}`;
    el.style.left = (local.x + local.w + 18) + 'px';
    el.style.top = (local.y + local.h / 2 - 12 + idx * 28) + 'px';
    el.classList.toggle('active', performance.now() < (el._flash || 0));
  }
  for (const [id, el] of stubs) {
    if (el.parentNode === R.nodesEl && !seen.has(id)) { el.remove(); stubs.delete(id); }
  }
}

function flashStub(ropeId) {
  const el = stubs.get(ropeId);
  if (!el) return;
  el._flash = performance.now() + 900;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 950);
}

registerCommand({
  id: 'connect-across', label: 'Connect selected node to a node on another floor…',
  run: async () => {
    const f = activeFloor(), n = selectedNode(f);
    if (!n) { hint('Select a node first'); setTimeout(() => hint(''), 2200); return; }
    const picked = await pickNode({ exclude: f.nodes.map((x) => x.id), placeholder: 'Connect to which node?' });
    if (picked) connectAcross(f, n, picked);
  },
});
