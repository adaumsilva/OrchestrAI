// Persistent terminal sessions: probes and kills tmux sessions on the machine a terminal runs on.
// A target is { kind: 'local' | 'wsl' | 'ssh', socket, session, distro?, user?, host?, port? }; it is built by the
// renderer (tmuxTarget in settings.js) and validated again here before anything is executed.
const { execFile } = require('child_process');

const SAFE = /^[\w.-]{1,64}$/;
const HOST = /^[\w.:@\[\]-]{1,255}$/;

function validate(t) {
  if (!t || !['local', 'wsl', 'ssh'].includes(t.kind)) return 'Unsupported target';
  if (!SAFE.test(t.socket || '') || !SAFE.test(t.session || '')) return 'Invalid tmux socket or session name';
  if (t.kind === 'wsl' && !/^[^\s"'`$;&|<>]{1,128}$/.test(t.distro || '')) return 'Invalid WSL distribution';
  if (t.user && !/^[\w.@-]{1,64}$/.test(t.user)) return 'Invalid user';
  if (t.kind === 'ssh' && (!HOST.test(t.host || '') || (t.port && !/^\d{1,5}$/.test(String(t.port))))) return 'Invalid SSH host or port';
  return '';
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The process and arguments that run `tmux <tmuxArgs>` on the target.
function wrap(t, tmuxArgs) {
  switch (t.kind) {
    case 'wsl':
      return { cmd: 'wsl.exe', args: ['-d', t.distro, ...(t.user ? ['-u', t.user] : []), '--exec', 'tmux', ...tmuxArgs] };
    case 'ssh': {
      const target = (t.user ? `${t.user}@` : '') + t.host;
      return {
        cmd: 'ssh',
        args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', ...(t.port ? ['-p', String(t.port)] : []), target, ['tmux', ...tmuxArgs].map(shq).join(' ')],
      };
    }
    default:
      return { cmd: 'tmux', args: tmuxArgs };
  }
}

const run = (t, tmuxArgs, timeout = 12000) => new Promise((resolve) => {
  const { cmd, args } = wrap(t, tmuxArgs);
  execFile(cmd, args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, stdout, stderr) =>
    resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: String(stdout || ''), err: String(stderr || '') + (err && err.code === 'ENOENT' ? 'ENOENT' : '') }));
});

// { available, exists, error? }: is tmux installed on the target, and does this terminal's session already exist?
async function status(t) {
  const bad = validate(t);
  if (bad) return { available: false, exists: false, error: bad };
  const v = await run(t, ['-V']);
  if (!v.ok) {
    const missing = v.code === 127 || v.err.includes('ENOENT') || /not found|no such file/i.test(v.err);
    return { available: false, exists: false, error: missing ? 'tmux is not installed there' : (v.err.trim().split('\n')[0] || 'tmux could not be run') };
  }
  const has = await run(t, ['-L', t.socket, 'has-session', '-t', `=${t.session}`]);
  return { available: true, exists: has.ok, version: v.out.trim() };
}

async function kill(t) {
  if (validate(t)) return false;
  const r = await run(t, ['-L', t.socket, 'kill-session', '-t', `=${t.session}`]);
  return r.ok;
}

function register(ipcMain) {
  ipcMain.handle('app:tmuxStatus', (_e, t) => status(t));
  ipcMain.handle('app:tmuxKill', (_e, t) => kill(t));
}

module.exports = { register, status, kill, validate };
