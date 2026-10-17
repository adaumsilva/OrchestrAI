// Note support: images pasted into notes are kept under <userData>/note-images and referenced as images/<name>;
// notes can be backed by a real file, which is watched so external edits show up.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');

const imageDir = () => path.join(app.getPath('userData'), 'note-images');
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const watched = new Map(); // note id -> file

function register(ipcMain, getWin) {
  ipcMain.handle('notes:saveImage', async (_e, base64, ext) => {
    const e = String(ext || 'png').toLowerCase().replace(/[^a-z]/g, '');
    if (!MIME[e]) return { error: 'Unsupported image type' };
    const buf = Buffer.from(String(base64), 'base64');
    if (!buf.length || buf.length > 20 * 1024 * 1024) return { error: 'Image is empty or larger than 20 MB' };
    await fs.promises.mkdir(imageDir(), { recursive: true });
    const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + e;
    await fs.promises.writeFile(path.join(imageDir(), name), buf);
    return { name };
  });

  // Returns a data: URL (the page's CSP only allows self and data images), or null.
  ipcMain.handle('notes:image', async (_e, name) => {
    const n = path.basename(String(name));
    const mime = MIME[path.extname(n).slice(1).toLowerCase()];
    if (!mime || n !== name) return null;
    try { return `data:${mime};base64,${(await fs.promises.readFile(path.join(imageDir(), n))).toString('base64')}`; } catch { return null; }
  });

  ipcMain.handle('notes:pickFile', async (_e, create) => {
    const filters = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];
    const r = create
      ? await dialog.showSaveDialog(getWin(), { title: 'New note file', defaultPath: 'note.md', filters })
      : await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters });
    const file = create ? r.filePath : r.filePaths?.[0];
    if (r.canceled || !file) return null;
    if (create && !fs.existsSync(file)) await fs.promises.writeFile(file, '', 'utf8');
    return file;
  });

  // Poll rather than fs.watch: editors replace files atomically, which fs.watch handles inconsistently.
  ipcMain.handle('notes:watch', (_e, id, file) => {
    const old = watched.get(id);
    if (old) fs.unwatchFile(old.file, old.fn);
    const fn = (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) { try { getWin().webContents.send('notes:changed', id); } catch {} } };
    fs.watchFile(file, { interval: 700, persistent: false }, fn);
    watched.set(id, { file, fn });
    return true;
  });
  ipcMain.handle('notes:unwatch', (_e, id) => {
    const old = watched.get(id);
    if (old) fs.unwatchFile(old.file, old.fn);
    watched.delete(id);
  });
}

module.exports = { register };
