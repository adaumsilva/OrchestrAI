const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CALL_PREFIXES = ['bridge:', 'data:', 'maestri:', 'usage:', 'git:', 'files:', 'chat:', 'device:', 'app:', 'workspace:', 'pty:', 'routines:', 'notes:', 'skills:', 'config:', 'pr:', 'ide:', 'templates:', 'portal:', 'accounts:', 'sandbox:', 'storage:', 'updates:'];
const EVENTS = ['bridge:request', 'pty:data', 'pty:exit', 'chat:data', 'chat:done', 'files:changed', 'routines:fire', 'routines:changed', 'notes:changed', 'updates:status', 'device:stream', 'device:streamEnd'];

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
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } }, // dropped files
});
