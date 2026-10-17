// Agent config files (CLAUDE.md, AGENTS.md) in a floor's directory: status, create/edit/delete (to the trash) and sync.
// Every write carries the modification time the caller last saw; if the file changed since, nothing is written.
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const NAMES = ['CLAUDE.md', 'AGENTS.md'];

function resolve(dir, name) {
  if (!NAMES.includes(name)) throw new Error('Not a managed config file');
  if (!dir || !fs.existsSync(dir)) throw new Error('The floor directory does not exist');
  return path.join(dir, name);
}

function stat(file) {
  try {
    const st = fs.statSync(file);
    const content = fs.readFileSync(file, 'utf8');
    return { exists: true, mtime: st.mtimeMs, size: st.size, chars: content.length, content };
  } catch { return { exists: false }; }
}

function status(dir) {
  const files = {};
  for (const n of NAMES) {
    const s = stat(resolve(dir, n));
    files[n] = s.exists ? { exists: true, mtime: s.mtime, chars: s.chars } : { exists: false };
    if (s.exists) files[n]._content = s.content;
  }
  const [a, b] = NAMES.map((n) => files[n]);
  const sync = a.exists && b.exists ? (a._content === b._content ? 'inSync' : 'different') : a.exists || b.exists ? 'onlyOne' : 'none';
  for (const n of NAMES) delete files[n]._content;
  return { files, sync };
}

const stale = () => ({ ok: false, stale: true, error: 'The file changed on disk since you opened it. Reload and try again.' });

// expected: the mtime seen when the file was read, or null when the file must not exist yet (create).
function write(dir, name, content, expected) {
  try {
    const file = resolve(dir, name);
    const cur = stat(file);
    if (expected == null ? cur.exists : !cur.exists || cur.mtime !== expected) return stale();
    fs.writeFileSync(file, String(content), { encoding: 'utf8', flag: 'w' });
    return { ok: true, mtime: fs.statSync(file).mtimeMs };
  } catch (e) { return { ok: false, error: e.message }; }
}

// from: the file whose content wins. expected: { 'CLAUDE.md': mtime|null, 'AGENTS.md': mtime|null } as last seen.
function sync(dir, from, expected = {}) {
  try {
    const to = NAMES.find((n) => n !== from);
    const src = stat(resolve(dir, from)), dst = stat(resolve(dir, to));
    if (!src.exists) return { ok: false, error: `${from} does not exist` };
    const bad = (s, n) => (expected[n] == null ? s.exists : !s.exists || s.mtime !== expected[n]);
    if (bad(src, from) || bad(dst, to)) return stale();
    fs.writeFileSync(path.join(dir, to), src.content, 'utf8');
    return { ok: true, overwrote: to };
  } catch (e) { return { ok: false, error: e.message }; }
}

function register(ipcMain) {
  ipcMain.handle('config:status', (_e, dir) => { try { return status(dir); } catch (e) { return { error: e.message }; } });
  ipcMain.handle('config:read', (_e, dir, name) => {
    try { const s = stat(resolve(dir, name)); return s.exists ? { content: s.content, mtime: s.mtime } : { error: 'File does not exist' }; } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('config:write', (_e, dir, name, content, expected) => write(dir, name, content, expected));
  ipcMain.handle('config:sync', (_e, dir, from, expected) => sync(dir, from, expected));
  ipcMain.handle('config:trash', async (_e, dir, name) => {
    try { await shell.trashItem(resolve(dir, name)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { register, status, write, sync };
