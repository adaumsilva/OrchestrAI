// Layout templates: reusable canvas arrangements (nodes, ropes, positions, commands, roles; never scrollback).
// Stored in <userData>/templates.json; exported and imported as JSON files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');

const file = () => path.join(app.getPath('userData'), 'templates.json');
const uid = () => crypto.randomBytes(4).toString('hex');
const FORMAT = 'orchestrai-templates';

let list = null;
function load() {
  if (list) return list;
  try { list = JSON.parse(fs.readFileSync(file(), 'utf8')); if (!Array.isArray(list)) list = []; } catch { list = []; }
  return list;
}
function persist() { fs.writeFileSync(file(), JSON.stringify(list)); }

// Shape check for anything that comes from a file or the renderer.
function clean(t) {
  if (!t || typeof t.name !== 'string' || !Array.isArray(t.nodes) || !t.nodes.length) throw new Error('Not a layout template.');
  const ids = new Set();
  const nodes = t.nodes.map((n) => {
    if (!n || typeof n.id !== 'string' || typeof n.kind !== 'string') throw new Error('Template has a malformed node.');
    ids.add(n.id);
    return { id: n.id, kind: n.kind, title: String(n.title || ''), x: +n.x || 0, y: +n.y || 0, w: +n.w || 300, h: +n.h || 200, data: n.data && typeof n.data === 'object' ? n.data : {} };
  });
  const ropes = (Array.isArray(t.ropes) ? t.ropes : []).filter((r) => r && ids.has(r.a) && ids.has(r.b) && !r.rf).map((r) => ({ a: r.a, b: r.b }));
  return { name: String(t.name).trim().slice(0, 80) || 'Layout', nodes, ropes };
}

function uniqueName(name) {
  const names = new Set(load().map((t) => t.name));
  if (!names.has(name)) return name;
  for (let i = 2; ; i++) if (!names.has(`${name} (${i})`)) return `${name} (${i})`;
}

function save(input) {
  const c = clean(input);
  load();
  if (input.id) {
    const t = list.find((x) => x.id === input.id);
    if (!t) throw new Error('No such template.');
    Object.assign(t, c, { name: input.keepName === false ? c.name : t.name, updated: Date.now() });
    persist();
    return t;
  }
  const t = { id: uid(), ...c, name: uniqueName(c.name), created: Date.now() };
  list.push(t);
  persist();
  return t;
}

function exportTo(target, ids) {
  const items = load().filter((t) => !ids || ids.includes(t.id));
  fs.writeFileSync(target, JSON.stringify({ format: FORMAT, version: 1, templates: items.map(({ name, nodes, ropes }) => ({ name, nodes, ropes })) }, null, 2));
  return items.length;
}

function importFrom(source) {
  const j = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (j.format !== FORMAT || !Array.isArray(j.templates)) throw new Error('Not an OrchestrAI layout file.');
  const added = j.templates.map((t) => save({ name: t.name, nodes: t.nodes, ropes: t.ropes }));
  return added.length;
}

function register(ipcMain, getWin) {
  ipcMain.handle('templates:list', () => load());
  ipcMain.handle('templates:save', (_e, input) => { try { return { ok: true, template: save(input) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('templates:rename', (_e, id, name) => {
    const t = load().find((x) => x.id === id);
    if (!t || !String(name).trim()) return false;
    t.name = String(name).trim().slice(0, 80); persist(); return true;
  });
  ipcMain.handle('templates:remove', (_e, id) => { list = load().filter((t) => t.id !== id); persist(); return true; });
  ipcMain.handle('templates:export', async (_e, ids) => {
    const r = await dialog.showSaveDialog(getWin(), { title: 'Export layouts', defaultPath: 'orchestrai-layouts.json', filters: [{ name: 'OrchestrAI layouts', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    try { return { count: exportTo(r.filePath, ids), path: r.filePath }; } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('templates:import', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Import layouts', properties: ['openFile'], filters: [{ name: 'OrchestrAI layouts', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    try { return { count: importFrom(r.filePaths[0]) }; } catch (e) { return { error: e.message }; }
  });
}

module.exports = { register, save, exportTo, importFrom, load };
