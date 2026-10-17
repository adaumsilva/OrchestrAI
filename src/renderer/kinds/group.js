// Groups: a titled, colored frame behind a set of nodes. Members are listed in node.data.members, so a group saves, undoes and
// imports like any other node. Moving the frame moves its members; Fit wraps the frame around them; tidy treats it as one block.
// Ctrl+G groups the selection (selecting a frame too adds to it), Ctrl+Shift+G ungroups.
const GROUP_COLORS = { gray: '#8e8e93', blue: '#0a84ff', green: '#30d158', yellow: '#ffd60a', orange: '#ff9f0a', red: '#ff453a', purple: '#bf5af2' };
const GROUP_PAD = 28, GROUP_HEAD = 38;

const membersOf = (f, g) => (g.data.members || []).map((id) => f.nodes.find((n) => n.id === id)).filter(Boolean);
const groupOf = (f, nodeId) => f.nodes.find((g) => g.kind === 'group' && (g.data.members || []).includes(nodeId));

function fitGroup(f, g) {
  const ms = membersOf(f, g);
  if (!ms.length) return;
  g.x = Math.min(...ms.map((n) => n.x)) - GROUP_PAD;
  g.y = Math.min(...ms.map((n) => n.y)) - GROUP_PAD - GROUP_HEAD;
  g.w = Math.max(...ms.map((n) => n.x + n.w)) - g.x + GROUP_PAD;
  g.h = Math.max(...ms.map((n) => n.y + n.h)) - g.y + GROUP_PAD;
  const entry = rt.get(f.id)?.live.get(g.id);
  if (entry) place(g, entry.el);
  drawRopes(f);
}

function moveGroupMembers(f, g, dx, dy) {
  for (const n of membersOf(f, g)) {
    n.x += dx; n.y += dy;
    const e = rt.get(f.id)?.live.get(n.id);
    if (e) place(n, e.el);
  }
}

// Replace members by their frame (deduplicated) so groups are laid out as single blocks.
function tidyUnits(f, picked) {
  const out = new Map();
  for (const n of picked) {
    const g = n.kind === 'group' ? n : groupOf(f, n.id);
    if (g) { fitGroup(f, g); out.set(g.id, g); } else out.set(n.id, n);
  }
  return [...out.values()];
}

function groupSelection() {
  const f = activeFloor();
  if (!f) return null;
  const picked = f.nodes.filter((n) => selection.has(n.id));
  const frame = picked.find((n) => n.kind === 'group');
  const ids = picked.filter((n) => n.kind !== 'group').map((n) => n.id);
  if (!ids.length) { hint('Select the nodes to group first'); setTimeout(() => hint(''), 2200); return null; }
  for (const g of f.nodes) if (g.kind === 'group' && g !== frame) g.data.members = (g.data.members || []).filter((id) => !ids.includes(id)); // one group per node
  let g = frame;
  if (g) g.data.members = [...new Set([...(g.data.members || []), ...ids])];
  else g = addNode('group', { title: 'Group', data: { members: ids, color: 'blue' } }, f);
  fitGroup(f, g);
  setSelection(f, [g.id]);
  save();
  return g;
}

function ungroupSelection() {
  const f = activeFloor();
  if (!f) return 0;
  const frames = new Set();
  for (const n of f.nodes) {
    if (!selection.has(n.id)) continue;
    if (n.kind === 'group') frames.add(n); else { const g = groupOf(f, n.id); if (g) frames.add(g); }
  }
  const members = [...frames].flatMap((g) => membersOf(f, g).map((n) => n.id));
  frames.forEach((g) => removeNode(f, g.id, true));
  setSelection(f, members);
  wakeRopes(); save();
  return frames.size;
}

NodeKinds.group = {
  label: 'Group', w: 420, h: 300,
  mount({ node, floor, el, entry, addButton, save }) {
    const d = node.data;
    d.members ||= [];
    el.classList.add('group-node');
    const tint = () => el.style.setProperty('--group', GROUP_COLORS[d.color] || GROUP_COLORS.gray);
    tint();
    addButton('⤢', 'Fit the frame around its nodes', () => { fitGroup(floor, node); save(); });
    addButton('🎨', 'Group color', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      popupMenu(r.left, r.bottom, Object.keys(GROUP_COLORS).map((c) => ({ label: (d.color || 'gray') === c ? `✓ ${c}` : c, onClick: () => { d.color = c; tint(); save(); } })));
    });
    addButton('⊟', 'Ungroup (keeps the nodes)', () => { setSelection(floor, [node.id]); ungroupSelection(); });
    entry.api.members = () => membersOf(floor, node);
  },
};

addEventListener('keydown', (e) => {
  const grouping = shortcutMatch(e, 'group'), ungrouping = shortcutMatch(e, 'ungroup');
  if (!grouping && !ungrouping) return;
  if (isTyping(e.target) || modalOpen()) return;
  e.preventDefault();
  if (ungrouping) ungroupSelection(); else groupSelection();
});

registerCommand({ id: 'group', label: 'Group selection', hint: 'Ctrl+G', run: () => groupSelection() });
registerCommand({ id: 'ungroup', label: 'Ungroup selection', hint: 'Ctrl+Shift+G', run: () => ungroupSelection() });
