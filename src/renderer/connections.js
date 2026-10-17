// Connections panel: every rope in one list (all floors, or only those of one node), with show, tie, remove and remove all.
// Also the rope routing switch (hanging cables or right-angle circuit traces).

function setRopeRouting(mode) {
  state.settings.ropeRouting = mode === 'circuit' ? 'circuit' : 'cable';
  save();
  for (const sim of sims.values()) sim.dom?.g.remove(), sim.dom = null; // redraw every rope from scratch
  wakeRopes();
}

function nodeAnywhere(id) {
  for (const f of allFloors()) { const n = f.nodes.find((x) => x.id === id); if (n) return { floor: f, node: n }; }
  return null;
}

// Ropes in scope as { floor, rope, a, b }; scope.nodeId limits to one node's ropes, scope.floor to one floor.
function listConnections(scope = {}) {
  const out = [];
  for (const f of allFloors()) {
    if (scope.floor && f.id !== scope.floor.id) continue;
    for (const rope of f.ropes) {
      if (scope.nodeId && rope.a !== scope.nodeId && rope.b !== scope.nodeId) continue;
      const a = nodeAnywhere(rope.a), b = nodeAnywhere(rope.b);
      out.push({ floor: f, rope, a, b });
    }
  }
  return out;
}

function connectionsDialog(scope = {}) {
  const render = () => {
    const items = listConnections(scope);
    const label = (x) => (x ? x.node.title || x.node.kind : '(missing)');
    const rows = items.map(({ floor, rope, a, b }) => h('div', { class: 'conn-row' },
      h('div', { class: 'routine-main' },
        h('div', {}, h('b', {}, label(a)), ' ⟷ ', h('b', {}, label(b)), rope.pin ? h('span', { class: 'pr-badge', style: 'margin-left:6px', title: 'Tied to the canvas' }, 'tied') : null),
        h('div', { class: 'muted' }, [floor.name, rope.rf ? 'crosses floors' : ''].filter(Boolean).join(' · '))),
      h('div', { class: 'row' },
        h('button', {
          title: 'Go to this connection', onclick: () => {
            closeModal();
            if (floor.id !== state.active) switchFloor(floor.id);
            setSelection(floor, [rope.a, rope.b].filter((id) => floor.nodes.some((n) => n.id === id)));
          },
        }, 'Show'),
        rope.rf ? null : h('button', {
          title: rope.pin ? 'Release the tie' : 'Hold the middle of this connection where it is',
          onclick: () => {
            const sim = sims.get(rope.id);
            const mid = sim?.circuit ? polylineMid(sim.circuit) : sim?.pts[Math.floor(sim.pts.length / 2)];
            setRopePin(floor, rope, rope.pin ? null : (mid || { x: 0, y: 0 }));
            render();
          },
        }, rope.pin ? 'Untie' : 'Tie'),
        h('button', { class: 'danger', onclick: () => { removeRope(floor, rope.id); render(); } }, 'Remove'))));
    const title = scope.nodeId ? `Connections of ${label(nodeAnywhere(scope.nodeId))}` : scope.floor ? `Connections on ${scope.floor.name}` : 'All connections';
    modal({
      title,
      content: h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:520px;max-height:60vh;overflow:auto' },
        h('div', { class: 'row' },
          h('span', { class: 'muted' }, 'Routing'),
          h('select', { onchange: (e) => setRopeRouting(e.target.value) },
            h('option', { value: 'cable', selected: ropeRouting() === 'cable' }, 'Hanging cables'),
            h('option', { value: 'circuit', selected: ropeRouting() === 'circuit' }, 'Circuit traces'))),
        rows.length ? rows : h('div', { class: 'muted' }, 'No connections.')),
      actions: [
        { label: 'Close', onClick: (c) => c() },
        ...(items.length ? [{
          label: `Remove all (${items.length})`, onClick: async () => {
            if (!(await confirmModal('Remove connections', `Remove ${items.length} connection${items.length === 1 ? '' : 's'}?`, 'Remove all'))) { render(); return; }
            for (const { floor, rope } of items) removeRope(floor, rope.id);
            render();
          },
        }] : []),
      ],
    });
  };
  render();
}

registerCommand({ id: 'connections', label: 'Manage connections…', run: () => connectionsDialog({}) });
registerCommand({ id: 'connections-floor', label: 'Connections on this floor…', run: () => connectionsDialog({ floor: activeFloor() }) });
registerCommand({ id: 'rope-routing', label: 'Toggle rope routing (cables / circuit)', run: () => setRopeRouting(ropeRouting() === 'circuit' ? 'cable' : 'circuit') });
