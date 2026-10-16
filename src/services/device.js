// Android device automation over adb (emulators and physical phones).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

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

const adb = (args, opts = {}) =>
  new Promise((resolve) => {
    execFile(adbPath(), args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15000, ...opts }, (err, stdout, stderr) => {
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

function register(ipcMain) {
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

module.exports = { register };
