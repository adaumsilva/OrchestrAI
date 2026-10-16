// Renderer side of the Maestro bridge: executes `orchestrai` CLI requests against the canvas.
// Only terminals with Maestro enabled are given the token, and the caller is re-checked here.

function allTerminals() {
  const out = [];
  for (const floor of state.floors) {
    for (const node of floor.nodes) {
      if (node.kind === 'terminal') out.push({ floor, node, entry: rt.get(floor.id)?.live.get(node.id) });
    }
  }
  return out;
}

function findTerminal(ref) {
  const all = allTerminals();
  const q = String(ref || '').trim();
  const byId = all.find((t) => t.node.id === q);
  if (byId) return byId;
  const named = all.filter((t) => t.node.title.toLowerCase() === q.toLowerCase());
  if (named.length === 1) return named[0];
  if (named.length > 1) throw new Error(`"${q}" matches ${named.length} terminals; use an id: ${named.map((t) => t.node.id).join(', ')}`);
  throw new Error(`No terminal "${q}". Run "orchestrai list".`);
}

const roleSummary = (r) => r.instructions.replace(/\s+/g, ' ').slice(0, 80);

async function bridgeHandle(method, p, from) {
  const caller = allTerminals().find((t) => t.node.id === from);
  if (!caller || !caller.node.data.maestro) throw new Error('This terminal is not a Maestro. Enable Maestro in its settings.');
  switch (method) {
    case 'list':
      return allTerminals().map((t) => ({
        id: t.node.id, name: t.node.title, floor: t.floor.name, status: t.entry?.api.status?.() || 'unknown',
        role: roleById(t.node.data.roleId)?.name || '', maestro: !!t.node.data.maestro, command: t.node.data.command || '',
      }));
    case 'roles':
      return state.settings.roles.map((r) => ({ id: r.id, name: r.name, summary: roleSummary(r) }));
    case 'create': {
      const floor = p.floor ? state.floors.find((f) => f.name.toLowerCase() === String(p.floor).toLowerCase() || f.id === p.floor) : caller.floor;
      if (!floor) throw new Error(`No floor "${p.floor}".`);
      let roleId = '';
      if (p.role) {
        const role = state.settings.roles.find((r) => r.id === p.role || r.name.toLowerCase() === String(p.role).toLowerCase());
        if (!role) throw new Error(`No role "${p.role}". Run "orchestrai roles".`);
        roleId = role.id;
      }
      const command = String(p.command || '').trim();
      const sameFloor = floor.id === caller.floor.id;
      const children = sameFloor ? caller.floor.ropes.filter((r) => r.a === caller.node.id).length : floor.nodes.length;
      const node = addNode('terminal', {
        title: String(p.name || '').trim() || (command ? command.split(/\s+/)[0] : 'Agent'),
        x: sameFloor ? caller.node.x + caller.node.w + 60 : 80 + children * 40,
        y: sameFloor ? caller.node.y + children * 370 : 80 + children * 40,
        data: { command, cwd: p.cwd || '', monitor: true, roleId },
      }, floor);
      if (sameFloor) { floor.ropes.push({ id: uid(), a: caller.node.id, b: node.id }); save(); wakeRopes(); }
      return { id: node.id };
    }
    case 'send': {
      const t = findTerminal(p.target);
      if (!t.entry) throw new Error('That terminal is not running.');
      if (t.floor.id === caller.floor.id) flashRope(caller.floor, caller.node.id, t.node.id);
      if (p.enter === false) await call('pty:send', t.node.id, String(p.text));
      else await t.entry.api.send(String(p.text));
      return { ok: true };
    }
    case 'read': {
      const t = findTerminal(p.target);
      const lines = (t.entry?.api.readScreen?.() || '').split('\n');
      return lines.slice(-Math.max(1, Math.min(2000, Number(p.lines) || 60))).join('\n');
    }
    case 'close': {
      const t = findTerminal(p.target);
      if (t.node.id === caller.node.id) throw new Error('A Maestro cannot close itself.');
      removeNode(t.floor, t.node.id);
      return { ok: true };
    }
    default:
      throw new Error(`Unknown method "${method}".`);
  }
}

api.on('bridge:request', async ({ id, method, params, from }) => {
  try {
    call('bridge:respond', { id, result: await bridgeHandle(method, params, from) });
  } catch (err) {
    call('bridge:respond', { id, error: err.message });
  }
});
