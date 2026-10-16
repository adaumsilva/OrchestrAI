const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const procs = new Map();

function kill(p) {
  if (!p || p.killed) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else p.kill('SIGTERM');
}


// ---------- agent transcripts (Claude Code session files), used by a terminal's Chat face ----------
// Inferred layout: ~/.claude/projects/<cwd with non-alphanumerics replaced by "-">/<session>.jsonl, one JSON event per line.
const projectsDir = () => path.join(os.homedir(), '.claude', 'projects');
const slug = (cwd) => String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

function threadDir(cwd) {
  try {
    const want = slug(cwd);
    const hit = fs.readdirSync(projectsDir()).find((d) => d.toLowerCase() === want);
    return hit ? path.join(projectsDir(), hit) : null;
  } catch { return null; }
}

const transcriptFile = (cwd, id) => {
  const dir = threadDir(cwd);
  if (!dir || id !== path.basename(id) || !id.endsWith('.jsonl')) return null;
  return path.join(dir, id);
};

const stripTags = (t) => t.replace(/<(system-reminder|ide_[a-z_]+|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, '').trim();

function toolSummary(part) {
  const i = part.input || {};
  const arg = i.command || i.file_path || i.path || i.pattern || i.url || i.description || i.query || '';
  return `${part.name}${arg ? ': ' + String(arg).split('\n')[0].slice(0, 120) : ''}`;
}

const parseCache = new Map(); // file -> { mtime, messages }
function parseTranscript(file) {
  const st = fs.statSync(file);
  const c = parseCache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.messages;
  const messages = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if ((ev.type !== 'user' && ev.type !== 'assistant') || ev.isSidechain || !ev.message) continue;
    const content = ev.message.content;
    const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const part of parts) {
      if (part.type === 'text') {
        const text = ev.type === 'user' ? stripTags(part.text || '') : (part.text || '').trim();
        if (text) messages.push({ role: ev.type, text, ts: ev.timestamp });
      } else if (part.type === 'tool_use') messages.push({ role: 'tool', text: toolSummary(part), ts: ev.timestamp });
    }
  }
  parseCache.set(file, { mtime: st.mtimeMs, messages });
  if (parseCache.size > 20) parseCache.delete(parseCache.keys().next().value);
  return messages;
}

function firstPrompt(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type !== 'user' || ev.isSidechain) continue;
      const c = ev.message?.content;
      const text = stripTags(typeof c === 'string' ? c : (c || []).filter((p) => p.type === 'text').map((p) => p.text).join(' '));
      if (text) return text.replace(/\s+/g, ' ').slice(0, 80);
    }
  } catch {}
  return '';
}

function registerTranscripts(ipcMain) {
  ipcMain.handle('chat:threads', (_e, cwd) => {
    const dir = threadDir(cwd);
    if (!dir) return [];
    return fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((id) => {
      const st = fs.statSync(path.join(dir, id));
      return { id, mtime: st.mtimeMs, size: st.size };
    }).sort((a, b) => b.mtime - a.mtime).slice(0, 50).map((t) => ({ ...t, title: firstPrompt(path.join(dir, t.id)) || t.id.slice(0, 8) }));
  });
  // Pages from the end: `before` is the exclusive end index (default: the end), `limit` how many messages.
  ipcMain.handle('chat:messages', (_e, { cwd, id, before, limit = 60 }) => {
    const file = transcriptFile(cwd, id);
    if (!file) return { error: 'Thread not found' };
    try {
      const all = parseTranscript(file);
      const end = Math.min(before ?? all.length, all.length), start = Math.max(0, end - limit);
      return { total: all.length, start, messages: all.slice(start, end), mtime: fs.statSync(file).mtimeMs };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('chat:stat', (_e, { cwd, id }) => {
    const file = transcriptFile(cwd, id);
    try { return file ? { mtime: fs.statSync(file).mtimeMs } : null; } catch { return null; }
  });
  ipcMain.handle('chat:search', (_e, { cwd, query }) => {
    const q = String(query || '').toLowerCase();
    const dir = threadDir(cwd);
    if (!q || !dir) return [];
    const hits = [];
    for (const id of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
      let msgs; try { msgs = parseTranscript(path.join(dir, id)); } catch { continue; }
      msgs.forEach((m, idx) => {
        if (m.role === 'tool' || hits.length >= 80) return;
        const at = m.text.toLowerCase().indexOf(q);
        if (at >= 0) hits.push({ id, idx, role: m.role, snippet: m.text.slice(Math.max(0, at - 40), at + 100).replace(/\s+/g, ' ') });
      });
    }
    return hits;
  });
}

function register(ipcMain, getWin) {
  registerTranscripts(ipcMain);
  const send = (channel, ...args) => {
    try { getWin().webContents.send(channel, ...args); } catch {}
  };

  // Runs an agent CLI once per message: the prompt goes to stdin, stdout streams back.
  ipcMain.handle('chat:send', (_e, { id, command, cwd, prompt }) => {
    kill(procs.get(id));
    const p = spawn(command, { cwd: cwd || undefined, shell: true, windowsHide: true, env: process.env });
    procs.set(id, p);
    p.stdout.on('data', (d) => send('chat:data', id, d.toString(), false));
    p.stderr.on('data', (d) => send('chat:data', id, d.toString(), true));
    p.on('error', (err) => send('chat:data', id, String(err.message), true));
    p.on('close', (code) => {
      if (procs.get(id) === p) procs.delete(id);
      send('chat:done', id, code);
    });
    p.stdin.on('error', () => {});
    p.stdin.end(prompt);
    return true;
  });

  ipcMain.handle('chat:interrupt', (_e, id) => {
    kill(procs.get(id));
    procs.delete(id);
  });
}

function killAll() {
  for (const p of procs.values()) kill(p);
}

module.exports = { register, killAll };
