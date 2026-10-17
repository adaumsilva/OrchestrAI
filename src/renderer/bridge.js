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

// ---------- peer messaging (rope = permission) ----------
const PEER_METHODS = ['peers', 'ask', 'check'];

// Terminals joined to this one by a rope (ropes stay within a floor).
function peersOf(caller) {
  const ids = caller.floor.ropes.filter((r) => r.a === caller.node.id || r.b === caller.node.id).map((r) => (r.a === caller.node.id ? r.b : r.a));
  return allTerminals().filter((t) => t.floor.id === caller.floor.id && ids.includes(t.node.id));
}

function resolvePeer(caller, scope, ref) {
  if (scope === 'maestro') return findTerminal(ref);
  const q = String(ref || '').trim().toLowerCase();
  const hits = peersOf(caller).filter((t) => t.node.id === ref || t.node.title.toLowerCase() === q);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`"${ref}" matches ${hits.length} peers; use an id: ${hits.map((t) => t.node.id).join(', ')}`);
  if (allTerminals().some((t) => t.node.id === ref || t.node.title.toLowerCase() === q)) throw new Error(`"${ref}" is not connected to this terminal. Connect them with a rope first.`);
  throw new Error(`No peer "${ref}". Run "orchestrai peers".`);
}

// Lines of `after` that differ from the start of `before` (the screen is append-mostly).
function newScreenText(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return b.slice(Math.max(0, i - 1)).join('\n').trim();
}

// Send text to a peer, then wait until its screen has changed and stayed quiet; reject on timeout.
async function askPeer(caller, target, text, { timeoutMs = 120000, quietMs = 3000 } = {}) {
  if (!target.entry) throw new Error('That terminal is not running.');
  const read = () => target.entry.api.readScreen?.() || '';
  const before = read();
  const flash = () => { if (target.floor.id === caller.floor.id) flashRope(caller.floor, caller.node.id, target.node.id); };
  flash();
  await target.entry.api.send(text);
  const start = Date.now();
  let last = read(), lastChange = Date.now(), changed = false;
  for (;;) {
    await new Promise((r) => setTimeout(r, 200));
    flash();
    const cur = read();
    if (cur !== last) { last = cur; lastChange = Date.now(); changed = true; }
    // The echo of our own text is a change too, so also require output beyond it before calling it quiet.
    const fresh = newScreenText(before, cur);
    if (changed && Date.now() - lastChange >= quietMs && fresh.length > text.length) return fresh;
    if (Date.now() - start >= timeoutMs) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for "${target.node.title}" to answer${changed ? '. It was still producing output; try "orchestrai check".' : '.'}`);
  }
}

async function bridgeHandle(method, p, from, scope) {
  const caller = allTerminals().find((t) => t.node.id === from);
  if (!caller) throw new Error('Unknown calling terminal.');
  if (PEER_METHODS.includes(method)) {
    switch (method) {
      case 'peers':
        return (scope === 'maestro' ? allTerminals().filter((t) => t !== caller) : peersOf(caller)).map((t) => ({
          id: t.node.id, name: t.node.title, status: t.entry?.api.status?.() || 'unknown', role: roleById(t.node.data.roleId)?.name || '',
        }));
      case 'check': {
        const t = resolvePeer(caller, scope, p.target);
        return { status: t.entry?.api.status?.() || 'unknown', screen: (t.entry?.api.readScreen?.() || '').split('\n').slice(-Math.max(1, Math.min(200, Number(p.lines) || 30))).join('\n') };
      }
      case 'ask': {
        const t = resolvePeer(caller, scope, p.target);
        if (!String(p.text || '').trim()) throw new Error('Nothing to ask.');
        return askPeer(caller, t, String(p.text), { timeoutMs: Number(p.timeout) > 0 ? Number(p.timeout) * 1000 : undefined, quietMs: Number(p.quiet) > 0 ? Number(p.quiet) * 1000 : undefined });
      }
    }
  }
  if (scope !== 'maestro' || !caller.node.data.maestro) throw new Error('This terminal is not a Maestro. Enable Maestro in its settings, or use peers/ask/check with connected terminals.');
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

api.on('bridge:request', async ({ id, method, params, from, scope }) => {
  try {
    call('bridge:respond', { id, result: await bridgeHandle(method, params, from, scope) });
  } catch (err) {
    call('bridge:respond', { id, error: err.message });
  }
});
