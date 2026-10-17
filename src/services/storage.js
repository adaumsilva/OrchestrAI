// Storage management: where data lives, how much space each part takes, moving it, and clearing it.
// The location is the Electron userData folder. Moving it writes a small pointer file next to the default location that
// main.js reads before the app is ready, so the choice survives restarts. OrchestrAI never deletes the old folder after a
// move; it tells you where it is.
const fs = require('fs');
const path = require('path');

const POINTER_NAME = 'orchestrai-location.json';
const SKIP_ON_MOVE = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'LOCK', 'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache']);

// Pure so it can be unit tested: where userData should be, given the default folder and the pointer file.
function resolveUserData(defaultDir, pointerFile) {
  try {
    const p = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    if (p && typeof p.userData === 'string' && path.isAbsolute(p.userData) && fs.existsSync(p.userData)) return path.resolve(p.userData);
  } catch {}
  return defaultDir;
}

// Chromium keeps its databases open while the app runs (exclusively on Windows), so those cannot always be copied.
// Failures inside these folders are reported, not fatal; a failure anywhere else aborts the move.
const CHROMIUM_OWNED = new Set(['Partitions', 'Local Storage', 'Session Storage', 'IndexedDB', 'Network', 'Service Worker', 'blob_storage', 'WebStorage', 'Shared Dictionary', 'DIPS', 'Trust Tokens', 'SharedStorage']);

async function copyTree(src, dst, skipped, owned = false) {
  const st = await fs.promises.lstat(src);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    await fs.promises.mkdir(dst, { recursive: true });
    for (const n of await fs.promises.readdir(src)) {
      if (SKIP_ON_MOVE.has(n)) continue;
      await copyTree(path.join(src, n), path.join(dst, n), skipped, owned || CHROMIUM_OWNED.has(n));
    }
    return;
  }
  try { await fs.promises.copyFile(src, dst); } catch (e) {
    if (!owned) throw e;
    skipped.push(src);
  }
}

function sizeOf(target) {
  let total = 0;
  let st;
  try { st = fs.lstatSync(target); } catch { return 0; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let names = [];
  try { names = fs.readdirSync(target); } catch { return 0; }
  for (const n of names) total += sizeOf(path.join(target, n));
  return total;
}

// Which part of the data folder each entry belongs to. Anything not listed falls under "Other" (Chromium's own state).
const CATEGORIES = [
  { id: 'workspace', label: 'Workspace and settings', entries: ['workspace.json', 'routines.json', 'templates.json', 'usage-providers', 'config.json'] },
  { id: 'backups', label: 'Backups', entries: ['backups'] },
  { id: 'worktrees', label: 'Floor worktrees', entries: ['worktrees'] },
  { id: 'accounts', label: 'Accounts', entries: ['accounts.json', 'account-secrets.json', 'accounts'] },
  { id: 'notes', label: 'Note images', entries: ['note-images'] },
  { id: 'portal', label: 'Portal sign-ins and site data', entries: ['Partitions'] },
  { id: 'cache', label: 'Caches', entries: ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary'] },
];

function usage(root) {
  const claimed = new Set(CATEGORIES.flatMap((c) => c.entries));
  const rows = CATEGORIES.map((c) => ({ id: c.id, label: c.label, bytes: c.entries.reduce((s, e) => s + sizeOf(path.join(root, e)), 0) }));
  let other = 0;
  try { for (const n of fs.readdirSync(root)) if (!claimed.has(n)) other += sizeOf(path.join(root, n)); } catch {}
  rows.push({ id: 'other', label: 'Other', bytes: other });
  return { rows, total: rows.reduce((s, r) => s + r.bytes, 0) };
}

function register(ipcMain, { app, session, shell, getWin }) {
  const pointerFile = () => process.env.ORCH_POINTER_FILE || path.join(app.getPath('appData'), POINTER_NAME);
  const defaultDir = () => path.join(app.getPath('appData'), app.getName());
  const root = () => app.getPath('userData');
  let locked = false; // set while wiping data so a late autosave cannot recreate the files

  const relaunch = () => setTimeout(() => { app.relaunch(); app.exit(0); }, 400);

  ipcMain.handle('storage:info', () => {
    const u = usage(root());
    return { path: root(), defaultPath: defaultDir(), custom: path.resolve(root()) !== path.resolve(defaultDir()), ...u };
  });
  ipcMain.handle('storage:reveal', () => shell.openPath(root()));

  ipcMain.handle('storage:move', async (_e, { dir, relaunch: doRelaunch = true } = {}) => {
    try {
      if (!dir || !path.isAbsolute(dir)) return { ok: false, error: 'Choose a full folder path.' };
      const to = path.resolve(dir), from = path.resolve(root());
      if (to === from) return { ok: false, error: 'That is the current location.' };
      const rel = path.relative(from, to);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { ok: false, error: 'The new location cannot be inside the current one.' };
      if (fs.existsSync(to) && fs.readdirSync(to).length) return { ok: false, error: 'The folder is not empty. Choose an empty or new folder.' };
      fs.mkdirSync(to, { recursive: true });
      const skipped = [];
      await copyTree(from, to, skipped);
      const state = path.join(from, 'workspace.json');
      if (fs.existsSync(state) && (!fs.existsSync(path.join(to, 'workspace.json')) || fs.statSync(path.join(to, 'workspace.json')).size !== fs.statSync(state).size)) {
        return { ok: false, error: 'The copy did not complete; nothing was changed.' };
      }
      // Back at the default folder: drop the pointer instead of pointing at the default.
      if (to === path.resolve(defaultDir())) { try { fs.rmSync(pointerFile(), { force: true }); } catch {} }
      else fs.writeFileSync(pointerFile(), JSON.stringify({ userData: to }, null, 2));
      locked = true;
      if (doRelaunch) relaunch();
      return { ok: true, from, to, relaunching: !!doRelaunch, skipped: skipped.length, signInsMayBeLost: skipped.some((f) => /Partitions/.test(f)) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  async function portalPartitions() {
    const names = ['persist:portal'];
    try {
      for (const n of fs.readdirSync(path.join(root(), 'Partitions'))) if (/^portal/i.test(n)) names.push('persist:' + n);
    } catch {}
    return [...new Set(names)];
  }

  async function clearPortal() {
    for (const p of await portalPartitions()) {
      try { const s = session.fromPartition(p); await s.clearStorageData(); await s.clearCache(); } catch {}
    }
    return true;
  }
  ipcMain.handle('storage:clearPortal', () => clearPortal().then(() => ({ ok: true })));

  ipcMain.handle('storage:deleteAll', async (_e, { confirm, relaunch: doRelaunch = true } = {}) => {
    if (confirm !== 'DELETE') return { ok: false, error: 'Type DELETE to confirm.' };
    locked = true;
    const r = root();
    const failed = [];
    // Unregister floor worktrees from their repositories first so no dangling worktree entries are left behind.
    const wt = path.join(r, 'worktrees');
    try {
      const { execFileSync } = require('child_process');
      for (const n of fs.readdirSync(wt)) {
        const dir = path.join(wt, n);
        try {
          const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
          execFileSync('git', ['--git-dir=' + path.resolve(dir, common), 'worktree', 'remove', '--force', dir], { windowsHide: true, stdio: 'ignore' });
        } catch {}
      }
    } catch {}
    await clearPortal();
    for (const c of CATEGORIES) {
      if (c.id === 'cache') continue;
      for (const e of c.entries) {
        if (e === 'Partitions') continue; // cleared through the sessions above; Chromium keeps files in it open
        try { fs.rmSync(path.join(r, e), { recursive: true, force: true }); } catch (err) { failed.push(e); }
      }
    }
    if (doRelaunch) relaunch();
    return { ok: true, failed, relaunching: !!doRelaunch };
  });

  // main.js asks before accepting an autosave
  return { isLocked: () => locked };
}

// Called before the app is ready: honour a moved data folder unless the location was set explicitly (tests, --user-data-dir).
function applyPointer(app) {
  const def = path.join(app.getPath('appData'), app.getName());
  if (path.resolve(app.getPath('userData')) !== path.resolve(def)) return;
  const file = process.env.ORCH_POINTER_FILE || path.join(app.getPath('appData'), POINTER_NAME);
  const dir = resolveUserData(def, file);
  if (dir !== def) app.setPath('userData', dir);
}

module.exports = { register, applyPointer, resolveUserData, usage, sizeOf, CATEGORIES };
