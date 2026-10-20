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
const PEER_METHODS = ['device-list', 'device-info', 'device-shot', 'device-tap', 'device-swipe', 'device-type', 'device-key', 'device-ui', 'device-launch', 'peers', 'ask', 'check', 'floor-status', 'portal-list', 'portal-nav', 'portal-text', 'portal-click', 'portal-type', 'portal-press', 'portal-wait', 'portal-shot'];

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

// Turns a portal action's outcome into a specific error.
function portalOk(r, what, isKey) {
  if (r === 'ok') return;
  const w = '"' + what + '"';
  throw new Error({
    missing: 'No element matches ' + w + '.',
    hidden: 'The element ' + w + ' exists but is not visible (hidden or zero size); scroll, open its container or wait for it.',
    disabled: 'The element ' + w + ' is disabled.',
    unsupported: 'The element ' + w + ' is not an input or an editable area.',
    nokey: 'No key given.',
  }[r] || (isKey ? 'Key press failed: ' + r : String(r)));
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
  const start = Date.now();
  await deliverPrompt(target, text);
  // Delivery itself waits for the terminal to react, so the answer may already be on screen: compare against `before`.
  let last = before, lastChange = Math.max(start, target.entry.api.lastOutput?.() || 0), changed = false;
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

// ---------- reliable prompt delivery ----------
// Typing into an agent TUI is racy: Enter sent right after a paste is swallowed as part of it, and an agent that is
// mid-turn may ignore it. One queue per terminal keeps messages from interleaving; after Enter we expect the terminal to
// react, and press Enter again (up to 3 more times) if it stayed silent.
const bridgeSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deliveryLines = new Map(); // terminal id -> tail of its delivery queue

function deliverPrompt(t, text, { waitIdle = false, maxWaitMs = 600000 } = {}) {
  const id = t.node.id;
  const run = (deliveryLines.get(id) || Promise.resolve()).then(async () => {
    const api = t.entry?.api;
    if (!api) throw new Error('That terminal is not running.');
    if (waitIdle) {
      const began = Date.now();
      while (Date.now() - began < maxWaitMs && (api.status?.() === 'running' || Date.now() - (api.lastOutput?.() || 0) < 1500)) await bridgeSleep(500);
    }
    const multi = /[\r\n]/.test(text);
    await call('pty:send', id, multi ? `\x1b[200~${text}\x1b[201~` : text);
    await bridgeSleep(multi ? 400 : 150);
    for (let attempt = 0; attempt < 4; attempt++) {
      const mark = Date.now();
      await call('pty:send', id, '\r');
      await bridgeSleep(2000);
      if ((api.lastOutput?.() || 0) >= mark) return true;
    }
    return false;
  });
  deliveryLines.set(id, run.catch(() => {}));
  return run;
}

// ---------- replies to a Maestro ----------
// A terminal given work by `orchestrai send` reports back: when it goes quiet after answering, a short message with its
// latest output is typed into the Maestro so it can carry on. (`send --no-reply` opts out.) A poller (not a one-shot
// event) watches every pending job so a missed quiet event cannot strand it; it also nudges an agent that never started
// and reports one that exited.
const replyWatch = new Map(); // target node id -> { maestroId, text, before, started, nudges, lastNudge }
const reportQueue = new Map(); // maestro node id -> [message]
const flushing = new Set();
let watchTimer = null;

function watchReply(caller, target, text) {
  const now = Date.now();
  replyWatch.set(target.node.id, { maestroId: caller.node.id, text, before: target.entry.api.readScreen?.() || '', started: now, nudges: 0, lastNudge: now });
  if (!watchTimer) watchTimer = setInterval(pollWatches, 1500);
}

const tailOf = (screen) => screen.split('\n').filter((l) => l.trim()).slice(-25).join('\n');

async function flushReports(maestroId) {
  if (flushing.has(maestroId)) return;
  flushing.add(maestroId);
  try {
    while (reportQueue.get(maestroId)?.length) {
      const maestro = allTerminals().find((t) => t.node.id === maestroId);
      if (!maestro?.entry) { reportQueue.delete(maestroId); return; }
      const batch = reportQueue.get(maestroId).splice(0);
      const msg = `[OrchestrAI] ${batch.join('\n\n')}\n\nRead the results (orchestrai read "<name>" --lines 200 for more) and continue the plan.`;
      await deliverPrompt(maestro, msg, { waitIdle: true }).catch(() => {});
    }
  } finally { flushing.delete(maestroId); }
}

function report(w, text) {
  if (!reportQueue.has(w.maestroId)) reportQueue.set(w.maestroId, []);
  reportQueue.get(w.maestroId).push(text);
  flushReports(w.maestroId);
}

function pollWatches() {
  if (!replyWatch.size) { clearInterval(watchTimer); watchTimer = null; return; }
  const terms = allTerminals();
  for (const [id, w] of [...replyWatch]) {
    const target = terms.find((t) => t.node.id === id);
    const maestro = terms.find((t) => t.node.id === w.maestroId);
    if (!maestro?.entry) { replyWatch.delete(id); continue; }
    if (!target) { replyWatch.delete(id); report(w, 'A terminal you sent work to was closed before it reported back.'); continue; }
    const title = target.node.title;
    const api = target.entry?.api;
    const status = api?.status?.();
    if (!api || status === 'exited' || status === 'error') {
      replyWatch.delete(id);
      report(w, `"${title}" exited before finishing the task you sent it. Its last output:\n${tailOf(api?.readScreen?.() || '')}`);
      continue;
    }
    const now = Date.now();
    const quiet = now - (api.lastOutput?.() || 0);
    const screen = api.readScreen?.() || '';
    const answered = newScreenText(w.before, screen).length > w.text.length + 40;
    if (answered && status === 'idle' && quiet >= 4500) {
      replyWatch.delete(id);
      report(w, `"${title}" finished the task you sent it. Its latest output:\n${tailOf(screen)}`);
    } else if (!answered && status !== 'running' && quiet >= 20000 && now - w.lastNudge >= 20000) {
      // Still only our own echo: the message may be sitting unsubmitted in the input. Press Enter, then give up.
      if (w.nudges >= 2) {
        replyWatch.delete(id);
        report(w, `"${title}" did not respond to the task you sent it (it looks idle with the message unanswered). Check it with orchestrai read "${title}" and resend if needed.`);
      } else { w.nudges++; w.lastNudge = now; call('pty:send', id, '\r'); }
    }
  }
}

// What a paired phone may do (see services/remote.js): list terminals, read a screen, type, press a key, clear the alert.
const REMOTE_KEYS = { enter: '\r', esc: '\x1b', 'ctrl-c': '\x03', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', tab: '\t' };
async function remoteHandle(method, p) {
  const terms = allTerminals();
  const byId = (id) => { const t = terms.find((x) => x.node.id === id); if (!t) throw new Error('No such terminal.'); return t; };
  switch (method) {
    case 'remote-terminals':
      return terms.map((t) => ({ id: t.node.id, name: t.node.title, floor: t.floor.name, status: t.entry?.api.status?.() || 'starting', attention: !!t.entry?.el.classList.contains('attention'), role: roleById(t.node.data.roleId)?.name || '' }));
    case 'remote-screen': {
      const t = byId(p.id);
      const lines = (t.entry?.api.readScreen?.() || '').split('\n');
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return { text: lines.slice(-Math.max(1, Math.min(300, Number(p.lines) || 60))).join('\n'), status: t.entry?.api.status?.() || 'starting' };
    }
    case 'remote-input': {
      const t = byId(p.id);
      if (!t.entry) throw new Error('That terminal is not running.');
      if (typeof p.key === 'string' && p.key) {
        const data = REMOTE_KEYS[p.key] ?? (/^[a-zA-Z0-9]$/.test(p.key) ? p.key : null);
        if (data === null) throw new Error('Unknown key.');
        await call('pty:send', t.node.id, data);
      } else if (typeof p.text === 'string' && p.text) {
        if (p.enter === false) await call('pty:send', t.node.id, p.text); else await t.entry.api.send(p.text);
      } else throw new Error('Nothing to send.');
      return { ok: true };
    }
    case 'remote-ack': byId(p.id).entry?.api.clearAttention?.(); return { ok: true };
    default: throw new Error('Unknown request.');
  }
}

async function bridgeHandle(method, p, from, scope) {
  const p_ = p || {};
  if (scope === 'remote') return remoteHandle(method, p_);
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
        const r = await p.api.wait('load', (Number(p_.timeout) || 20) * 1000);
        if (r === 'loadfail') throw new Error('Navigation failed: ' + p.api.loadError());
        if (r === 'timeout') throw new Error('The page did not finish loading within ' + (Number(p_.timeout) || 20) + 's (' + p.api.url() + '). It may still be loading; use "portal wait load".');
        return { url: p.api.url() };
      }
      case 'portal-text':
        return resolvePortal(caller, scope, p_.target).api.text(Number(p_.max) || 20000);
      case 'portal-click': {
        portalOk(await resolvePortal(caller, scope, p_.target).api.click(String(p_.selector || '')), p_.selector);
        return { ok: true };
      }
      case 'portal-type': {
        portalOk(await resolvePortal(caller, scope, p_.target).api.type(String(p_.selector || ''), String(p_.text ?? ''), { clear: !!p_.clear, submit: !!p_.submit }), p_.selector);
        return { ok: true };
      }
      case 'portal-press': {
        portalOk(await resolvePortal(caller, scope, p_.target).api.press(String(p_.key || '')), p_.key, true);
        return { ok: true };
      }
      case 'portal-wait': {
        const secs = Number(p_.timeout) || 10;
        const r = await resolvePortal(caller, scope, p_.target).api.wait(String(p_.selector || 'load'), secs * 1000);
        if (r === 'timeout') throw new Error('Timed out after ' + secs + 's waiting for ' + (p_.selector && p_.selector !== 'load' ? '"' + p_.selector + '" to appear' : 'the page to load') + '.');
        if (r === 'loadfail') throw new Error('Navigation failed: ' + resolvePortal(caller, scope, p_.target).api.loadError());
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
    case 'portal-open': {
      const floor = p.floor ? state.floors.find((f) => f.name.toLowerCase() === String(p.floor).toLowerCase() || f.id === p.floor) : caller.floor;
      if (!floor) throw new Error(`No floor "${p.floor}".`);
      const url = String(p.url || '').trim();
      const sameFloor = floor.id === caller.floor.id;
      const children = sameFloor ? caller.floor.ropes.filter((r) => r.a === caller.node.id).length : floor.nodes.length;
      const node = addNode('portal', {
        title: String(p.name || '').trim() || 'Portal',
        x: sameFloor ? caller.node.x + caller.node.w + 60 : 80 + children * 40,
        y: sameFloor ? caller.node.y + children * 370 : 80 + children * 40,
        data: url ? { url: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url } : {},
      }, floor);
      if (sameFloor) { floor.ropes.push({ id: uid(), a: caller.node.id, b: node.id }); save(); wakeRopes(); }
      return { id: node.id };
    }
    case 'portal-close': {
      const hit = portalsFor(caller, 'maestro').find((x) => x.node.id === p.target || x.node.title.toLowerCase() === String(p.target || '').toLowerCase());
      if (!hit) throw new Error(`No portal "${p.target}". Run "orchestrai portal list".`);
      removeNode(hit.floor, hit.node.id);
      return { ok: true };
    }
    case 'send': {
      const t = findTerminal(p.target);
      if (!t.entry) throw new Error('That terminal is not running.');
      if (t.floor.id === caller.floor.id) flashRope(caller.floor, caller.node.id, t.node.id);
      if (t.node.id !== caller.node.id && p.enter !== false && p.reply !== false) watchReply(caller, t, String(p.text));
      if (p.enter === false) await call('pty:send', t.node.id, String(p.text));
      else if (!(await deliverPrompt(t, String(p.text)))) return { ok: true, warning: 'The terminal showed no reaction after Enter; check it with "orchestrai read".' };
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
