// Agent usage tracking. Providers are small JSON definitions (bundled in ./usage-providers, overridable by files of the
// same id in <userData>/usage-providers) that name a local log source and the parser to read it with. Nothing here talks to
// a vendor API or reads credentials: consumption is summed from the session logs the CLIs already write, and limits are
// reported only where a log carries them (Codex) or where the definition sets one.
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const bundledDir = path.join(__dirname, 'usage-providers');
const userDir = () => path.join(app.getPath('userData'), 'usage-providers');
const expand = (p) => String(p || '').replace(/^~(?=$|[\\/])/, os.homedir());

function loadProviders() {
  const byId = new Map();
  for (const dir of [bundledDir, userDir()]) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { continue; }
    for (const n of names) {
      try {
        const def = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
        if (def && def.id && def.parser) byId.set(def.id, { ...def, source: dir === bundledDir ? 'bundled' : 'custom' });
      } catch (e) { byId.set(n, { id: n, name: n, parser: null, error: `Invalid definition: ${e.message}`, source: 'custom' }); }
    }
  }
  return [...byId.values()];
}

const which = (cmd) => new Promise((resolve) => {
  if (!cmd) return resolve(true);
  execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true }, (err) => resolve(!err));
});

function walk(dir, pred, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, pred, out, depth + 1);
    else if (pred(e.name, full)) out.push(full);
  }
  return out;
}

const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const total = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;

// ---------- parsers ----------
// Claude Code: one JSON event per line; assistant events carry message.usage. Streamed content blocks repeat the same
// message id, so usage is counted once per message id.
const claudeCache = new Map(); // file -> { mtime, rows: [{ ts, input, output, cacheRead, cacheWrite }] }
function claudeRows(file, mtime) {
  const c = claudeCache.get(file);
  if (c && c.mtime === mtime) return c.rows;
  const seen = new Set(), rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    const u = ev.message?.usage;
    if (ev.type !== 'assistant' || !u) continue;
    const key = ev.message.id || ev.uuid;
    if (key && seen.has(key)) continue;
    seen.add(key);
    rows.push({ ts: Date.parse(ev.timestamp) || 0, input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 });
  }
  claudeCache.set(file, { mtime, rows });
  return rows;
}

function parseClaude(def, now) {
  const root = expand(def.root);
  const longest = Math.max(...def.windows.map((w) => w.minutes));
  const files = walk(root, (n) => n.endsWith('.jsonl')).map((f) => ({ f, mtime: fs.statSync(f).mtimeMs })).filter((x) => now - x.mtime < longest * 60000);
  if (!fs.existsSync(root)) return { error: `No Claude Code logs found at ${root}. Run Claude Code once, or point "root" in the definition at its projects folder.` };
  const windows = def.windows.map((w) => ({ label: w.label, minutes: w.minutes, tokens: emptyTokens() }));
  let last = 0;
  for (const { f, mtime } of files) {
    for (const r of claudeRows(f, mtime)) {
      last = Math.max(last, r.ts);
      for (const w of windows) if (now - r.ts < w.minutes * 60000) for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) w.tokens[k] += r[k];
    }
  }
  for (const w of windows) {
    const limit = def.limits?.[String(w.minutes)];
    if (limit) w.percent = Math.min(999, Math.round((total(w.tokens) / limit) * 100));
  }
  return { windows, lastActivity: last || null, note: def.limits && Object.keys(def.limits).length ? null : 'Claude Code does not write plan limits to disk. Add "limits": { "300": <tokens> } to this definition to see a percentage.' };
}

// Codex: rollout files hold cumulative token_count events that also carry the account's rate limits.
function parseCodex(def, now) {
  const root = expand(def.root);
  if (!fs.existsSync(root)) return { error: `No Codex sessions found at ${root}. Run Codex once, or point "root" in the definition at its sessions folder.` };
  const longest = Math.max(...def.windows.map((w) => w.minutes));
  const files = walk(root, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl')).map((f) => ({ f, mtime: fs.statSync(f).mtimeMs })).filter((x) => now - x.mtime < longest * 60000).sort((a, b) => b.mtime - a.mtime);
  const windows = def.windows.map((w) => ({ label: w.label, minutes: w.minutes, tokens: emptyTokens() }));
  let limits = null, last = 0;
  for (const { f, mtime } of files) {
    let final = null, finalTs = mtime;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('token_count')) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const p = ev.payload;
      if (p?.type !== 'token_count') continue;
      if (p.info?.total_token_usage) { final = p.info.total_token_usage; finalTs = Date.parse(ev.timestamp) || mtime; }
      if (p.rate_limits && Date.parse(ev.timestamp) >= (limits?.ts || 0)) limits = { ...p.rate_limits, ts: Date.parse(ev.timestamp) };
    }
    if (!final) continue;
    last = Math.max(last, finalTs);
    const t = { input: Math.max(0, (final.input_tokens || 0) - (final.cached_input_tokens || 0)), output: final.output_tokens || 0, cacheRead: final.cached_input_tokens || 0, cacheWrite: final.cache_write_input_tokens || 0 };
    for (const w of windows) if (now - finalTs < w.minutes * 60000) for (const k of Object.keys(t)) w.tokens[k] += t[k];
  }
  const out = { windows, lastActivity: last || null };
  if (limits) {
    // The log reports two rolling windows; attach each to the definition window of the same length when there is one.
    for (const key of ['primary', 'secondary']) {
      const l = limits[key];
      if (!l) continue;
      const w = windows.find((x) => x.minutes === l.window_minutes) || (windows.push({ label: `${l.window_minutes} min`, minutes: l.window_minutes, tokens: emptyTokens() }), windows[windows.length - 1]);
      w.percent = l.used_percent;
      w.resetsAt = l.resets_at ? l.resets_at * 1000 : null;
    }
    out.plan = limits.plan_type || null;
    out.limitReached = limits.rate_limit_reached_type || null;
  } else out.note = 'No rate-limit data in the recent Codex sessions yet.';
  return out;
}

const PARSERS = { 'claude-transcripts': parseClaude, 'codex-rollouts': parseCodex };

async function queryAll() {
  const now = Date.now();
  return Promise.all(loadProviders().map(async (def) => {
    const base = { id: def.id, name: def.name || def.id, source: def.source, command: def.command || null };
    if (!def.parser || def.error) return { ...base, error: def.error || 'Definition has no parser.' };
    const parser = PARSERS[def.parser];
    if (!parser) return { ...base, error: `Unknown parser "${def.parser}". Supported: ${Object.keys(PARSERS).join(', ')}.` };
    const installed = await which(def.command);
    try {
      const r = parser({ ...def, windows: def.windows?.length ? def.windows : [{ label: '5 hours', minutes: 300 }, { label: '7 days', minutes: 10080 }] }, now);
      return { ...base, installed, updatedAt: now, ...r, ...(r.error && !installed ? { error: `${def.command} was not found on PATH. Install it, then run it once so usage can be read.` } : {}) };
    } catch (e) {
      return { ...base, installed, updatedAt: now, error: `Could not read usage: ${e.message}` };
    }
  }));
}

function register(ipcMain) {
  ipcMain.handle('usage:query', () => queryAll());
  // Copies the bundled definitions next to the user's own so they can be edited, then opens the folder.
  ipcMain.handle('usage:openDefinitions', () => {
    fs.mkdirSync(userDir(), { recursive: true });
    for (const n of fs.readdirSync(bundledDir)) {
      const dest = path.join(userDir(), n);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(bundledDir, n), dest);
    }
    return shell.openPath(userDir());
  });
}

module.exports = { register };
