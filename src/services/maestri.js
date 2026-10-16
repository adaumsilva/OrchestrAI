// Import of workspaces saved by the Maestri desktop app (read-only; nothing is written to its folder).
// The on-disk layout was inferred from the files it leaves in the user's home directory.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = () => path.join(os.homedir(), '.maestri');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const uid = () => crypto.randomBytes(4).toString('hex');

function list() {
  let manifest;
  try { manifest = readJson(path.join(root(), 'manifest.json')); } catch { return { dir: root(), workspaces: [] }; }
  const workspaces = [];
  for (const w of manifest.workspaces || []) {
    try {
      const file = path.join(root(), w.path);
      const p = readJson(file).payload || {};
      workspaces.push({ id: w.id, name: w.name || p.name, nodes: (p.nodes || []).length, dir: p.workingDirectory || '', mtime: fs.statSync(file).mtimeMs });
    } catch { /* unreadable workspace: skip */ }
  }
  return { dir: root(), workspaces };
}

const unwrap = (content) => {
  const kind = Object.keys(content || {})[0];
  return { kind, d: content?.[kind]?._0 || {} };
};

function readNote(wsDir, fileName) {
  if (!fileName || fileName !== path.basename(fileName)) return '';
  try { return fs.readFileSync(path.join(wsDir, 'notes', fileName), 'utf8'); } catch { return ''; }
}

// Minimal zip reader (stored/deflate) for .maestribak archives; returns Map name -> Buffer.
function unzip(buf) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid Maestri archive.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt archive.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
  }
  return files;
}

// Parses a file the user picked: a Maestri backup archive (.maestribak/.maestri) or a bare workspace.json.
function convertFile(file) {
  const buf = fs.readFileSync(file);
  let payload, noteText;
  if (buf.readUInt32LE(0) === 0x04034b50) {
    const files = unzip(buf);
    const ws = files.get('workspace.json');
    if (!ws) throw new Error('No workspace.json inside the archive.');
    payload = JSON.parse(ws.toString('utf8')).payload;
    noteText = (name) => (name && name === path.basename(name) && files.get('notes/' + name)?.toString('utf8')) || '';
  } else {
    payload = JSON.parse(buf.toString('utf8')).payload;
    noteText = (name) => readNote(path.dirname(file), name);
  }
  if (!payload || !Array.isArray(payload.nodes)) throw new Error('Not a Maestri workspace file.');
  return build(payload, noteText);
}

// Returns an OrchestrAI floor built from one Maestri workspace, plus a count of what could not be converted.
function convert(id) {
  const manifest = readJson(path.join(root(), 'manifest.json'));
  const entry = (manifest.workspaces || []).find((w) => w.id === id);
  if (!entry) throw new Error('Workspace not found.');
  const wsFile = path.join(root(), entry.path);
  return build(readJson(wsFile).payload || {}, (name) => readNote(path.dirname(wsFile), name), entry);
}

function build(p, noteText, entry = {}) {
  const maestriNodes = p.nodes || [];

  // Maestri positions live on a huge canvas (thousands of units from the origin); move the top-left to a small offset.
  const minX = Math.min(...maestriNodes.map((n) => n.frame[0][0]), Infinity);
  const minY = Math.min(...maestriNodes.map((n) => n.frame[0][1]), Infinity);
  const ox = Number.isFinite(minX) ? 40 - minX : 0, oy = Number.isFinite(minY) ? 40 - minY : 0;

  const ids = new Map(); // maestri node id -> new node id
  const nodes = [];
  const skipped = {};
  for (const n of maestriNodes) {
    const { kind, d } = unwrap(n.content);
    const [[x, y], [w, h]] = n.frame;
    const base = { id: uid(), x: x + ox, y: y + oy, w, h };
    let node = null;
    if (kind === 'terminal') {
      node = { ...base, kind: 'terminal', title: d.name || 'Terminal', data: { command: d.command || '', cwd: d.workingDirectory || p.workingDirectory || '', color: d.color, maestro: !!d.isManager, monitor: d.monitorWithOmbro !== false } };
    } else if (kind === 'stickyNote') {
      node = { ...base, kind: 'note', title: (d.fileName || 'Note').replace(/\.md$/i, ''), data: { text: noteText(d.fileName) } };
    } else if (kind === 'portal') {
      const src = d.source || {};
      const local = src.localFile?._0;
      const url = local ? 'file:///' + String(local).replace(/\\/g, '/').replace(/^\/+/, '') : (src.url?._0 || src.url || 'https://www.google.com');
      node = { ...base, kind: 'portal', title: d.name || 'Portal', data: { url: typeof url === 'string' ? url : 'https://www.google.com' } };
    } else if (kind === 'fileTree') {
      node = { ...base, kind: 'files', title: 'Files', data: { root: d.rootPath || d.currentPath || '', expanded: d.expandedPaths || [] } };
    } else {
      skipped[kind || 'unknown'] = (skipped[kind || 'unknown'] || 0) + 1; // note stacks are only groupings of notes already imported
      continue;
    }
    // Notes inside a Maestri stack share one position; cascade them so each stays reachable.
    const same = nodes.filter((o) => o.kind === 'note' && node.kind === 'note' && o.x - (o.dx || 0) === node.x && o.y - (o.dy || 0) === node.y).length;
    if (same) { node.x += 36 * same; node.y += 36 * same; node.dx = 36 * same; node.dy = 36 * same; }
    ids.set(n.id, node.id);
    nodes.push(node);
  }

  for (const n of nodes) { delete n.dx; delete n.dy; }
  const ropes = [];
  const link = (a, b) => {
    const A = ids.get(a), B = ids.get(b);
    if (A && B) ropes.push({ id: uid(), a: A, b: B });
  };
  for (const c of p.connections || []) link(c.terminalIdA, c.terminalIdB);
  for (const c of p.noteConnections || []) link(c.noteNodeId, c.terminalId);
  for (const c of p.portalConnections || []) link(c.portalNodeId, c.terminalId);
  for (const c of p.noteToNoteConnections || []) link(c.noteNodeIdA || c.noteIdA, c.noteNodeIdB || c.noteIdB);

  const floor = {
    id: uid(), name: p.name || entry.name || 'Maestri', dir: p.workingDirectory || '', repo: null, branch: null,
    view: { x: 0, y: 0, zoom: Math.min(1, p.canvasZoom || 1) }, nodes, ropes,
  };
  return { floor, skipped };
}

function register(ipcMain) {
  ipcMain.handle('maestri:list', () => list());
  ipcMain.handle('maestri:convert', (_e, id) => {
    try { return convert(String(id)); } catch (e) { return { error: e.message }; }
  });
}

module.exports = { register, convertFile };
