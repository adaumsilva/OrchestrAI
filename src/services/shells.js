// Detects the shells and sandboxes a terminal can start in.
// A profile is { id, label, group, command, args, cdFlag? }; cdFlag means the start directory is passed
// to the command (WSL) instead of being the process working directory.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 6000, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout) =>
      resolve({ ok: !err, out: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '') }));
  });

const onPath = async (name) => {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [name]);
  return r.ok ? r.out.toString().split(/\r?\n/)[0].trim() : null;
};

// `wsl -l -q` prints UTF-16LE on Windows.
const decodeWsl = (buf) => (buf.includes(0) ? buf.toString('utf16le') : buf.toString('utf8')).replace(/\uFEFF/g, '');

async function wslDistros() {
  const r = await run('wsl.exe', ['-l', '-q']);
  if (!r.ok) return [];
  return decodeWsl(r.out).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^docker-desktop/i.test(s));
}

async function dockerContainers() {
  const r = await run('docker', ['ps', '--format', '{{.Names}}']);
  if (!r.ok) return [];
  return r.out.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function detect() {
  const profiles = [];
  const add = (p) => profiles.push(p);

  if (process.platform === 'win32') {
    add({ id: 'powershell', label: 'Windows PowerShell', group: 'Shells', command: 'powershell.exe', args: [] });
    const pwsh = (await onPath('pwsh')) || ['C:\\Program Files\\PowerShell\\7\\pwsh.exe'].find((p) => fs.existsSync(p));
    if (pwsh) add({ id: 'pwsh', label: 'PowerShell 7', group: 'Shells', command: pwsh, args: [] });
    add({ id: 'cmd', label: 'Command Prompt', group: 'Shells', command: 'cmd.exe', args: [] });
    const bash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p));
    if (bash) add({ id: 'gitbash', label: 'Git Bash', group: 'Shells', command: bash, args: ['--login', '-i'] });
    for (const d of await wslDistros()) add({ id: `wsl:${d}`, label: `WSL: ${d}`, group: 'WSL', command: 'wsl.exe', args: ['-d', d], cdFlag: true });
  } else {
    const seen = new Set();
    const candidates = [process.env.SHELL, ...(fs.existsSync('/etc/shells') ? fs.readFileSync('/etc/shells', 'utf8').split('\n').filter((l) => l.startsWith('/')) : [])].filter(Boolean);
    for (const c of candidates) {
      if (seen.has(c) || !fs.existsSync(c)) continue;
      seen.add(c);
      add({ id: `shell:${c}`, label: path.basename(c), group: 'Shells', command: c, args: ['-l'] });
    }
  }

  for (const name of await dockerContainers()) {
    add({
      id: `docker:${name}`, label: `Docker: ${name}`, group: 'Docker',
      command: 'docker', args: ['exec', '-it', name, 'sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'],
    });
  }
  return profiles;
}

function defaultProfile() {
  return process.platform === 'win32'
    ? { id: 'powershell', label: 'Windows PowerShell', group: 'Shells', command: 'powershell.exe', args: [] }
    : { id: 'default', label: 'Default shell', group: 'Shells', command: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

let cache = null;
function register(ipcMain, shell) {
  ipcMain.handle('app:shells', async (_e, fresh) => {
    if (!cache || fresh || Date.now() - cache.at > 30000) cache = { at: Date.now(), list: await detect() };
    return { profiles: cache.list, default: defaultProfile() };
  });
  // Only web links are handed to the OS.
  ipcMain.handle('app:openExternal', (_e, url) => {
    if (!/^https?:\/\//i.test(String(url))) return false;
    shell.openExternal(url);
    return true;
  });
}

module.exports = { register, defaultProfile };
