// Android device/emulator control over adb: live H.264 stream (screenshot polling as a fallback), tap/swipe, keys, text, app
// launch, UI tree, emulator start/stop, and an automation surface for connected agents (orchestrai device ...).
NodeKinds.device = {
  label: 'Device', w: 400, h: 620,
  mount({ node, body, save, entry }) {
    let mode = 'off', busy = false, timer = null, player = null, devSize = null, restarts = 0, started = 0, fpsCount = 0;
    const MAX_SIDE = 960; // the stream is scaled down so decoding stays cheap

    const sel = h('select', { style: 'flex:1;min-width:0' });
    const msg = h('div', { class: 'err' });
    const fps = h('span', { class: 'muted', style: 'font-size:11px;min-width:42px;text-align:right' });
    const img = h('img', { draggable: 'false' });
    const canvas = h('canvas', { class: 'device-canvas', style: 'display:none' });
    const screen = h('div', { class: 'device-screen' }, img, canvas);
    const uiList = h('div', { class: 'scroll', style: 'display:none;flex:none;max-height:35%' });
    const text = h('input', { placeholder: 'Type text on device' });
    const pkg = h('input', { placeholder: 'package.name to launch', value: node.data.pkg || '' });
    const serial = () => sel.value;
    const press = (k) => serial() && call('device:key', serial(), k).then(() => shotSoon());
    const shown = () => (mode === 'stream' ? canvas : img);

    async function devices() {
      const r = await call('device:list');
      msg.textContent = r.error || (r.devices.length ? '' : 'No devices. Start an emulator or enable USB debugging.');
      const ready = r.devices.filter((d) => d.state === 'device');
      const keep = sel.value;
      sel.replaceChildren(...ready.map((d) => h('option', { value: d.serial }, d.model ? `${d.model} (${d.serial})` : d.serial)));
      if (ready.some((d) => d.serial === keep)) sel.value = keep;
      else if (node.data.serial && ready.some((d) => d.serial === node.data.serial)) sel.value = node.data.serial;
      if (sel.value && mode !== 'stream') shotSoon();
      return ready;
    }

    async function screenshot() {
      if (busy || !serial()) return;
      busy = true;
      const r = await call('device:screenshot', serial());
      busy = false;
      if (r.error) { msg.textContent = r.error; return; }
      msg.textContent = '';
      img.src = 'data:image/png;base64,' + r.png;
    }
    const shotSoon = () => { if (mode !== 'stream') setTimeout(screenshot, 400); };

    // ---------- live view ----------
    function showStream(on) {
      canvas.style.display = on ? '' : 'none';
      img.style.display = on ? 'none' : '';
    }

    function stopLive() {
      clearInterval(timer);
      if (mode === 'stream') call('device:streamStop', node.id);
      player?.close(); player = null;
      mode = 'off';
      showStream(false);
      liveBtn.classList.remove('active');
      fps.textContent = '';
    }

    async function startStream() {
      const info = await call('device:info', serial());
      if (info.error) { msg.textContent = info.error; return startPolling(); }
      devSize = info;
      const k = Math.min(1, MAX_SIDE / Math.max(info.width, info.height));
      const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
      mode = 'stream';
      started = Date.now();
      showStream(true);
      player = new H264Player(canvas, { onFrame: () => { fpsCount++; }, onError: () => {} });
      await call('device:streamStart', node.id, serial(), { width: even(info.width), height: even(info.height) });
      let last = fpsCount;
      clearInterval(timer);
      timer = setInterval(() => { fps.textContent = `${fpsCount - last} fps`; last = fpsCount; }, 1000);
    }

    function startPolling() {
      mode = 'poll';
      showStream(false);
      clearInterval(timer);
      timer = setInterval(() => { if (body.offsetWidth) screenshot(); }, 1000);
      liveBtn.classList.add('active');
    }

    async function setLive(on) {
      stopLive();
      if (!on || !serial()) return;
      liveBtn.classList.add('active');
      restarts = 0;
      if (H264_SUPPORTED) await startStream(); else startPolling();
    }

    const offData = api.on('device:stream', (id, chunk) => { if (id === node.id) player?.push(chunk); });
    const offEnd = api.on('device:streamEnd', async (id, info) => {
      if (id !== node.id || mode !== 'stream') return;
      // screenrecord ends by itself after its time limit: carry on. A quick failure means streaming does not work here.
      if (!info.code || Date.now() - started > 5000) {
        player?.close();
        player = new H264Player(canvas, { onFrame: () => { fpsCount++; }, onError: () => {} });
        started = Date.now();
        const k = Math.min(1, MAX_SIDE / Math.max(devSize.width, devSize.height));
        const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
        await call('device:streamStart', node.id, serial(), { width: even(devSize.width), height: even(devSize.height) });
        return;
      }
      msg.textContent = `Live stream unavailable (${info.error || 'exit ' + info.code}); refreshing screenshots instead.`;
      player?.close(); player = null;
      startPolling();
    });

    // ---------- input ----------
    const toPoint = (e) => {
      const el = shown(), r = el.getBoundingClientRect();
      const w = mode === 'stream' ? devSize.width : img.naturalWidth, hh = mode === 'stream' ? devSize.height : img.naturalHeight;
      return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * hh];
    };
    let down = null;
    const onDown = (e) => { e.stopPropagation(); down = toPoint(e); };
    const onUp = async (e) => {
      if (!down || !serial()) return;
      const [x, y] = toPoint(e), [x0, y0] = down;
      down = null;
      const width = mode === 'stream' ? devSize.width : img.naturalWidth;
      if (Math.hypot(x - x0, y - y0) > width * 0.03) await call('device:swipe', serial(), x0, y0, x, y);
      else await call('device:tap', serial(), x, y);
      shotSoon();
    };
    for (const el of [img, canvas]) { el.addEventListener('mousedown', onDown); el.addEventListener('mouseup', onUp); }

    const liveBtn = h('button', { title: 'Live view of the screen', onclick: () => setLive(mode === 'off') }, 'Live');
    const uiBtn = h('button', {
      title: 'List on-screen elements',
      async onclick() {
        if (uiList.style.display !== 'none') { uiList.style.display = 'none'; return; }
        if (!serial()) return;
        const r = await call('device:ui', serial());
        if (r.error) { msg.textContent = r.error; return; }
        uiList.style.display = '';
        uiList.replaceChildren(...r.nodes.map((n) => h('div', { class: 'tree-item', onclick: async () => { await call('device:tap', serial(), n.cx, n.cy); shotSoon(); } },
          n.label, h('span', { class: 'git-badge' }, n.clickable ? 'tap' : ''))));
      },
    }, 'UI');

    sel.addEventListener('change', () => { node.data.serial = sel.value; save(); if (mode === 'stream') setLive(true); else shotSoon(); });
    text.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !serial() || !text.value) return;
      await call('device:text', serial(), text.value);
      text.value = '';
      shotSoon();
    });
    pkg.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !serial() || !pkg.value.trim()) return;
      node.data.pkg = pkg.value.trim(); save();
      await call('device:launch', serial(), pkg.value.trim());
      shotSoon();
    });

    // ---------- emulators ----------
    async function emulatorsDialog() {
      const [{ avds, error }, { devices: found = [] }] = await Promise.all([call('device:avds'), call('device:list')]);
      const running = found.filter((d) => /^emulator-\d+$/.test(d.serial));
      modal({
        title: 'Android emulators',
        content: h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:380px' },
          error ? h('div', { class: 'err' }, error) : null,
          avds.length ? h('div', { class: 'muted' }, 'Virtual devices') : (error ? null : h('div', { class: 'muted' }, 'No virtual devices were found. Create one in Android Studio.')),
          ...avds.map((a) => h('div', { class: 'change' }, h('span', {}, a), h('button', {
            style: 'margin-left:auto',
            onclick: async (e) => { e.target.disabled = true; const r = await call('device:emuStart', a); if (!r.ok) alertModal('Could not start', r.error); else e.target.textContent = 'Starting…'; },
          }, 'Start'))),
          running.length ? h('div', { class: 'muted' }, 'Running') : null,
          ...running.map((d) => h('div', { class: 'change' }, h('span', {}, d.model ? `${d.model} (${d.serial})` : d.serial), h('button', {
            style: 'margin-left:auto',
            onclick: async (e) => { e.target.disabled = true; const r = await call('device:emuStop', d.serial); if (!r.ok) alertModal('Could not stop', r.error); else e.target.textContent = 'Stopping…'; },
          }, 'Stop')))),
        actions: [{ label: 'Rescan', onClick: (c) => { c(); emulatorsDialog(); } }, { label: 'Close', primary: true, onClick: (c) => { c(); setTimeout(devices, 3000); } }],
      });
    }

    body.append(
      h('div', { class: 'row' }, sel, h('button', { title: 'Rescan devices', onclick: devices }, '⟳'), liveBtn, fps, uiBtn, h('button', { title: 'Start or stop Android emulators', onclick: emulatorsDialog }, '📱')),
      msg, screen, uiList,
      h('div', { class: 'row' },
        h('button', { onclick: () => press('back') }, '◀ Back'),
        h('button', { onclick: () => press('home') }, '● Home'),
        h('button', { onclick: () => press('recents') }, '■ Recents'),
        h('button', { onclick: () => press('enter') }, 'Enter')),
      h('div', { class: 'row' }, text),
      h('div', { class: 'row' }, pkg));

    // ---------- what other nodes and the orchestrai command can do ----------
    const ser = (s) => s || serial();
    const need = (s) => { if (!ser(s)) throw new Error('No device is selected. Start an emulator or connect a phone.'); return ser(s); };
    const must = async (p) => { const r = await p; if (r && r.ok === false) throw new Error(r.err || 'adb failed'); if (r && r.error) throw new Error(r.error); return r; };
    const finite = (...n) => { if (!n.every((v) => Number.isFinite(v))) throw new Error('Coordinates must be numbers.'); };
    entry.api.send = (t) => serial() && call('device:text', serial(), t).then(shotSoon);
    entry.api.device = {
      serial,
      list: async () => (await must(call('device:list'))).devices,
      info: (s) => must(call('device:info', need(s))),
      shot: async (s) => {
        const r = await must(call('device:screenshot', need(s)));
        const file = await call('files:saveAttachment', 'device-screen.png', r.png);
        return { path: file, bytes: Math.round(r.png.length * 0.75) };
      },
      tap: async (x, y, s) => { finite(x, y); await must(call('device:tap', need(s), x, y)); shotSoon(); },
      swipe: async (x1, y1, x2, y2, ms, s) => { finite(x1, y1, x2, y2); await must(call('device:swipe', need(s), x1, y1, x2, y2, ms)); shotSoon(); },
      type: async (t, s) => { await must(call('device:text', need(s), t)); shotSoon(); },
      key: async (k, s) => { await must(call('device:key', need(s), k)); shotSoon(); },
      launch: async (p, s) => { await must(call('device:launch', need(s), p)); shotSoon(); },
      ui: async (s) => (await must(call('device:ui', need(s)))).nodes,
    };

    devices();
    return () => { clearInterval(timer); if (mode === 'stream') call('device:streamStop', node.id); player?.close(); offData(); offEnd(); };
  },
};
