// Embedded browser. Per-portal user agent, storage scope, design mode (pick an element or region and hand it to a connected
// terminal), auto-reload for local files, and a small automation surface the orchestrai CLI uses through ropes.
const PORTAL_UA = {
  default: { label: 'Default (app)', ua: '' },
  desktop: { label: 'Desktop Chrome', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
  mobile: { label: 'Mobile Safari (iPhone)', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  custom: { label: 'Custom…', ua: '' },
};
const PORTAL_SCOPES = {
  global: 'Shared by all portals (default)',
  workspace: 'Shared inside this workspace',
  isolated: 'Isolated: only this portal',
};

function portalPartition(node, floor) {
  const scope = node.data.scope || 'global';
  if (scope === 'isolated') return `persist:portal-${node.id}`;
  if (scope === 'workspace') return `persist:portal-ws-${(typeof wsOfFloor === 'function' && wsOfFloor(floor.id)?.id) || 'default'}`;
  return 'persist:portal';
}

function portalUserAgent(data) {
  const p = data.uaPreset || 'default';
  return p === 'custom' ? (data.customUa || '') : (PORTAL_UA[p]?.ua || '');
}

// Runs inside the page: hover highlights an element, click picks it, dragging picks a region, Esc cancels.
// The result lands in window.__orchResult for the host to collect.
function portalPagePicker() {
  if (window.__orchPicker) window.__orchPicker.stop();
  window.__orchResult = null;
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', zIndex: 2147483647, pointerEvents: 'none', border: '2px solid #0a84ff', background: 'rgba(10,132,255,.18)', left: '0', top: '0', width: '0', height: '0', boxSizing: 'border-box' });
  document.documentElement.append(box);
  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';
  const place = (r) => Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
  const at = (x, y) => document.elementFromPoint(x, y);
  const selectorOf = (el) => {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; n = n.parentElement, i++) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift('#' + n.id); break; }
      let part = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  let start = null, moved = false;
  const stop = () => {
    for (const [t, f] of Object.entries(handlers)) window.removeEventListener(t, f, true);
    box.remove();
    document.documentElement.style.cursor = prevCursor;
    window.__orchPicker = null;
  };
  const finish = (res) => { stop(); window.__orchResult = res; };
  const handlers = {
    mousemove(e) {
      e.preventDefault(); e.stopPropagation();
      if (start) {
        const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY), w = Math.abs(e.clientX - start.x), hh = Math.abs(e.clientY - start.y);
        if (w > 6 || hh > 6) moved = true;
        place({ x, y, width: w, height: hh });
      } else {
        const el = at(e.clientX, e.clientY);
        if (el) { const r = el.getBoundingClientRect(); place({ x: r.left, y: r.top, width: r.width, height: r.height }); }
      }
    },
    mousedown(e) { e.preventDefault(); e.stopPropagation(); start = { x: e.clientX, y: e.clientY }; moved = false; },
    mouseup(e) {
      e.preventDefault(); e.stopPropagation();
      if (!start) return;
      let rect, el;
      if (moved) {
        rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) };
        el = at(rect.x + rect.width / 2, rect.y + rect.height / 2);
      } else {
        el = at(e.clientX, e.clientY);
        const r = el ? el.getBoundingClientRect() : { left: e.clientX, top: e.clientY, width: 1, height: 1 };
        rect = { x: r.left, y: r.top, width: r.width, height: r.height };
      }
      finish({
        mode: moved ? 'region' : 'element', rect, url: location.href, title: document.title,
        selector: el ? selectorOf(el) : '', tag: el ? el.tagName.toLowerCase() : '',
        text: el ? (el.innerText || '').trim().slice(0, 300) : '', html: el ? el.outerHTML.slice(0, 500) : '',
      });
    },
    click(e) { e.preventDefault(); e.stopPropagation(); },
    keydown(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish({ cancelled: true }); } },
  };
  for (const [t, f] of Object.entries(handlers)) window.addEventListener(t, f, true);
  window.__orchPicker = { stop };
  return true;
}

NodeKinds.portal = {
  label: 'Portal', w: 640, h: 440,
  mount({ node, body, save, floor, addButton, entry }) {
    node.data.url ||= 'https://www.google.com';
    const url = h('input', { value: node.data.url });
    const holder = h('div', { class: 'portal-holder' });
    const banner = h('div', { class: 'portal-banner', style: 'display:none' });
    let view = null, ready = false;
    const nav = (fn) => () => { try { fn(); } catch {} };

    function buildView() {
      ready = false;
      const attrs = { src: node.data.url, partition: portalPartition(node, floor), class: 'portal-view' };
      const ua = portalUserAgent(node.data);
      if (ua) attrs.useragent = ua;
      view = h('webview', attrs);
      view.addEventListener('dom-ready', () => { ready = true; });
      view.addEventListener('did-navigate', onNav);
      view.addEventListener('did-navigate-in-page', onNav);
      view.addEventListener('page-title-updated', (e) => { node.data.pageTitle = e.title; });
      holder.replaceChildren(view);
      setupWatch();
    }

    body.append(
      h('div', { class: 'row' },
        h('button', { title: 'Back', onclick: nav(() => view.goBack()) }, '←'),
        h('button', { title: 'Forward', onclick: nav(() => view.goForward()) }, '→'),
        h('button', { title: 'Reload', onclick: nav(() => view.reload()) }, '⟳'),
        url,
        h('button', { title: 'DevTools', onclick: nav(() => view.openDevTools()) }, '{}')),
      banner, holder);

    const normalize = (v) => {
      v = v.trim();
      if (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(v)) return 'http://' + v;
      if (/^[a-z]+:\/\//i.test(v)) return v;
      if (/^[a-zA-Z]:[\\/]/.test(v)) return 'file:///' + v.replace(/\\/g, '/');
      if (/^[^\s]+\.[^\s]+$/.test(v)) return 'https://' + v;
      return 'https://www.google.com/search?q=' + encodeURIComponent(v);
    };
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { node.data.url = normalize(url.value); view.loadURL(node.data.url); setupWatch(); } });
    function onNav(e) { if (e.url && e.url !== 'about:blank') { url.value = e.url; node.data.url = e.url; save(); setupWatch(); } }

    // ---------- auto-reload of local files ----------
    const localPath = () => {
      const m = /^file:\/\/\/?(.*)$/i.exec(node.data.url || '');
      if (!m) return null;
      let p = decodeURIComponent(m[1].split(/[?#]/)[0]);
      if (!/^[a-zA-Z]:/.test(p) && !p.startsWith('/')) p = '/' + p;
      return p;
    };
    const dirOf = (p) => (/\.[^\\/]+$/.test(p) ? p.replace(/[\\/][^\\/]*$/, '') : p);
    let watching = null;
    async function setupWatch() {
      const p = node.data.autoReload !== false ? localPath() : null;
      const dir = p ? dirOf(p) : null;
      if (dir === watching) return;
      watching = dir;
      if (!dir) { call('files:unwatch', node.id); return; }
      await call('files:watch', node.id, dir);
    }
    const off = api.on('files:changed', (id) => { if (id === node.id) { try { view.reloadIgnoringCache(); } catch {} } });

    // ---------- settings ----------
    function settingsDialog() {
      const name = h('input', { value: node.title });
      const preset = h('select', {}, Object.entries(PORTAL_UA).map(([k, v]) => h('option', { value: k, selected: k === (node.data.uaPreset || 'default') }, v.label)));
      const custom = h('input', { value: node.data.customUa || '', placeholder: 'Mozilla/5.0 …' });
      const warn = h('div', { class: 'err', style: 'display:none' }, 'Changing the user agent can break sign-in on some sites.');
      const scope = h('select', {}, Object.entries(PORTAL_SCOPES).map(([k, v]) => h('option', { value: k, selected: k === (node.data.scope || 'global') }, v)));
      const auto = h('input', { type: 'checkbox', checked: node.data.autoReload !== false });
      const sync = () => { custom.style.display = preset.value === 'custom' ? '' : 'none'; warn.style.display = preset.value === 'default' ? 'none' : ''; };
      preset.addEventListener('change', sync); sync();
      modal({
        title: 'Portal settings',
        content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:380px' },
          h('label', {}, 'Name', name), h('label', {}, 'User agent', preset), custom, warn,
          h('label', {}, 'Storage (cookies and logins)', scope),
          h('div', { class: 'muted' }, 'Changing the storage scope reloads the page; sessions do not carry over.'),
          h('label', { class: 'check' }, auto, 'Reload automatically when a local file changes')),
        actions: [{ label: 'Cancel', onClick: (c) => c() }, {
          label: 'Save', primary: true, onClick: (c) => {
            const before = JSON.stringify([portalPartition(node, floor), portalUserAgent(node.data)]);
            node.data.uaPreset = preset.value; node.data.customUa = custom.value.trim(); node.data.scope = scope.value; node.data.autoReload = auto.checked;
            const title = name.value.trim();
            if (title && title !== node.title) { node.title = title; const t = entry.el.querySelector('.title'); if (t) t.textContent = title; }
            save(); c();
            if (before !== JSON.stringify([portalPartition(node, floor), portalUserAgent(node.data)])) buildView(); else setupWatch();
          },
        }],
      });
    }
    addButton('⚙', 'Portal settings: user agent, storage, auto-reload', settingsDialog);

    // ---------- design mode ----------
    let picking = false;
    const designBtn = addButton('◩', 'Design mode: pick an element or drag a region to send to a connected terminal', () => (picking ? cancelPick() : startPick()));

    const pageJs = (code) => view.executeJavaScript(code);
    function cancelPick() { picking = false; designBtn.classList.remove('active'); banner.style.display = 'none'; pageJs('window.__orchPicker && window.__orchPicker.stop(); 0').catch(() => {}); }

    async function pick() {
      await pageJs(`(${portalPagePicker})()`);
      for (;;) {
        await new Promise((r) => setTimeout(r, 150));
        if (!picking) return null;
        const res = await pageJs('window.__orchResult || null').catch(() => null);
        if (res) { await pageJs('window.__orchResult = null; 0').catch(() => {}); return res; }
      }
    }

    async function startPick() {
      if (!ready) return alertModal('Design mode', 'The page is still loading.');
      picking = true; designBtn.classList.add('active');
      banner.style.display = '';
      banner.textContent = 'Design mode: click an element or drag a region. Esc cancels.';
      let res;
      try { res = await pick(); } catch (e) { cancelPick(); return alertModal('Design mode', e.message); }
      picking = false; designBtn.classList.remove('active'); banner.style.display = 'none';
      if (!res || res.cancelled) return;
      const shot = await call('portal:capture', view.getWebContentsId(), res.rect);
      if (shot.error) return alertModal('Design mode', shot.error);
      designDialog(res, shot);
    }

    const connectedTerminals = () => allTerminals().filter((t) => t.floor.id === floor.id && floor.ropes.some((r) => (r.a === node.id && r.b === t.node.id) || (r.b === node.id && r.a === t.node.id)));

    function designDialog(res, shot) {
      const note = h('textarea', { placeholder: 'What should change? (optional)', rows: 3 });
      const targets = connectedTerminals();
      const pickTarget = h('select', {}, targets.map((t) => h('option', { value: t.node.id }, t.node.title)));
      const message = () => [
        `Design feedback on ${res.url}`,
        res.selector ? `Element: ${res.selector}${res.text ? ` ("${res.text.replace(/\s+/g, ' ').slice(0, 80)}")` : ''}` : `Region: ${Math.round(res.rect.width)}x${Math.round(res.rect.height)} at ${Math.round(res.rect.x)},${Math.round(res.rect.y)}`,
        note.value.trim() ? `Request: ${note.value.trim()}` : '',
        `Screenshot: ${shot.path}`,
      ].filter(Boolean).join('\n');
      modal({
        title: res.mode === 'region' ? 'Captured region' : 'Captured element',
        content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:420px' },
          h('img', { src: shot.dataUrl, style: 'max-width:100%;max-height:220px;object-fit:contain;border:1px solid var(--border);border-radius:6px' }),
          h('div', { class: 'mono muted' }, res.selector || `${shot.width}x${shot.height}`),
          note,
          targets.length ? h('label', {}, 'Send to', pickTarget) : h('div', { class: 'muted' }, 'No terminal is connected to this portal. Connect one with a rope to send it directly, or copy the message.')),
        actions: [
          { label: 'Close', onClick: (c) => c() },
          { label: 'Copy message', onClick: (c) => { navigator.clipboard.writeText(message()); c(); } },
          ...(targets.length ? [{
            label: 'Send', primary: true, onClick: async (c) => {
              const t = targets.find((x) => x.node.id === pickTarget.value) || targets[0];
              const text = message();
              await t.entry?.api.send?.(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
              c();
            },
          }] : []),
        ],
      });
    }

    // ---------- automation surface (used by the bridge) ----------
    Object.assign(entry.api, {
      portal: {
        url: () => node.data.url,
        title: () => node.data.pageTitle || '',
        navigate: (u) => { node.data.url = normalize(u); view.loadURL(node.data.url); save(); },
        text: async (max = 20000) => String(await pageJs('document.body ? document.body.innerText : ""')).slice(0, max),
        click: (sel) => pageJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`),
        type: (sel, text) => pageJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`),
        shot: () => call('portal:capture', view.getWebContentsId(), null),
        pick: () => pageJs(`(${portalPagePicker})()`),
        partition: () => view.partition || view.getAttribute('partition'),
        view: () => view,
      },
    });

    buildView();
    return () => { off(); call('files:unwatch', node.id); };
  },
};
