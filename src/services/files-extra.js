// File tree extras: media served through a restricted protocol, content search, and file copy/move.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { protocol, net } = require('electron');
const { pathToFileURL } = require('url');

const SCHEME = 'orchestrai-file';
const MEDIA = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image', '.bmp': 'image', '.ico': 'image', '.avif': 'image',
  '.pdf': 'pdf',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video', '.ogv': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.flac': 'audio',
};
const SKIP = new Set(['node_modules', '.git']);
const roots = new Set(); // folders the renderer has opened a file tree on; media is only served from below them

const mediaKind = (file) => MEDIA[path.extname(file).toLowerCase()] || null;

const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const allowed = (file) => {
  const real = path.resolve(file);
  return mediaKind(real) && [...roots].some((r) => inside(r, real));
};

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } }]);
}

function handleProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let file;
    try { file = new URL(request.url).searchParams.get('p'); } catch { file = null; }
    if (!file || !path.isAbsolute(file) || !allowed(file)) return new Response('Forbidden', { status: 403 });
    try {
      const real = await fs.promises.realpath(file); // a symlink must not lead out of the allowed folders
      if (!allowed(real)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(real).toString(), { headers: request.headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ripgrep when it is installed (fast, respects .gitignore); otherwise a bounded walk in JS.
function ripgrep(root, query, caseSensitive) {
  return new Promise((resolve) => {
    const args = ['--json', '--max-count', '5', '--max-filesize', '1M', '--glob', '!.git', '--glob', '!node_modules', ...(caseSensitive ? [] : ['-i']), '-F', '--', query, root];
    execFile('rg', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && err.code === 'ENOENT') return resolve(null);
      const out = [];
      for (const line of String(stdout || '').split(/\r?\n/)) {
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.type === 'match') out.push({ path: m.data.path.text, line: m.data.line_number, text: m.data.lines.text.replace(/\r?\n$/, '').slice(0, 300) });
        } catch {}
        if (out.length >= 300) break;
      }
      resolve(out);
    });
  });
}

async function walkGrep(root, query, caseSensitive) {
  const q = caseSensitive ? query : query.toLowerCase();
  const out = [];
  const queue = [root];
  let visited = 0;
  while (queue.length && out.length < 300 && visited < 20000) {
    const dir = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of entries) {
      visited++;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) { if (!SKIP.has(d.name)) queue.push(full); continue; }
      if (!d.isFile() || mediaKind(full)) continue;
      let buf;
      try {
        const st = await fs.promises.stat(full);
        if (st.size > 1024 * 1024) continue;
        buf = await fs.promises.readFile(full);
      } catch { continue; }
      if (buf.includes(0)) continue;
      const lines = buf.toString('utf8').split(/\r?\n/);
      let hits = 0;
      for (let i = 0; i < lines.length && hits < 5; i++) {
        if ((caseSensitive ? lines[i] : lines[i].toLowerCase()).includes(q)) { out.push({ path: full, line: i + 1, text: lines[i].slice(0, 300) }); hits++; }
      }
    }
  }
  return out;
}

// A name that does not collide: "a.txt" -> "a copy.txt" -> "a copy 2.txt".
function freeName(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let candidate = name, n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    n++;
    candidate = `${base} copy${n > 2 ? ' ' + (n - 1) : ''}${ext}`;
  }
  return path.join(dir, candidate);
}

function register(ipcMain) {
  ipcMain.handle('files:allowRoot', (_e, root) => {
    if (root && path.isAbsolute(root)) {
      roots.add(path.resolve(root));
      // Served files are checked after symlinks and 8.3 short names are resolved, so the resolved root must be known too.
      try { roots.add(fs.realpathSync.native(root)); } catch {}
    }
    return true;
  });

  ipcMain.handle('files:media', (_e, file) => {
    if (!file || !path.isAbsolute(file)) return null;
    const kind = mediaKind(file);
    if (!kind) return null;
    if (!allowed(file)) return { error: 'Outside the opened folders.' };
    return { kind, url: `${SCHEME}://f/?p=${encodeURIComponent(path.resolve(file))}` };
  });

  ipcMain.handle('files:grep', async (_e, root, query, opts = {}) => {
    query = String(query || '');
    if (!query || !root) return { results: [], engine: 'none' };
    const viaRg = await ripgrep(root, query, !!opts.caseSensitive);
    if (viaRg) return { results: viaRg, engine: 'ripgrep' };
    return { results: await walkGrep(root, query, !!opts.caseSensitive), engine: 'builtin' };
  });

  // mode 'copy' | 'move'; returns the new paths. Refuses to copy a folder into itself.
  ipcMain.handle('files:transfer', async (_e, sources, destDir, mode) => {
    const made = [];
    try {
      if (!(await fs.promises.stat(destDir)).isDirectory()) return { error: 'The destination is not a folder.' };
      for (const src of sources || []) {
        if (!fs.existsSync(src)) return { error: `${src} no longer exists.`, made };
        if (inside(src, destDir) && fs.statSync(src).isDirectory()) return { error: 'A folder cannot be copied into itself.', made };
        const same = path.dirname(src) === path.resolve(destDir);
        if (mode === 'move' && same) { made.push(src); continue; }
        const to = freeName(destDir, path.basename(src));
        if (mode === 'move') {
          try { await fs.promises.rename(src, to); } catch (e) {
            if (e.code !== 'EXDEV') throw e;
            await fs.promises.cp(src, to, { recursive: true }); await fs.promises.rm(src, { recursive: true, force: true });
          }
        } else await fs.promises.cp(src, to, { recursive: true });
        made.push(to);
      }
      return { ok: true, made };
    } catch (e) {
      return { error: e.message, made };
    }
  });
}

module.exports = { register, registerSchemes, handleProtocol, mediaKind };
