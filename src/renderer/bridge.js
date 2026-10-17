// Renderer side of the Maestro bridge: executes `orchestrai` CLI requests against the canvas.
// Only terminals with Maestro enabled are given the token, and the caller is re-checked here.

function allTerminals() {
  const out = [];
  for (const floor of allFloors()) {
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
const PEER_METHODS = ['device-list', 'device-info', 'device-shot', 'device-tap', 'device-swipe', 'device-type', 'device-key', 'device-ui', 'device-launch', 'peers', 'ask', 'check', 'floor-status', 'portal-list', 'portal-nav', 'portal-text', 'portal-click', 'portal-type', 'portal-shot'];

// Portals a terminal may drive: those joined to it by a rope (a Maestro may drive any).
function portalsFor(caller, scope) {
  const linked = (floor, id) => floor.ropes.filter((r) => r.a === id || r.b === id).map((r) => (r.a === id ? r.b : r.a));
  const out = [];
  for (const floor of allFloors()) {
    const ids = scope === 'maestro' ? null : (floor.id === caller.floor.id ? linked(floor, caller.node.id) : []);
    for (const node of floor.nodes) {
      if (node.kind !== 'portal' || (ids && !ids.includes(node.id))) continue;
      const entry = rt.get(floor.id)?.live.get(node.id);
      if (entry?.api.portal) out.push({ floor, node, api: entry.api.portal });
    }
  }
  return out;
}

// Device nodes a terminal may drive: those joined to it by a rope (a Maestro may drive any).
function devicesFor(caller, scope) {
  const out = [];
  for (const floor of allFloors()) {
    const linked = scope === 'maestro' ? null : (floor.id === caller.floor.id ? floor.ropes.filter((r) => r.a === caller.node.id || r.b === caller.node.id).map((r) => (r.a === caller.node.id ? r.b : r.a)) : []);
    for (const node of floor.nodes) {
      if (node.kind !== 'device' || (linked && !linked.includes(node.id))) continue;
      const entry = rt.get(floor.id)?.live.get(node.id);
      if (entry?.api.device) out.push({ floor, node, api: entry.api.device });
    }
  }
  return out;
}

function resolveDevice(caller, scope, ref) {
  const all = devicesFor(caller, scope);
  const q = String(ref || '').trim().toLowerCase();
  if (!q && all.length === 1) return all[0];
  const hits = all.filter((d) => d.node.id === ref || d.node.title.toLowerCase() === q);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error('"' + ref + '" matches ' + hits.length + ' device nodes; use an id: ' + hits.map((d) => d.node.id).join(', '));
  throw new Error(all.length ? 'No device node "' + ref + '" connected to this terminal.' : 'No device node is connected to this terminal. Add a Device node and connect it with a rope first.');
}

function resolvePortal(caller, scope, ref) {
  const all = portalsFor(caller, scope);
  const q = String(ref || '').trim().toLowerCase();
  if (!q && all.length === 1) return all[0];
  const hits = all.filter((p) => p.node.id === ref || p.node.title.toLowerCase() === q);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error('"' + ref + '" matches ' + hits.length + ' portals; use an id: ' + hits.map((p) => p.node.id).join(', '));
  throw new Error(all.length ? 'No portal "' + ref + '" connected to this terminal. Run "orchestrai portal list".' : 'No portal is connected to this terminal. Connect one with a rope first.');
}

// Terminals joined to this one by a rope (ropes stay within a floor).
function peersOf(caller) {
  const mine = caller.floor.ropes.filter((r) => r.a === caller.node.id || (r.b === caller.node.id && !r.rf));
  return allTerminals().filter((t) => mine.some((r) => (r.rf ? t.floor.id === r.rf && t.node.id === r.b : t.floor.id === caller.floor.id && t.node.id === (r.a === caller.node.id ? r.b : r.a))));
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
  const flash = () => flashRope(caller.floor, caller.node.id, target.node.id);
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
  const p_ = p || {};
  const caller = allTerminals().find((t) => t.node.id === from);
  if (!caller) throw new Error('Unknown calling terminal.');
  if (PEER_METHODS.includes(method)) {
    switch (method) {
      case 'peers':
        return (scope === 'maestro' ? allTerminals().filter((t) => t !== caller) : peersOf(caller)).map((t) => ({
          id: t.node.id, name: t.node.title, status: t.entry?.api.status?.() || 'unknown', role: roleById(t.node.data.roleId)?.name || '',
        }));
      case 'device-list': {
        const nodes = devicesFor(caller, scope);
        return Promise.all(nodes.map(async (d) => ({ node: d.node.id, name: d.node.title, serial: d.api.serial() || '', devices: (await d.api.list().catch(() => [])).filter((x) => x.state === 'device').map((x) => x.serial).join(',') })));
      }
      case 'device-info': return resolveDevice(caller, scope, p_.target).api.info(p_.serial);
      case 'device-shot': return resolveDevice(caller, scope, p_.target).api.shot(p_.serial);
      case 'device-tap': return resolveDevice(caller, scope, p_.target).api.tap(Number(p_.x), Number(p_.y), p_.serial).then(() => ({ ok: true }));
      case 'device-swipe': return resolveDevice(caller, scope, p_.target).api.swipe(Number(p_.x1), Number(p_.y1), Number(p_.x2), Number(p_.y2), Number(p_.ms) || 250, p_.serial).then(() => ({ ok: true }));
      case 'device-type': return resolveDevice(caller, scope, p_.target).api.type(String(p_.text ?? ''), p_.serial).then(() => ({ ok: true }));
      case 'device-key': return resolveDevice(caller, scope, p_.target).api.key(String(p_.key || ''), p_.serial).then(() => ({ ok: true }));
      case 'device-launch': return resolveDevice(caller, scope, p_.target).api.launch(String(p_.pkg || ''), p_.serial).then(() => ({ ok: true }));
      case 'device-ui': return resolveDevice(caller, scope, p_.target).api.ui(p_.serial);
      case 'portal-list':
        return portalsFor(caller, scope).map((p) => ({ id: p.node.id, name: p.node.title, url: p.api.url(), title: p.api.title() }));
      case 'portal-nav': {
        const p = resolvePortal(caller, scope, p_.target);
        p.api.navigate(String(p_.url || ''));
        return { url: p.api.url() };
      }
      case 'portal-text':
        return resolvePortal(caller, scope, p_.target).api.text(Number(p_.max) || 20000);
      case 'portal-click': {
        const ok = await resolvePortal(caller, scope, p_.target).api.click(String(p_.selector || ''));
        if (!ok) throw new Error('No element matches "' + p_.selector + '".');
        return { ok: true };
      }
      case 'portal-type': {
        const ok = await resolvePortal(caller, scope, p_.target).api.type(String(p_.selector || ''), String(p_.text ?? ''));
        if (!ok) throw new Error('No element matches "' + p_.selector + '".');
        return { ok: true };
      }
      case 'portal-shot': {
        const r = await resolvePortal(caller, scope, p_.target).api.shot();
        if (r.error) throw new Error(r.error);
        return { path: r.path, width: r.width, height: r.height };
      }
      case 'floor-status':
        setFloorStatus(caller.floor, p.text, p.state);
        return { floor: caller.floor.name, status: caller.floor.status };
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
    case 'routine-list': {
      const { routines } = await call('routines:list');
      return routines.map((r) => ({ id: r.id, name: r.name, schedule: describeSchedule(r.schedule), enabled: r.enabled, next: r.nextRun ? new Date(r.nextRun).toLocaleString() : '', target: r.target.newTerminal ? 'new terminal' : (allTerminals().find((t) => t.node.id === r.target.terminalId)?.node.title || '?') }));
    }
    case 'routine-add': {
      const target = p.target ? { terminalId: findTerminal(p.target).node.id } : { newTerminal: { name: p.name || 'Routine', command: p.command || '' } };
      const res = await call('routines:save', { name: p.name, text: p.text || '', target, schedule: p.schedule, enabled: true });
      if (!res.ok) throw new Error(res.error);
      return { id: res.routine.id };
    }
    case 'routine-remove': {
      await call('routines:remove', String(p.id));
      return { ok: true };
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
