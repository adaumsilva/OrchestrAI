// Workspace persistence. The data folder itself is relocated by storage.js (storage:move); this adds
//  - a first-run marker, so the app can ask where to keep its data once, and
//  - optional per-workspace files: a workspace with `file` is written there, and workspace.json keeps only a stub.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const stateFile = () => path.join(app.getPath('userData'), 'workspace.json');
// Lives in appData (not userData) so it survives moving the data folder.
const markerFile = () => process.env.ORCH_SETUP_FILE || path.join(app.getPath('appData'), 'orchestrai-setup.json');

const isFirstRun = () => !process.env.ORCH_NO_ONBOARDING && !fs.existsSync(markerFile()) && !fs.existsSync(stateFile());
function markSetupDone() {
  try { fs.mkdirSync(path.dirname(markerFile()), { recursive: true }); fs.writeFileSync(markerFile(), JSON.stringify({ at: Date.now() })); } catch {}
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function load() {
  let data;
  try { data = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return null; }
  for (const w of data?.workspaces || []) {
    if (!w.file) continue;
    // A missing file keeps the stub and is flagged, so the next save does not overwrite anything.
    try { Object.assign(w, JSON.parse(fs.readFileSync(w.file, 'utf8')), { file: w.file, missing: false }); } catch { w.missing = true; }
  }
  return data;
}

function save(data) {
  let out = data;
  if (Array.isArray(data?.workspaces)) {
    out = {
      ...data,
      workspaces: data.workspaces.map((w) => {
        if (!w.file || w.missing) return w;
        try {
          writeAtomic(w.file, JSON.stringify(w, null, 2));
          return { id: w.id, name: w.name, dir: w.dir, profileId: w.profileId, ide: w.ide, file: w.file, active: w.active, floors: [] };
        } catch { return w; } // folder gone or read-only: keep it in the main file rather than lose it
      }),
    };
  }
  writeAtomic(stateFile(), JSON.stringify(out, null, 2));
}

function register(ipcMain, { dialog, getWin }) {
  ipcMain.handle('workspace:firstRun', () => ({ firstRun: isFirstRun(), dir: app.getPath('userData') }));
  ipcMain.handle('workspace:setupDone', () => { markSetupDone(); return true; });
  ipcMain.handle('workspace:pickFolder', async (_e, title) => {
    const r = await dialog.showOpenDialog(getWin(), { title: title || 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  // Where a new workspace's file would go: <folder>/<name>.orchestrai.json, never overwriting another file.
  ipcMain.handle('workspace:fileFor', (_e, folder, name) => {
    const base = String(name || 'workspace').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'workspace';
    let file = path.join(folder, `${base}.orchestrai.json`), i = 2;
    while (fs.existsSync(file)) file = path.join(folder, `${base} (${i++}).orchestrai.json`);
    return file;
  });
}

module.exports = { register, load, save, stateFile };
