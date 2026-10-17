const fs = require('fs'), path = require('path');

// 1x1 PNG, served as the "screenshot"
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const root = path.join(t.dataDir, 'adbtest');
  fs.mkdirSync(root, { recursive: true });
  const stateFile = path.join(root, 'adb-state.json');
  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const writeState = (patch) => fs.writeFileSync(stateFile, JSON.stringify({ ...(fs.existsSync(stateFile) ? readState() : {}), ...patch }));
  const waitFor = async (fn, ms = 15000) => { for (let i = 0; i < ms / 200; i++) { try { if (await fn()) return true; } catch {} await t.sleep(200); } return false; };

  // ---- an H.264 stream made by the browser's own encoder: a square moving across the screen ----
  const enc = await t.js(`(async () => {
    const W = 270, H = 600, N = 45;
    const chunks = []; let err = null;
    const encoder = new VideoEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); }, error: (e) => { err = String(e); } });
    encoder.configure({ codec: 'avc1.42001f', width: W, height: H, bitrate: 2e6, framerate: 20, avc: { format: 'annexb' }, latencyMode: 'realtime' });
    const cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d');
    for (let i = 0; i < N; i++) {
      cx.fillStyle = '#103060'; cx.fillRect(0, 0, W, H);
      cx.fillStyle = '#ffd60a'; cx.fillRect(10 + i * 5, 250, 50, 50);
      const f = new VideoFrame(cv, { timestamp: i * 50000 });
      encoder.encode(f, { keyFrame: i % 15 === 0 }); f.close();
    }
    await encoder.flush();
    if (err) return { error: err };
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total); let o = 0; const index = [];
    for (const c of chunks) { all.set(c, o); index.push([o, c.length]); o += c.length; }
    let bin = ''; for (let i = 0; i < all.length; i += 0x8000) bin += String.fromCharCode.apply(null, all.subarray(i, i + 0x8000));
    return { b64: btoa(bin), index, frames: chunks.length };
  })()`);
  t.check('the test stream was encoded', !enc.error && enc.frames >= 40, enc.error || enc.frames);
  fs.writeFileSync(path.join(root, 'stream.h264'), Buffer.from(enc.b64, 'base64'));

  writeState({ devices: [{ serial: 'emulator-5554', state: 'device', model: 'Pixel_7' }, { serial: 'R58M123ABC', state: 'device', model: 'SM_G991' }, { serial: 'offline-1', state: 'offline', model: '' }],
    png: PNG_B64, stream: { file: path.join(root, 'stream.h264'), frames: enc.index, delayMs: 45 }, avds: ['Pixel_7', 'Pixel_Tablet'], calls: [] });
  process.env.FAKE_ADB_STATE = stateFile;
  process.env.ORCH_CLI_ADB = JSON.stringify(['node', path.join(__dirname, 'fake-adb.js')]);
  process.env.ORCH_CLI_EMULATOR = JSON.stringify(['node', path.join(__dirname, 'fake-adb.js')]);
  process.env.ORCH_FAKE_EMULATOR = '1'; // only the emulator process sees this (see below)
  // fake-adb appends every call to its own log file (many of them run at once, so the state file cannot hold the list)
  const allCalls = () => (fs.existsSync(stateFile + '.calls') ? fs.readFileSync(stateFile + '.calls', 'utf8').split('\n').filter(Boolean) : []);
  const callsOf = (re) => allCalls().filter((c) => re.test(c));

  // the adb stand-in must not behave like an emulator
  delete process.env.ORCH_FAKE_EMULATOR;
  const emu = JSON.stringify(['node', path.join(__dirname, 'fake-emulator.js')]);
  process.env.ORCH_CLI_EMULATOR = emu;

  const id = await t.js(`addNode('device', { x: 40, y: 40, w: 420, h: 700 }, activeFloor()).id`);
  await t.sleep(1200);
  const q = (code) => t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; return ${code}; })()`);

  // ---- devices ----
  const opts = await q(`[...el.querySelectorAll('select option')].map((o) => o.value)`);
  t.check('only ready devices are listed', opts.join() === 'emulator-5554,R58M123ABC', opts);

  // ---- live stream ----
  await q(`[...el.querySelectorAll('button')].find((b) => b.textContent === 'Live').click(); 0`);
  t.check('the stream starts with the device\'s screen size, scaled down', await waitFor(() => callsOf(/screenrecord/).length >= 1));
  const sr = callsOf(/screenrecord/)[0] || '';
  t.check('screenrecord is asked for H.264 at a reduced even size', /--output-format=h264/.test(sr) && /--size 384x854|--size 4\d\dx\d+|--size 3\d\dx\d+/.test(sr) && /--time-limit/.test(sr), sr);
  const first = await waitFor(() => q(`el.querySelector('canvas.device-canvas').width > 0 && getComputedStyle(el.querySelector('canvas.device-canvas')).display !== 'none'`));
  t.check('decoded frames appear on the canvas', first);
  // frames per second over a 2 s window while the stream plays
  const rate = await t.js(`(async () => {
    const el = rt.get(state.active).live.get('${id}').el; const cv = el.querySelector('canvas.device-canvas');
    const label = el.querySelector('.row span.muted');
    await new Promise((r) => setTimeout(r, 300));
    const samples = [];
    for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 300)); samples.push(label.textContent); }
    return samples;
  })()`);
  const best = Math.max(...rate.map((s) => parseInt(s, 10) || 0));
  t.check('the stream runs at 10 fps or better', best >= 10, rate);
  // the picture moves: the yellow square is at different x positions in two snapshots
  const snap = () => t.js(`(() => { const cv = rt.get(state.active).live.get('${id}').el.querySelector('canvas.device-canvas'); const c = cv.getContext('2d'); const row = c.getImageData(0, Math.round(cv.height * 0.45), cv.width, 1).data; for (let x = 0; x < cv.width; x++) if (row[x * 4] > 200 && row[x * 4 + 1] > 180 && row[x * 4 + 2] < 100) return x / cv.width; return -1; })()`);
  const xs = []; for (let i = 0; i < 6; i++) { xs.push(await snap()); await t.sleep(120); }
  const seen = xs.filter((x) => x >= 0);
  t.check('the moving square is drawn at changing positions', seen.length >= 3 && Math.max(...seen) - Math.min(...seen) > 0.05, xs);
  // screenrecord stops at its time limit (the stand-in ends after one pass) and the view carries on
  t.check('when screenrecord ends by itself the stream is restarted', await waitFor(() => callsOf(/screenrecord/).length >= 2, 12000), callsOf(/screenrecord/).length);

  // ---- tap mapping from the canvas ----
  const rect = await q(`(() => { const r = el.querySelector('canvas.device-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 4) }; })()`);
  const wc = t.win.webContents;
  wc.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
  wc.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await t.sleep(600);
  const tap = (callsOf(/input tap/).pop() || '').match(/input tap (\d+) (\d+)/);
  t.check('a click maps to the device\'s real coordinates', tap && Math.abs(+tap[1] - 540) <= 25 && Math.abs(+tap[2] - 600) <= 40, callsOf(/input tap/));

  // ---- stop ----
  await q(`[...el.querySelectorAll('button')].find((b) => b.textContent === 'Live').click(); 0`);
  await t.sleep(500);
  const starts = callsOf(/screenrecord/).length;
  await t.sleep(1500);
  t.check('turning Live off stops the stream', callsOf(/screenrecord/).length === starts && (await q(`getComputedStyle(el.querySelector('canvas.device-canvas')).display === 'none'`)));

  // ---- fallback to screenshots when streaming is not available ----
  writeState({ streamFail: true });
  await q(`[...el.querySelectorAll('button')].find((b) => b.textContent === 'Live').click(); 0`);
  t.check('a failing stream falls back to screenshots and says why', await waitFor(() => q(`/Live stream unavailable/.test(el.querySelector('.err').textContent) && getComputedStyle(el.querySelector('img')).display !== 'none'`)), await q(`el.querySelector('.err').textContent`));
  await t.sleep(1500);
  t.check('the fallback shows the screenshot', (await q(`el.querySelector('img').src.startsWith('data:image/png')`)));
  await q(`[...el.querySelectorAll('button')].find((b) => b.textContent === 'Live').click(); 0`);
  writeState({ streamFail: false });

  // ---- emulators ----
  await q(`el.querySelector('button[title^="Start or stop"]').click(); 0`);
  await t.sleep(900);
  const dlg = await t.js(`document.querySelector('#modal-root').innerText`);
  t.check('the emulator dialog lists virtual devices and running emulators', /Pixel_7/.test(dlg) && /Pixel_Tablet/.test(dlg) && /Running/.test(dlg) && /emulator-5554/.test(dlg), dlg);
  await t.js(`[...document.querySelectorAll('#modal-root .change')].find((r) => r.textContent.includes('Pixel_Tablet')).querySelector('button').click(); 0`);
  t.check('Start launches the emulator with that AVD', await waitFor(() => (readState().started || []).includes('Pixel_Tablet')));
  await t.js(`[...document.querySelectorAll('#modal-root .change')].find((r) => r.textContent.includes('emulator-5554')).querySelector('button').click(); 0`);
  t.check('Stop kills the running emulator through adb', await waitFor(() => callsOf(/-s emulator-5554 emu kill/).length === 1));
  t.check('a physical phone cannot be stopped from here', (await call('device:emuStop', 'R58M123ABC')).ok === false);
  t.check('AVD names are validated', (await call('device:emuStart', 'x; rm -rf /')).ok === false);
  await t.js(`closeModal(); 0`);

  // ---- the automation contract ----
  const term = await t.js(`addNode('terminal', { title: 'Agent', x: 700, y: 40 }, activeFloor()).id`);
  const other = await t.js(`addNode('terminal', { title: 'Loner', x: 700, y: 400 }, activeFloor()).id`);
  await t.js(`(() => { const f = activeFloor(); f.ropes.push({ id: uid(), a: '${term}', b: '${id}' }); save(); wakeRopes(); return 0; })()`);
  const bridge = (m, p, from = term, scope = 'peer') => t.js(`bridgeHandle(${JSON.stringify(m)}, ${JSON.stringify(p)}, '${from}', '${scope}').then((r) => ({ r }), (e) => ({ err: e.message }))`);
  const list = await bridge('device-list', {});
  t.check('a roped terminal sees its device node', list.r?.length === 1 && list.r[0].node === id && /R58M123ABC/.test(list.r[0].devices) && !/offline/.test(list.r[0].devices), list);
  t.check('a terminal that is not roped sees none and is refused', (await bridge('device-list', {}, other)).r.length === 0 && /No device node/.test((await bridge('device-tap', { x: 1, y: 1 }, other)).err));
  t.check('a Maestro sees every device node', (await bridge('device-list', {}, other, 'maestro')).r.length === 1);
  const info = await bridge('device-info', { target: '' });
  t.check('screen size can be read', info.r?.width === 1080 && info.r?.height === 2400, info);
  const shot = await bridge('device-shot', {});
  t.check('a screenshot is saved as an image file', shot.r?.path && fs.existsSync(shot.r.path) && fs.readFileSync(shot.r.path).subarray(1, 4).toString() === 'PNG', shot);
  const ui = await bridge('device-ui', {});
  t.check('the UI tree lists elements with tap coordinates', ui.r?.some((n) => n.label === 'Sign in' && n.cx === 300 && n.cy === 250 && n.clickable), ui);
  await bridge('device-tap', { x: 300, y: 250 });
  await bridge('device-swipe', { x1: 500, y1: 1800, x2: 500, y2: 600, ms: 300 });
  await bridge('device-type', { text: 'hello world' });
  await bridge('device-key', { key: 'home' });
  await bridge('device-launch', { pkg: 'com.example.app' });
  await t.sleep(300);
  const log = allCalls().join('\n');
  t.check('tap, swipe, type, key and launch reach the device', /-s emulator-5554 shell input tap 300 250/.test(log) && /input swipe 500 1800 500 600 300/.test(log) && /input text 'hello%sworld'/.test(log) && /input keyevent 3/.test(log) && /monkey -p com\.example\.app/.test(log), log.split('\n').slice(-8));
  t.check('a specific adb device can be chosen', (await bridge('device-tap', { x: 5, y: 6, serial: 'R58M123ABC' })).r?.ok && callsOf(/-s R58M123ABC shell input tap 5 6/).length === 1);
  const bad = await bridge('device-tap', { x: 'a', y: 1 });
  t.check('bad coordinates are refused before reaching adb', /numbers/.test(bad.err || '') && !allCalls().some((c) => /input tap NaN/.test(c)), bad);

  // ---- no adb at all ----
  process.env.ORCH_CLI_ADB = JSON.stringify(['definitely-not-a-real-adb-binary']);
  const miss = await call('device:list');
  t.check('a missing adb is explained', /adb not found/.test(miss.error || ''), miss);
  delete process.env.ORCH_CLI_ADB; delete process.env.ORCH_CLI_EMULATOR;
};
