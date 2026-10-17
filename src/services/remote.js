// Remote control: a small web app served from this computer so a phone or tablet can watch terminals, answer prompts and get
// attention alerts. Off by default. There is no cloud relay: the server listens only where you tell it to (this computer,
// your Tailscale address, or the local network) and a device must be paired with a one-time code shown on this screen.
// See docs/REMOTE.md for the threat model.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAIR_TTL_MS = () => Number(process.env.ORCH_PAIR_TTL_MS) || 2 * 60 * 1000;
const PAIR_MAX_TRIES = 5;
const COOKIE = 'orch_remote';
const MAX_BODY = 16 * 1024;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const rand = (n) => crypto.randomBytes(n).toString('hex');

// 100.64.0.0/10 is the carrier-grade NAT range Tailscale uses for its addresses.
function tailscaleAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const [a, b] = i.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) return i.address;
    }
  }
  return null;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

function createRemote({ app, getWin, ask, shell }) {
  const file = () => path.join(app.getPath('userData'), 'remote.json');
  let cfg = { enabled: false, mode: 'local', port: 0, acceptLanRisk: false, devices: [] };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch {}
  cfg.devices = Array.isArray(cfg.devices) ? cfg.devices : [];
  const save = () => { fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), { mode: 0o600 }); };

  let server = null, listening = null, error = '';
  let pairing = null; // { code (hashed), plain, expires, tries, locked }
  const sse = new Set(); // { res, deviceId }
  const failures = new Map(); // ip -> [timestamps]
  let pollTimer = null, lastSnapshot = '';

  const notify = () => { try { getWin()?.webContents.send('remote:changed'); } catch {} };

  // ---------- helpers ----------
  const bodyOf = (req) => new Promise((resolve, reject) => {
    let raw = '';
    let over = false;
    req.on('data', (c) => { if (over) return; raw += c; if (raw.length > MAX_BODY) { over = true; raw = ''; reject(new Error('too large')); } }); // keep draining so the answer can be delivered
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
  const parseCookies = (h) => Object.fromEntries(String(h || '').split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
  const ipOf = (req) => req.socket.remoteAddress || '';
  const tooMany = (ip) => { const now = Date.now(); const l = (failures.get(ip) || []).filter((t) => now - t < 60000); failures.set(ip, l); return l.length >= 10; };
  const fail = (ip) => { const l = failures.get(ip) || []; l.push(Date.now()); failures.set(ip, l); };

  function deviceFor(req) {
    const tok = parseCookies(req.headers.cookie)[COOKIE];
    if (!tok || tok.length !== 64) return null;
    const h = sha(tok);
    return cfg.devices.find((d) => safeEq(d.hash, h)) || null;
  }

  // The Host header must name this machine; otherwise a page on another site could reach the server through DNS rebinding.
  function hostOk(req) {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!host) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost' || host === '::1') return true;
    const me = os.hostname().toLowerCase();
    return host === me || host === me + '.local' || host.endsWith('.ts.net');
  }
  // A browser always sends Origin on cross-site requests with a body; refuse anything that is not this same origin.
  function originOk(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { return false; }
  }

  function json(res, code, body, extra = {}) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(JSON.stringify(body));
  }

  // ---------- the web app ----------
  function page(res) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const html = require('./remote-page').html(nonce);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    res.end(html);
  }

  // ---------- requests ----------
  async function handle(req, res) {
    const ip = ipOf(req);
    if (!hostOk(req)) { res.writeHead(421); return res.end('Misdirected request'); }
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return page(res);
    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }
    if (tooMany(ip)) return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
    // Every API call must carry a header a cross-site form or image cannot add, and come from this origin.
    if (req.headers['x-orchestrai'] !== '1' || !originOk(req)) { fail(ip); return json(res, 403, { error: 'Forbidden' }); }

    if (p === '/api/pair' && req.method === 'POST') return pair(req, res, ip);

    const device = deviceFor(req);
    if (!device) { fail(ip); return json(res, 401, { error: 'Not paired' }); }
    device.lastSeen = Date.now();

    try {
      if (p === '/api/me') return json(res, 200, { device: { id: device.id, name: device.name } });
      if (p === '/api/logout' && req.method === 'POST') { revoke(device.id); return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict` }); }
      if (p === '/api/events') return events(req, res, device);
      if (p === '/api/terminals' && req.method === 'GET') return json(res, 200, { terminals: await ask('remote-terminals', {}) });
      const m = /^\/api\/terminals\/([\w-]{1,40})\/(screen|input|ack)$/.exec(p);
      if (m) {
        const id = m[1];
        if (m[2] === 'screen' && req.method === 'GET') return json(res, 200, await ask('remote-screen', { id, lines: Math.min(300, Math.max(1, Number(url.searchParams.get('lines')) || 60)) }));
        if (m[2] === 'input' && req.method === 'POST') {
          const b = await bodyOf(req);
          return json(res, 200, await ask('remote-input', { id, text: typeof b.text === 'string' ? b.text.slice(0, 4000) : undefined, key: typeof b.key === 'string' ? b.key : undefined, enter: b.enter !== false }));
        }
        if (m[2] === 'ack' && req.method === 'POST') return json(res, 200, await ask('remote-ack', { id }));
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e.message === 'too large') return json(res, 413, { error: 'Request too large' }, { Connection: 'close' });
      return json(res, e.message === 'bad json' ? 400 : 502, { error: e.message });
    }
  }

  async function pair(req, res, ip) {
    let b;
    try { b = await bodyOf(req); } catch (e) { return json(res, e.message === 'too large' ? 413 : 400, { error: 'Bad request' }, { Connection: 'close' }); }
    if (!pairing || Date.now() > pairing.expires) { fail(ip); return json(res, 403, { error: 'No pairing is open. Start pairing on the computer.' }); }
    if (pairing.locked) return json(res, 429, { error: 'Pairing is locked after too many wrong codes. Start a new pairing on the computer.' });
    const code = String(b.code || '').replace(/\s+/g, '').toUpperCase();
    if (!safeEq(sha(code), pairing.hash)) {
      fail(ip);
      pairing.tries++;
      if (pairing.tries >= PAIR_MAX_TRIES) { pairing.locked = true; notify(); }
      return json(res, 403, { error: 'Wrong code' });
    }
    const name = String(b.name || 'Device').replace(/[^\w .\-()]/g, '').trim().slice(0, 40) || 'Device';
    const token = rand(32);
    const device = { id: rand(6), name, hash: sha(token), createdAt: Date.now(), lastSeen: Date.now() };
    cfg.devices.push(device);
    pairing = null; // one use only
    save(); notify();
    return json(res, 200, { ok: true, device: { id: device.id, name } }, { 'Set-Cookie': `${COOKIE}=${token}; Max-Age=${60 * 60 * 24 * 90}; Path=/; HttpOnly; SameSite=Strict` });
  }

  function events(req, res, device) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    res.write('retry: 3000\n\n');
    const client = { res, deviceId: device.id };
    sse.add(client);
    req.on('close', () => { sse.delete(client); updatePoll(); });
    updatePoll();
    push(client, 'hello', { at: Date.now() });
  }
  const push = (client, event, data) => { try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };

  // While anyone is watching, look for attention changes every couple of seconds and tell them.
  function updatePoll() {
    if (sse.size && !pollTimer) {
      pollTimer = setInterval(async () => {
        try {
          const rows = await ask('remote-terminals', {});
          const snap = JSON.stringify(rows.map((r) => [r.id, r.status, r.attention]));
          if (snap !== lastSnapshot) { lastSnapshot = snap; for (const c of sse) push(c, 'terminals', { terminals: rows }); }
        } catch {}
      }, Number(process.env.ORCH_REMOTE_POLL_MS) || 2000);
    } else if (!sse.size && pollTimer) { clearInterval(pollTimer); pollTimer = null; lastSnapshot = ''; }
  }

  // ---------- control ----------
  function bindHost() {
    if (cfg.mode === 'local') return { host: '127.0.0.1' };
    if (cfg.mode === 'tailscale') {
      const a = tailscaleAddress();
      return a ? { host: a } : { error: 'No Tailscale address was found on this computer. Is Tailscale running?' };
    }
    if (cfg.mode === 'lan') return cfg.acceptLanRisk ? { host: '0.0.0.0' } : { error: 'The local network option needs you to accept that traffic on it is not encrypted.' };
    return { error: 'Unknown mode.' };
  }

  function stop() {
    for (const c of sse) { try { c.res.end(); } catch {} }
    sse.clear(); updatePoll();
    try { server?.closeAllConnections?.(); server?.close(); } catch {}
    server = null; listening = null; pairing = null;
  }

  function start() {
    stop(); error = ''; failures.clear(); // a restart also resets the attempt limits
    if (!cfg.enabled) return Promise.resolve();
    const b = bindHost();
    if (b.error) { error = b.error; return Promise.resolve(); }
    return new Promise((resolve) => {
      server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
      server.requestTimeout = 30000;
      server.on('error', (e) => { error = e.code === 'EADDRINUSE' ? `Port ${cfg.port} is already in use.` : e.message; server = null; listening = null; notify(); resolve(); });
      server.listen(cfg.port || 0, b.host, () => { listening = { host: b.host, port: server.address().port }; notify(); resolve(); });
    });
  }

  function revoke(id) {
    cfg.devices = cfg.devices.filter((d) => d.id !== id);
    for (const c of [...sse]) if (c.deviceId === id) { try { c.res.end(); } catch {} sse.delete(c); }
    updatePoll(); save(); notify();
  }

  function status() {
    const urls = [];
    if (listening) {
      const hosts = listening.host === '0.0.0.0' ? lanAddresses() : [listening.host];
      for (const h of hosts) urls.push(`http://${h}:${listening.port}/`);
    }
    return {
      enabled: cfg.enabled, mode: cfg.mode, port: cfg.port, acceptLanRisk: cfg.acceptLanRisk,
      listening, urls, error, tailscale: tailscaleAddress(),
      pairing: pairing && Date.now() < pairing.expires ? { code: pairing.plain, expiresAt: pairing.expires, locked: pairing.locked } : null,
      devices: cfg.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen, connected: [...sse].some((c) => c.deviceId === d.id) })),
    };
  }

  function register(ipcMain) {
    ipcMain.handle('remote:status', () => status());
    ipcMain.handle('remote:configure', async (_e, patch = {}) => {
      if (patch.mode && !['local', 'tailscale', 'lan'].includes(patch.mode)) return { ok: false, error: 'Unknown mode.' };
      if (patch.port !== undefined && !(Number.isInteger(patch.port) && patch.port >= 0 && patch.port < 65536)) return { ok: false, error: 'The port must be between 0 and 65535.' };
      for (const k of ['enabled', 'mode', 'port', 'acceptLanRisk']) if (patch[k] !== undefined) cfg[k] = patch[k];
      if (cfg.mode !== 'lan') cfg.acceptLanRisk = false;
      save();
      await start();
      return { ok: !error, error, status: status() };
    });
    ipcMain.handle('remote:startPairing', () => {
      if (!listening) return { ok: false, error: 'Turn remote control on first.' };
      const plain = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8); // 32 bits, single use, five tries, two minutes
      pairing = { plain, hash: sha(plain), expires: Date.now() + PAIR_TTL_MS(), tries: 0, locked: false };
      notify();
      return { ok: true, code: plain, expiresAt: pairing.expires };
    });
    ipcMain.handle('remote:cancelPairing', () => { pairing = null; notify(); return true; });
    ipcMain.handle('remote:revoke', (_e, id) => { revoke(String(id)); return true; });
    ipcMain.handle('remote:revokeAll', () => { for (const d of [...cfg.devices]) revoke(d.id); return true; });
  }

  return { register, start, stop, status };
}

module.exports = { createRemote, tailscaleAddress };
