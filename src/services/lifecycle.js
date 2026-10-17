// App lifecycle: recovery when the interface crashes, the diagnostic report, and update checks.
// Terminals live in the main process, so they keep running while the interface is replaced by the recovery screen or reloaded.
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- log ring (kept for the diagnostic report) ----------
const RING = [];
const RING_MAX = 200;

// Remove anything that looks like a credential or personal path from text that goes into a report.
function redact(text) {
  let s = String(text == null ? '' : text);
  const home = os.homedir();
  if (home && home.length > 3) s = s.split(home).join('~');
  s = s.replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|authorization)[A-Za-z0-9_]*)(["']?)\s*([=:])\s*("[^"]*"|'[^']*'|\S+)/gi, '$1$2$3[redacted]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]');
  return s.length > 600 ? s.slice(0, 600) + '…' : s;
}

function note(level, message, where) {
  RING.push({ at: new Date().toISOString(), level, message: redact(message), where: where ? String(where).split(/[\\/]/).pop() : '' });
  if (RING.length > RING_MAX) RING.shift();
}

// Counts and versions only: never node titles, commands, note text, file contents, environment variables or keys.
function summarizeWorkspace(file) {
  const out = { workspaces: 0, floors: 0, nodes: {}, ropes: 0, terminals: 0 };
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const floors = s.workspaces ? s.workspaces.flatMap((w) => w.floors || []) : s.floors || [];
    out.workspaces = s.workspaces ? s.workspaces.length : 1;
    out.floors = floors.length;
    for (const f of floors) {
      out.ropes += (f.ropes || []).length;
      for (const n of f.nodes || []) out.nodes[n.kind] = (out.nodes[n.kind] || 0) + 1;
    }
    out.terminals = out.nodes.terminal || 0;
    out.settings = { language: (s.settings && s.settings.language) || 'system', ropeRouting: (s.settings && s.settings.ropeRouting) || 'cable' };
  } catch { out.error = 'workspace file not readable'; }
  return out;
}

function buildReport({ app, process: proc = process, storageUsage, workspaceFile, ptyCount }) {
  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    app: { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged },
    versions: { electron: proc.versions.electron, chrome: proc.versions.chrome, node: proc.versions.node, v8: proc.versions.v8 },
    system: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length, totalMemMB: Math.round(os.totalmem() / 1048576), freeMemMB: Math.round(os.freemem() / 1048576), locale: app.getLocale() },
    process: { rssMB: Math.round(proc.memoryUsage().rss / 1048576), uptimeSec: Math.round(proc.uptime()) },
    runningTerminals: ptyCount,
    storage: storageUsage ? storageUsage.rows.map((r) => ({ category: r.id, bytes: r.bytes })) : [],
    workspace: summarizeWorkspace(workspaceFile),
    recentLog: RING.slice(-100),
    note: 'This report contains versions, counts and recent warnings only. It has no tokens, commands, notes or file contents.',
  };
}

function register(ipcMain, { app, dialog, shell, getWin, ptys, storage, loadApp, loadRecovery }) {
  const stateFile = () => path.join(app.getPath('userData'), 'workspace.json');
  const report = () => buildReport({ app, storageUsage: storage.usage(app.getPath('userData')), workspaceFile: stateFile(), ptyCount: ptys.size });

  ipcMain.handle('app:flags', () => ({ noOnboarding: !!process.env.ORCH_NO_ONBOARDING, packaged: app.isPackaged, version: app.getVersion() }));
  ipcMain.handle('app:ptyCount', () => ptys.size);
  ipcMain.handle('app:reloadApp', () => { loadApp(); return true; });
  ipcMain.handle('app:rendererError', (_e, message, where) => { note('error', message, where); return true; });

  ipcMain.handle('app:saveDiagnostics', async (_e, opts = {}) => {
    const data = JSON.stringify(report(), null, 2);
    let file = null;
    if (opts.path && process.env.ORCH_E2E === '1') file = opts.path; // tests only
    else {
      const r = await dialog.showSaveDialog(getWin(), { title: 'Save diagnostic report', defaultPath: `orchestrai-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return { canceled: true };
      file = r.filePath;
    }
    fs.writeFileSync(file, data);
    return { path: file, bytes: data.length };
  });
  ipcMain.handle('app:diagnostics', () => report());

  // Crash and hang handling for a window.
  function guard(win) {
    const wc = win.webContents;
    wc.on('console-message', (...args) => {
      const e = args[0] || {};
      const level = typeof e.level === 'number' ? e.level : (typeof e.level === 'string' ? ({ verbose: 0, info: 1, warning: 2, error: 3 })[e.level] : args[1]);
      const message = e.message !== undefined ? e.message : args[2];
      const line = e.sourceId || args[4];
      if (level >= 2) note(level >= 3 ? 'error' : 'warn', message, line);
    });
    wc.on('render-process-gone', (_e, details) => {
      note('error', `renderer gone: ${details.reason} (${details.exitCode})`);
      if (details.reason === 'clean-exit') return;
      loadRecovery(`The interface stopped unexpectedly (${details.reason}).`);
    });
    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted by a newer navigation
      note('error', `load failed: ${desc} (${code})`);
      loadRecovery(`The interface could not load (${desc}).`);
    });
    win.on('unresponsive', async () => {
      note('warn', 'window unresponsive');
      if (process.env.ORCH_E2E === '1') return;
      const r = await dialog.showMessageBox(win, { type: 'warning', message: 'OrchestrAI is not responding', detail: 'Your terminals keep running. You can wait, or reload the interface.', buttons: ['Wait', 'Reload interface'], defaultId: 0 });
      if (r.response === 1) loadApp();
    });
  }
  // The monitor variant observes without changing how Electron reacts to the error.
  process.on('uncaughtExceptionMonitor', (err) => { note('error', err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err)); });
  return { guard };
}

module.exports = { register, redact, note, buildReport, summarizeWorkspace };
