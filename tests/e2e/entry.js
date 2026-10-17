// Runs inside Electron: boots the real app against a throwaway profile, then runs one test file.
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrai-e2e-'));
app.setPath('userData', dataDir);
app.commandLine.appendSwitch('lang', 'en-US'); // the UI follows the system language; tests expect English
process.env.ORCH_NO_TRAY = '1';
require('../../src/main.js');

const testFile = process.env.ORCH_TEST;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 100 && !win; i++) { await sleep(100); win = BrowserWindow.getAllWindows()[0]; }
  const wc = win.webContents;
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.show(); win.focus();
  const t = {
    win, sleep, dataDir,
    js: (code) => wc.executeJavaScript(code),
    key: async (key, mods = []) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
      if (key.length === 1) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers: mods });
      wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
      await sleep(60);
    },
    type: async (text) => { for (const ch of text) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(15); } await sleep(80); },
    click: async (x, y) => {
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await sleep(80);
    },
    results: [],
    check(name, ok, info) { this.results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + (info === undefined ? '' : JSON.stringify(info))}`); },
  };
  let code = 0;
  try {
    await sleep(1200); // boot: workspace load + first terminal
    await require(path.resolve(testFile))(t);
    if (t.results.some((r) => !r.ok)) code = 1;
  } catch (e) { console.log('ERROR', e && e.stack || e); code = 1; }
  try { await t.js('window.orchestrai.ptyKillAll()'); } catch {}
  setTimeout(() => process.exit(code), 200);
});
