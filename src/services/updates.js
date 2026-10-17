// Update checks through electron-updater. Updates exist only for installed (packaged) builds that were published with a
// release feed (see the build.publish section of package.json); from source the service reports that plainly.
// Nothing is downloaded without an explicit click, and release notes are shown as plain text.
const { app } = require('electron');

const state = { status: 'idle', version: '', notes: '', percent: 0, error: '', current: '' };
let updater = null;
let wired = false;
let auto = false;
let autoTimer = null;
let send = () => {};

// Tests substitute a stand-in with ORCH_UPDATER_MODULE; otherwise the real updater is used when packaged.
function getUpdater() {
  if (updater) return updater;
  try {
    if (process.env.ORCH_UPDATER_MODULE) updater = require(process.env.ORCH_UPDATER_MODULE);
    else if (app.isPackaged) updater = require('electron-updater').autoUpdater;
  } catch (e) { state.error = e.message; }
  return updater;
}

// Release notes arrive as HTML, markdown or a list of entries; keep readable plain text only.
function plainNotes(notes) {
  const raw = Array.isArray(notes) ? notes.map((n) => `${n.version ? n.version + ': ' : ''}${n.note || ''}`).join('\n\n') : String(notes || '');
  return raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

function set(patch) {
  Object.assign(state, patch);
  send({ ...state });
}

function wire(u) {
  if (wired) return;
  wired = true;
  u.autoDownload = false;
  u.autoInstallOnAppQuit = false;
  u.on('checking-for-update', () => set({ status: 'checking', error: '' }));
  u.on('update-available', (info) => set({ status: 'available', version: String(info?.version || ''), notes: plainNotes(info?.releaseNotes), percent: 0 }));
  u.on('update-not-available', () => set({ status: 'none', version: '', notes: '' }));
  u.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p?.percent || 0) }));
  u.on('update-downloaded', (info) => set({ status: 'ready', version: String(info?.version || state.version), percent: 100 }));
  u.on('error', (err) => set({ status: 'error', error: String(err?.message || err).split('\n')[0].slice(0, 300) }));
}

async function check() {
  state.current = app.getVersion();
  const u = getUpdater();
  if (!u) {
    set({ status: 'dev', error: '', version: '', notes: '' });
    return { ...state };
  }
  wire(u);
  try { await u.checkForUpdates(); } catch (e) { set({ status: 'error', error: String(e.message || e).split('\n')[0].slice(0, 300) }); }
  return { ...state };
}

function register(ipcMain, getWin) {
  send = (s) => { try { getWin()?.webContents.send('updates:status', s); } catch {} };
  state.current = app.getVersion();
  ipcMain.handle('updates:status', () => ({ ...state, current: app.getVersion() }));
  ipcMain.handle('updates:check', () => check());
  ipcMain.handle('updates:download', async () => {
    const u = getUpdater();
    if (!u || state.status !== 'available') return { ...state };
    set({ status: 'downloading', percent: 0 });
    try { await u.downloadUpdate(); } catch (e) { set({ status: 'error', error: String(e.message || e).split('\n')[0].slice(0, 300) }); }
    return { ...state };
  });
  ipcMain.handle('updates:install', () => {
    const u = getUpdater();
    if (!u || state.status !== 'ready') return false;
    setTimeout(() => u.quitAndInstall(), 200);
    return true;
  });
  // The renderer owns the preference; main only schedules the first background check (never a download).
  ipcMain.handle('updates:setAuto', (_e, on) => {
    auto = !!on;
    clearTimeout(autoTimer);
    if (auto && (app.isPackaged || process.env.ORCH_UPDATER_MODULE)) autoTimer = setTimeout(() => { if (auto) check(); }, Number(process.env.ORCH_UPDATE_DELAY_MS) || 30000);
    return auto;
  });
}

module.exports = { register, plainNotes };
