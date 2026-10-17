const fs = require('fs');
const os = require('os');
const path = require('path');
const { dialog, shell } = require('electron');

const MAX_READ = 1024 * 1024;
const SKIP = new Set(['node_modules', '.git']);
const watchers = new Map();

function register(ipcMain, getWin) {
  ipcMain.handle('files:list', async (_e, dir) => {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries
        .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('files:read', async (_e, file) => {
    try {
      const st = await fs.promises.stat(file);
      if (st.size > MAX_READ) return { tooLarge: true, size: st.size };
      const buf = await fs.promises.readFile(file);
      if (buf.includes(0)) return { binary: true, size: st.size };
      return { content: buf.toString('utf8') };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('files:write', async (_e, file, content) => {
    try {
      await fs.promises.writeFile(file, content, 'utf8');
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('files:create', async (_e, target, isDir) => {
    try {
      if (isDir) await fs.promises.mkdir(target, { recursive: true });
      else await fs.promises.writeFile(target, '', { flag: 'wx' });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('files:rename', async (_e, from, to) => {
    try {
      await fs.promises.rename(from, to);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('files:trash', async (_e, target) => {
    try {
      await shell.trashItem(target);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('files:reveal', (_e, target) => shell.showItemInFolder(target));
  // Open with the default application; resolves to '' on success or an error message.
  ipcMain.handle('files:open', (_e, target) => (fs.existsSync(target) ? shell.openPath(target) : 'The file no longer exists.'));

  ipcMain.handle('files:search', async (_e, root, query) => {
    const q = String(query || '').toLowerCase();
    if (!q) return [];
    const results = [];
    const queue = [root];
    let visited = 0;
    while (queue.length && results.length < 200 && visited < 20000) {
      const dir = queue.shift();
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const d of entries) {
        visited++;
        const full = path.join(dir, d.name);
        if (d.name.toLowerCase().includes(q)) results.push({ path: full, isDir: d.isDirectory() });
        if (d.isDirectory() && !SKIP.has(d.name)) queue.push(full);
      }
    }
    return results;
  });

  ipcMain.handle('files:watch', (_e, id, dir) => {
    watchers.get(id)?.close();
    try {
      let timer;
      const w = fs.watch(dir, { recursive: true }, (_ev, name) => {
        // Our own `git status` can touch .git; ignoring it avoids a refresh loop.
        if (name && /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(name)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          try { getWin().webContents.send('files:changed', id); } catch {}
        }, 300);
      });
      w.on('error', () => {});
      watchers.set(id, w);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('files:unwatch', (_e, id) => {
    watchers.get(id)?.close();
    watchers.delete(id);
  });

  ipcMain.handle('files:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // Prompter attachments: pasted images/files are written to a temp folder and referenced by path.
  ipcMain.handle('files:saveAttachment', async (_e, name, base64) => {
    const dir = path.join(os.tmpdir(), 'orchestrai-attachments');
    await fs.promises.mkdir(dir, { recursive: true });
    const safe = String(name || 'attachment').replace(/[^\w.\- ]+/g, '_').slice(-80);
    const file = path.join(dir, `${Date.now().toString(36)}-${safe}`);
    await fs.promises.writeFile(file, Buffer.from(base64, 'base64'));
    return file;
  });
  ipcMain.handle('files:pickFiles', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
}

module.exports = { register };
