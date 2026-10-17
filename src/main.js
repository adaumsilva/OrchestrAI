const { app, BrowserWindow, ipcMain, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { exec } = require('child_process');
const git = require('./services/git');
const files = require('./services/files');
const chat = require('./services/chat');
const device = require('./services/device');
const data = require('./services/data');
const shells = require('./services/shells');
const bridge = require('./services/bridge');
const tray = require('./services/tray');
const procstats = require('./services/procstats');
const filesExtra = require('./services/files-extra');
const accounts = require('./services/accounts');
const storage = require('./services/storage');
storage.applyPointer(app); // honour a moved data folder before anything reads userData
let store = null;
let lifecycle = null;
filesExtra.registerSchemes(); // must run before the app is ready

const ptys = new Map();
let win;
const getWin = () => win;

// In a packaged build the files live in app.asar, which external programs cannot run from; bin/ is unpacked next to it.
const binDir = path.join(__dirname, '..', 'bin').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

const stateFile = () => path.join(app.getPath('userData'), 'workspace.json');

function defaultShell() {
  return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'OrchestrAI',
    backgroundColor: '#111317',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // portal nodes
    },
  });
  win.setMenuBarVisibility(false);
  win.setIcon?.(tray.makeIcon(64));
  if (process.env.ORCH_DEBUG) win.webContents.on('console-message', (_e, level, message, line, src) => console.log(`[renderer:${level}] ${message} (${path.basename(src)}:${line})`));
  lifecycle?.guard(win);
  loadApp();
  if (process.env.ORCH_SMOKE_OUT) win.webContents.once('did-finish-load', () => require('./smoke').run(win, process.env.ORCH_SMOKE_OUT));
}

const loadApp = () => win && !win.isDestroyed() && win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
const loadRecovery = (reason) => win && !win.isDestroyed() && win.loadFile(path.join(__dirname, 'renderer', 'recovery.html'), { query: { reason } });

// Portals load arbitrary sites in <webview>; keep them unprivileged.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});
app.on('will-attach-webview', (_e, webPreferences) => {
  delete webPreferences.preload;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
});

// node-pty on Windows does not search PATH for bare names or run .cmd/.bat shims, so resolve them here.
function resolveCommand(command, args) {
  if (process.platform !== 'win32') return { command, args };
  // A bare name like "npm" also exists as an extensionless sh script on PATH; only try real Windows executables.
  const exts = /\.[a-z0-9]{1,4}$/i.test(command) ? [''] : ['.exe', '.com', '.cmd', '.bat'];
  const hasDir = /[\\/]/.test(command);
  const dirs = hasDir ? [''] : (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = dir ? path.join(dir, command + ext) : command + ext;
      try {
        if (!fs.statSync(candidate).isFile()) continue;
      } catch { continue; }
      // .cmd/.bat shims (npm, yarn, ...) cannot be spawned directly; run them through cmd.exe.
      if (/\.(cmd|bat)$/i.test(candidate)) return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', candidate, ...args] };
      return { command: candidate, args };
    }
  }
  return { command, args };
}

// profile: { command, args, cdFlag }; env: extra variables for this terminal.
ipcMain.handle('pty:spawn', (_e, { id, cwd, cols, rows, profile, env, maestro, peer, accountId }) => {
  if (ptys.has(id)) return { ok: true, reused: true };
  const dir = cwd && fs.existsSync(cwd) ? cwd : process.env.USERPROFILE || process.env.HOME;
  let args = Array.isArray(profile?.args) ? [...profile.args] : [];
  // WSL takes its start directory as an argument rather than a process cwd.
  if (profile?.cdFlag && cwd) {
    const sep = args.findIndex((a) => a === '--' || a === '--exec' || a === '-e'); // options must precede the command
    args = sep < 0 ? [...args, '--cd', cwd] : [...args.slice(0, sep), '--cd', cwd, ...args.slice(sep)];
  }
  const requested = profile?.command || defaultShell();
  const { command, args: finalArgs } = resolveCommand(requested, args);
  args = finalArgs;
  let p;
  try {
    p = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: profile?.cdFlag ? undefined : dir,
      env: { ...process.env, ...(env || {}), ...accounts.envFor(accountId), TERM_PROGRAM: 'OrchestrAI', ...(maestro || peer ? bridge.envFor(id, binDir, maestro ? 'maestro' : 'peer') : {}) },
    });
  } catch (err) {
    return { ok: false, error: `${requested}: ${String(err.message || err)}` };
  }
  p.onData((data) => {
    try { win.webContents.send('pty:data', id, data); } catch {}
  });
  p.onExit(({ exitCode }) => {
    // A restarted terminal reuses its id; ignore the exit of the process it replaced.
    if (ptys.get(id) !== p) return;
    ptys.delete(id);
    try { win.webContents.send('pty:exit', id, exitCode); } catch {}
  });
  p.startedAt = Date.now();
  ptys.set(id, p);
  return { ok: true, pid: p.pid };
});
ipcMain.on('pty:write', (_e, id, data) => ptys.get(id)?.write(data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  try { ptys.get(id)?.resize(cols, rows); } catch {}
});
ipcMain.on('pty:kill', (_e, id) => { const p = ptys.get(id); ptys.delete(id); try { p?.kill(); } catch {} });
ipcMain.handle('pty:send', (_e, id, text) => {
  const p = ptys.get(id);
  if (!p) return false;
  p.write(text);
  return true;
});

// Task Manager: CPU, memory and foreground process of every live terminal's process tree.
ipcMain.handle('pty:stats', async () => {
  const targets = [...ptys].map(([id, p]) => ({ id, pid: p.pid }));
  try {
    const r = await procstats.sample(targets);
    for (const [id, p] of ptys) if (r.procs[id]) r.procs[id].startedAt = p.startedAt;
    return r;
  } catch (err) { return { error: String(err.message || err), procs: {} }; }
});
// Ends the foreground process of a terminal (never the shell itself; use Restart for that).
ipcMain.handle('pty:killForeground', async (_e, id) => {
  const p = ptys.get(id);
  if (!p) return false;
  const r = (await procstats.sample([{ id, pid: p.pid }])).procs[id];
  if (!r?.fg || r.fg.pid === p.pid) return false;
  try { process.kill(r.fg.pid); return true; } catch { return false; }
});

ipcMain.handle('workspace:load', () => {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return null; }
});
ipcMain.handle('workspace:save', (_e, data) => {
  if (store?.isLocked()) return;
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(data, null, 2));
});
// Used on window unload, when async IPC may not get to run.
ipcMain.on('workspace:saveSync', (e, data) => {
  if (store?.isLocked()) { e.returnValue = true; return; }
  try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(data, null, 2)); } catch {}
  e.returnValue = true;
});
// Works regardless of which element has focus (navigator.clipboard needs a focused document).
ipcMain.handle('app:copy', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('app:notify', (_e, { title, body }) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title || 'OrchestrAI'), body: String(body || ''), silent: false });
  n.on('click', () => { const w = getWin(); if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });
  n.show();
  return true;
});
ipcMain.handle('app:runHook', (_e, { cwd, command }) => new Promise((resolve) => {
  exec(command, { cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, timeout: 5 * 60 * 1000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, timedOut: !!(err && err.killed), output: String(stdout + stderr).slice(-20000) });
  });
}));
ipcMain.handle('app:worktreeRoot', () => path.join(app.getPath('userData'), 'worktrees'));

git.register(ipcMain);
files.register(ipcMain, getWin);
filesExtra.register(ipcMain);
chat.register(ipcMain, getWin);
device.register(ipcMain);
data.register(ipcMain, getWin);
require('./services/maestri').register(ipcMain);
require('./services/usage').register(ipcMain);
require('./services/routines').register(ipcMain, getWin);
require('./services/notes').register(ipcMain, getWin);
require('./services/skills').register(ipcMain);
require('./services/configfiles').register(ipcMain);
require('./services/prs').register(ipcMain);
require('./services/ide').register(ipcMain);
require('./services/templates').register(ipcMain, getWin);
shells.register(ipcMain, require('electron').shell);
require('./services/tmux').register(ipcMain);
require('./services/portal').register(ipcMain);
require('./services/updates').register(ipcMain, getWin);
lifecycle = require('./services/lifecycle').register(ipcMain, { app, dialog: require('electron').dialog, shell: require('electron').shell, getWin, ptys, storage, loadApp, loadRecovery });
accounts.register(ipcMain);
store = storage.register(ipcMain, { app, session: require('electron').session, shell: require('electron').shell, getWin });
require('./services/sandboxes').register(ipcMain);
ipcMain.handle('app:attentionCount', (_e, n) => tray.setAttention(n));
ipcMain.on('pty:killAll', () => { for (const p of ptys.values()) p.kill(); ptys.clear(); });

app.whenReady().then(async () => {
  filesExtra.handleProtocol();
  await bridge.start(getWin, ipcMain);
  createWindow();
  if (!process.env.ORCH_NO_TRAY) tray.setup(getWin);
});
app.on('window-all-closed', () => {
  for (const p of ptys.values()) p.kill();
  chat.killAll();
  data.backupNow();
  bridge.stop();
  require('./services/routines').stop();
  app.quit();
});
