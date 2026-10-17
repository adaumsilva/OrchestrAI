// Android device automation over adb (emulators and physical phones): screenshots, input, UI tree, a live H.264 stream and
// emulator start/stop. The adb and emulator commands can be replaced for tests with ORCH_CLI_ADB / ORCH_CLI_EMULATOR='["node","fake.js"]'.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function override(name) {
  const v = process.env[name];
  if (!v) return null;
  try { const a = JSON.parse(v); return { cmd: a[0], pre: a.slice(1) }; } catch { return null; }
}

function adbPath() {
  const names = process.platform === 'win32' ? ['adb.exe'] : ['adb'];
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].filter(Boolean);
  for (const r of roots) {
    for (const n of names) {
      const p = path.join(r, 'platform-tools', n);
      if (fs.existsSync(p)) return p;
    }
  }
  return 'adb'; // fall back to PATH
}

const adbCmd = () => override('ORCH_CLI_ADB') || { cmd: adbPath(), pre: [] };

const adb = (args, opts = {}) =>
  new Promise((resolve) => {
    const { cmd, pre } = adbCmd();
    execFile(cmd, [...pre, ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const missing = err.code === 'ENOENT';
        resolve({ ok: false, err: missing ? 'adb not found. Install Android platform-tools and set ANDROID_HOME, or add adb to PATH.' : (stderr || err.message).toString().trim() });
      } else resolve({ ok: true, out: stdout });
    });
  });

const sh = (serial, args) => adb(['-s', serial, 'shell', ...args]);

function parseBounds(b) {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(b || '');
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
}

function parseUi(xml) {
  const out = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const bounds = parseBounds(attrs.bounds);
    if (!bounds) continue;
    const label = attrs.text || attrs['content-desc'] || attrs['resource-id'];
    if (!label && attrs.clickable !== 'true') continue;
    out.push({
      label: label || attrs.class,
      id: attrs['resource-id'],
      clickable: attrs.clickable === 'true',
      bounds,
      cx: Math.round((bounds.x1 + bounds.x2) / 2),
      cy: Math.round((bounds.y1 + bounds.y2) / 2),
    });
  }
  return out;
}

// ---------- emulators ----------
function emulatorCmd() {
  const o = override('ORCH_CLI_EMULATOR');
  if (o) return o;
  const exe = process.platform === 'win32' ? 'emulator.exe' : 'emulator';
  for (const r of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk'), process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk')].filter(Boolean)) {
    const p = path.join(r, 'emulator', exe);
    if (fs.existsSync(p)) return { cmd: p, pre: [] };
  }
  return { cmd: 'emulator', pre: [] };
}

// ---------- live stream ----------
// screenrecord writes raw H.264 to stdout. It stops by itself after its time limit, so the renderer asks for a new stream
// when one ends and the picture carries on.
const streams = new Map(); // id -> child process
const STREAM_LIMIT_S = 170;

function register(ipcMain, getWin) {
  const sendWin = (ch, ...args) => { try { getWin?.()?.webContents.send(ch, ...args); } catch {} };

  ipcMain.handle('device:streamStart', (_e, id, serial, { width, height, bitrate } = {}) => {
    streams.get(id)?.kill();
    const { cmd, pre } = adbCmd();
    const size = width && height ? ['--size', `${Math.round(width)}x${Math.round(height)}`] : [];
    const child = spawn(cmd, [...pre, '-s', serial, 'exec-out', 'screenrecord', '--output-format=h264', ...size, '--bit-rate', String(bitrate || 4000000), '--time-limit', String(STREAM_LIMIT_S), '-'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    streams.set(id, child);
    let err = '';
    child.stdout.on('data', (chunk) => sendWin('device:stream', id, chunk));
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err = e.code === 'ENOENT' ? 'adb not found.' : e.message; });
    child.on('close', (code) => {
      if (streams.get(id) === child) streams.delete(id);
      sendWin('device:streamEnd', id, { code, error: code ? err.trim().slice(-300) : '' });
    });
    return { ok: true };
  });
  ipcMain.handle('device:streamStop', (_e, id) => { const c = streams.get(id); if (c) { streams.delete(id); c.kill(); } return true; });

  ipcMain.handle('device:info', async (_e, serial) => {
    const r = await sh(serial, ['wm', 'size']);
    if (!r.ok) return { error: r.err };
    const m = /(?:Override size|Physical size):\s*(\d+)x(\d+)/.exec(String(r.out).split(/\r?\n/).reverse().join('\n')) || /(\d+)x(\d+)/.exec(r.out);
    return m ? { width: +m[1], height: +m[2] } : { error: 'Could not read the screen size.' };
  });

  ipcMain.handle('device:avds', () => new Promise((resolve) => {
    const { cmd, pre } = emulatorCmd();
    execFile(cmd, [...pre, '-list-avds'], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) resolve({ error: err.code === 'ENOENT' ? 'The Android emulator was not found. Install it with the Android SDK and set ANDROID_HOME.' : err.message, avds: [] });
      else resolve({ avds: String(stdout).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^(INFO|WARNING)/.test(s)) });
    });
  }));
  ipcMain.handle('device:emuStart', (_e, name) => {
    if (!/^[\w.-]+$/.test(String(name))) return { ok: false, error: 'Invalid emulator name.' };
    const { cmd, pre } = emulatorCmd();
    try {
      const child = spawn(cmd, [...pre, '-avd', name], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('device:emuStop', async (_e, serial) => {
    if (!/^emulator-\d+$/.test(String(serial))) return { ok: false, error: 'Only emulators can be stopped from here.' };
    const r = await adb(['-s', serial, 'emu', 'kill']);
    return r.ok ? { ok: true } : { ok: false, error: r.err };
  });

  ipcMain.handle('device:list', async () => {
    const r = await adb(['devices', '-l']);
    if (!r.ok) return { error: r.err, devices: [] };
    const devices = r.out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [serial, state, ...rest] = l.split(/\s+/);
      const model = (rest.find((x) => x.startsWith('model:')) || '').slice(6);
      return { serial, state, model };
    });
    return { devices };
  });

  ipcMain.handle('device:screenshot', async (_e, serial) => {
    const r = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer' });
    if (!r.ok) return { error: r.err };
    return { png: Buffer.from(r.out).toString('base64') };
  });

  ipcMain.handle('device:tap', (_e, serial, x, y) => sh(serial, ['input', 'tap', String(Math.round(x)), String(Math.round(y))]));
  ipcMain.handle('device:swipe', (_e, serial, x1, y1, x2, y2, ms = 250) =>
    sh(serial, ['input', 'swipe', ...[x1, y1, x2, y2].map((n) => String(Math.round(n))), String(ms)]));
  ipcMain.handle('device:key', (_e, serial, key) => {
    const codes = { back: 4, home: 3, recents: 187, enter: 66, power: 26, volup: 24, voldown: 25 };
    return sh(serial, ['input', 'keyevent', String(codes[key] ?? key)]);
  });
  ipcMain.handle('device:text', (_e, serial, text) =>
    // `input text` treats %s as space; spaces and shell metacharacters must be encoded
    sh(serial, ['input', 'text', `'${String(text).replace(/ /g, '%s').replace(/'/g, "'\\''")}'`]));
  ipcMain.handle('device:launch', (_e, serial, pkg) =>
    sh(serial, ['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']));

  ipcMain.handle('device:ui', async (_e, serial) => {
    const r = await sh(serial, ['uiautomator', 'dump', '/dev/tty']);
    if (!r.ok) return { error: r.err };
    return { nodes: parseUi(r.out) };
  });
}

module.exports = { register, parseUi, killStreams: () => { for (const c of streams.values()) c.kill(); streams.clear(); } };
