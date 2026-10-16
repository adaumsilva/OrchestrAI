// Workspace export/import and rolling automatic backups.
const { app, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_BACKUPS = 20;
const BACKUP_EVERY_MS = 10 * 60 * 1000;

const backupDir = () => path.join(app.getPath('userData'), 'backups');
const stateFile = () => path.join(app.getPath('userData'), 'workspace.json');

function validate(data) {
  if (!data || !Array.isArray(data.floors) || !data.floors.length) throw new Error('Not an OrchestrAI workspace file.');
  for (const f of data.floors) {
    if (!f || typeof f.id !== 'string' || !Array.isArray(f.nodes) || !Array.isArray(f.ropes)) throw new Error('Workspace file is malformed.');
  }
  return data;
}

function listBackups() {
  try {
    return fs.readdirSync(backupDir())
      .filter((n) => n.endsWith('.json'))
      .sort()
      .reverse()
      .map((name) => ({ name, size: fs.statSync(path.join(backupDir(), name)).size, mtime: fs.statSync(path.join(backupDir(), name)).mtimeMs }));
  } catch {
    return [];
  }
}

function backupNow() {
  let current;
  try { current = fs.readFileSync(stateFile(), 'utf8'); } catch { return null; }
  const existing = listBackups();
  // Skip when nothing changed since the last backup.
  if (existing[0] && fs.readFileSync(path.join(backupDir(), existing[0].name), 'utf8') === current) return null;
  fs.mkdirSync(backupDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `workspace-${stamp}.json`;
  fs.writeFileSync(path.join(backupDir(), name), current);
  for (const old of listBackups().slice(MAX_BACKUPS)) fs.rmSync(path.join(backupDir(), old.name), { force: true });
  return name;
}

function register(ipcMain, getWin) {
  ipcMain.handle('data:export', async (_e, state) => {
    const r = await dialog.showSaveDialog(getWin(), {
      title: 'Export workspace',
      defaultPath: 'orchestrai-workspace.json',
      filters: [{ name: 'OrchestrAI workspace', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(state, null, 2));
    return { path: r.filePath };
  });

  ipcMain.handle('data:import', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Import workspace', properties: ['openFile'], filters: [{ name: 'Workspace files', extensions: ['json', 'maestri', 'maestribak'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    try {
      const file = r.filePaths[0];
      const head = fs.readFileSync(file).subarray(0, 4).toString('latin1');
      // Maestri backups are zip archives; a bare Maestri workspace.json wraps its data in a "payload" key.
      if (head.startsWith('PK') || /\.maestri(bak)?$/i.test(file) || JSON.parse(fs.readFileSync(file, 'utf8')).payload) return require('./maestri').convertFile(file);
      return { data: validate(JSON.parse(fs.readFileSync(file, 'utf8'))) };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('data:backups', () => listBackups());
  ipcMain.handle('data:restore', (_e, name) => {
    try {
      if (name !== path.basename(name)) throw new Error('Invalid backup name');
      backupNow(); // keep what we are about to replace
      return { data: validate(JSON.parse(fs.readFileSync(path.join(backupDir(), name), 'utf8'))) };
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('data:backupNow', () => backupNow());
  ipcMain.handle('data:revealBackups', () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    return shell.openPath(backupDir());
  });

  setInterval(backupNow, BACKUP_EVERY_MS).unref();
  setTimeout(backupNow, 30 * 1000).unref();
}

module.exports = { register, backupNow };
