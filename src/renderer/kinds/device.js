// Android device/emulator control over adb: live screen, tap/swipe, keys, text, app launch, UI tree.
NodeKinds.device = {
  label: 'Device', w: 400, h: 620,
  mount({ node, body, save, entry }) {
    let live = false, busy = false, timer = null, shot = null;

    const sel = h('select', { style: 'flex:1;min-width:0' });
    const msg = h('div', { class: 'err' });
    const img = h('img', { draggable: 'false' });
    const screen = h('div', { class: 'device-screen' }, img);
    const uiList = h('div', { class: 'scroll', style: 'display:none;flex:none;max-height:35%' });
    const text = h('input', { placeholder: 'Type text on device' });
    const pkg = h('input', { placeholder: 'package.name to launch', value: node.data.pkg || '' });
    const serial = () => sel.value;
    const press = (k) => serial() && call('device:key', serial(), k).then(() => shotSoon());

    async function devices() {
      const r = await call('device:list');
      msg.textContent = r.error || (r.devices.length ? '' : 'No devices. Start an emulator or enable USB debugging.');
      const ready = r.devices.filter((d) => d.state === 'device');
      const keep = sel.value;
      sel.replaceChildren(...ready.map((d) => h('option', { value: d.serial }, d.model ? `${d.model} (${d.serial})` : d.serial)));
      if (ready.some((d) => d.serial === keep)) sel.value = keep;
      else if (node.data.serial && ready.some((d) => d.serial === node.data.serial)) sel.value = node.data.serial;
      if (sel.value) shotSoon();
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
    const shotSoon = () => setTimeout(screenshot, 400);

    function setLive(on) {
      live = on;
      liveBtn.classList.toggle('active', on);
      clearInterval(timer);
      if (on) timer = setInterval(() => { if (body.offsetWidth) screenshot(); }, 1000);
    }

    const toPoint = (e) => {
      const r = img.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * img.naturalWidth, ((e.clientY - r.top) / r.height) * img.naturalHeight];
    };
    let down = null;
    img.addEventListener('mousedown', (e) => { e.stopPropagation(); down = toPoint(e); });
    img.addEventListener('mouseup', async (e) => {
      if (!down || !serial()) return;
      const [x, y] = toPoint(e), [x0, y0] = down;
      down = null;
      if (Math.hypot(x - x0, y - y0) > img.naturalWidth * 0.03) await call('device:swipe', serial(), x0, y0, x, y);
      else await call('device:tap', serial(), x, y);
      shotSoon();
    });

    const liveBtn = h('button', { title: 'Refresh the screen every second', onclick: () => setLive(!live) }, 'Live');
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

    sel.addEventListener('change', () => { node.data.serial = sel.value; save(); shotSoon(); });
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

    body.append(
      h('div', { class: 'row' }, sel, h('button', { title: 'Rescan devices', onclick: devices }, '⟳'), liveBtn, uiBtn),
      msg, screen, uiList,
      h('div', { class: 'row' },
        h('button', { onclick: () => press('back') }, '◀ Back'),
        h('button', { onclick: () => press('home') }, '● Home'),
        h('button', { onclick: () => press('recents') }, '■ Recents'),
        h('button', { onclick: () => press('enter') }, 'Enter')),
      h('div', { class: 'row' }, text),
      h('div', { class: 'row' }, pkg));

    // Other nodes can type text into the device.
    entry.api.send = (t) => serial() && call('device:text', serial(), t).then(shotSoon);

    devices();
    return () => clearInterval(timer);
  },
};
