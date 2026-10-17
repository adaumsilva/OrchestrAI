// Local control bridge. Local terminals get ORCHESTRAI_URL / _TOKEN in their environment and an `orchestrai`
// command on PATH (Maestro terminals can direct any terminal, others only talk to connected peers); requests are forwarded to the renderer, which owns
// the canvas, and the answer is sent back. It listens on 127.0.0.1 only and requires the per-run token.
const http = require('http');
const crypto = require('crypto');
const path = require('path');

// Every terminal gets its own token. The token fixes who is calling and what they may do ('maestro' or 'peer'),
// so a terminal cannot pretend to be another one.
const tokens = new Map(); // token -> { terminalId, scope }
const pending = new Map();
let server = null;
let port = 0;
let nextId = 1;

function start(getWin, ipcMain) {
  ipcMain.handle('bridge:respond', (_e, { id, result, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error)); else p.resolve(result);
  });

  server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/rpc') return send(404, { ok: false, error: 'Not found' });
    const who = tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!who) return send(401, { ok: false, error: 'Unauthorized' });
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return send(400, { ok: false, error: 'Bad JSON' }); }
      const win = getWin();
      if (!win || win.isDestroyed()) return send(503, { ok: false, error: 'OrchestrAI window is not available' });
      const id = nextId++;
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out waiting for the app')); }, 20000 + (msg.method === 'ask' ? (Number(msg.params?.timeout) || 120) * 1000 : 0));
        pending.set(id, { resolve, reject, timer });
        win.webContents.send('bridge:request', { id, method: String(msg.method || ''), params: msg.params || {}, from: who.terminalId, scope: who.scope });
      }).then((result) => send(200, { ok: true, result }), (err) => send(200, { ok: false, error: err.message }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(port); });
  });
}

// Environment for a terminal; scope is 'maestro' (may address any terminal) or 'peer' (only ropes-connected ones).
function envFor(terminalId, binDir, scope = 'peer') {
  for (const [t, w] of tokens) if (w.terminalId === terminalId) tokens.delete(t); // a restarted terminal gets a fresh token
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { terminalId, scope });
  return {
    ORCHESTRAI_URL: `http://127.0.0.1:${port}`,
    ORCHESTRAI_TOKEN: token,
    ORCHESTRAI_TERMINAL: terminalId,
    ORCHESTRAI_NODE: process.execPath,
    PATH: binDir + path.delimiter + (process.env.PATH || ''),
  };
}

function stop() {
  try { server?.close(); } catch {}
}

module.exports = { start, envFor, stop };
