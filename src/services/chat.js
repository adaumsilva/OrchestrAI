const { spawn, execFile } = require('child_process');

const procs = new Map();

function kill(p) {
  if (!p || p.killed) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else p.kill('SIGTERM');
}

function register(ipcMain, getWin) {
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
