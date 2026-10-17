const { contextBridge, ipcRenderer } = require('electron');

const CALL_PREFIXES = ['bridge:', 'data:', 'maestri:', 'usage:', 'git:', 'files:', 'chat:', 'device:', 'app:', 'workspace:', 'pty:', 'routines:', 'notes:', 'skills:', 'config:', 'pr:', 'ide:'];
const EVENTS = ['bridge:request', 'pty:data', 'pty:exit', 'chat:data', 'chat:done', 'files:changed', 'routines:fire', 'routines:changed', 'notes:changed'];

contextBridge.exposeInMainWorld('orchestrai', {
  call: (channel, ...args) => {
    if (!CALL_PREFIXES.some((p) => channel.startsWith(p))) throw new Error(`Blocked channel ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!EVENTS.includes(channel)) throw new Error(`Blocked event ${channel}`);
    const h = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  // fire-and-forget terminal I/O
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  saveSync: (state) => ipcRenderer.sendSync('workspace:saveSync', state),
  ptyKillAll: () => ipcRenderer.send('pty:killAll'),
});
