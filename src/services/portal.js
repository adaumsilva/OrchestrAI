// Portal helpers that need the main process: capturing a webview's pixels to a file the agents can read.
const { webContents } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

function register(ipcMain) {
  // rect is in the page's CSS pixels; omit it to capture the visible page.
  ipcMain.handle('portal:capture', async (_e, id, rect) => {
    const wc = webContents.fromId(Number(id));
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return { error: 'The portal is not available.' };
    try {
      const clip = rect && rect.width > 0 && rect.height > 0
        ? { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.round(rect.width), height: Math.round(rect.height) }
        : undefined;
      const img = await wc.capturePage(clip);
      if (img.isEmpty()) return { error: 'The capture came back empty (is the portal visible?).' };
      const dir = path.join(os.tmpdir(), 'orchestrai-attachments');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `portal-${Date.now().toString(36)}.png`);
      const png = img.toPNG();
      await fs.promises.writeFile(file, png);
      const size = img.getSize();
      return { path: file, dataUrl: 'data:image/png;base64,' + png.toString('base64'), width: size.width, height: size.height };
    } catch (e) {
      return { error: e.message };
    }
  });
  const portalWc = (id) => {
    const wc = webContents.fromId(Number(id));
    return wc && !wc.isDestroyed() && wc.getType() === 'webview' ? wc : null;
  };
  // Real key presses (Enter submits forms, Tab moves between fields) rather than synthetic page events.
  // key is an Electron keyCode name or a single character; modifiers: shift, control, alt, meta.
  ipcMain.handle('portal:key', async (_e, id, key, modifiers) => {
    const wc = portalWc(id);
    if (!wc) return { error: 'The portal is not available.' };
    const mods = (Array.isArray(modifiers) ? modifiers : []).filter((m) => ['shift', 'control', 'alt', 'meta'].includes(m));
    const k = String(key || '');
    if (!k) return { error: 'No key given.' };
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods });
    if (k === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13), modifiers: mods });
    else if (k.length === 1 && !mods.includes('control') && !mods.includes('meta')) wc.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods });
    return { ok: true };
  });
  // Inserts text at the focused element as real input, which rich editors (contenteditable, ProseMirror, Draft...) accept.
  ipcMain.handle('portal:insertText', async (_e, id, text) => {
    const wc = portalWc(id);
    if (!wc) return { error: 'The portal is not available.' };
    wc.focus();
    await wc.insertText(String(text ?? ''));
    return { ok: true };
  });
}

module.exports = { register };
