const fs = require('fs'), path = require('path'), http = require('http');
const { session } = require('electron');

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);

  // A page that sets a cookie, echoes the user agent and has something to click and type into.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'seen=yes; Path=/' });
    res.end(`<!doctype html><title>Test page</title><body style="margin:0"><h1 id="head" style="margin:20px;width:300px;height:60px;background:#ccf">Hello portal</h1>
      <p id="ua">${String(req.headers['user-agent']).replace(/</g, '&lt;')}</p><button id="btn" onclick="document.getElementById('out').textContent='clicked'">Go</button>
      <input id="name"><div id="out"></div>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const mk = (data) => t.js(`addNode('portal', { x: 40, y: 40, w: 640, h: 420, data: ${JSON.stringify(data)} }, activeFloor()).id`);
  const portalJs = (id, code) => t.js(`rt.get(state.active).live.get('${id}').api.portal.view().executeJavaScript(${JSON.stringify(code)})`);
  const waitLoaded = async (id, needle) => {
    for (let i = 0; i < 60; i++) {
      await t.sleep(250);
      try { if ((await portalJs(id, 'document.readyState + "|" + document.body.innerText')).startsWith('complete') && (!needle || (await portalJs(id, 'document.body.innerText')).includes(needle))) return true; } catch {}
    }
    return false;
  };
  const cookies = async (partition) => (await session.fromPartition(partition).cookies.get({ name: 'seen' })).length;

  // ---- storage scope isolates cookies ----
  const iso = await mk({ url: base, scope: 'isolated' });
  t.check('isolated portal loads', await waitLoaded(iso, 'Hello portal'));
  t.check('isolated portal uses its own partition', (await t.js(`rt.get(state.active).live.get('${iso}').api.portal.partition()`)) === `persist:portal-${iso}`);
  t.check('isolated cookies stay out of the shared partition', await cookies(`persist:portal-${iso}`) === 1 && await cookies('persist:portal') === 0);

  const glob = await mk({ url: base });
  t.check('global portal loads', await waitLoaded(glob, 'Hello portal'));
  t.check('global portal writes to the shared partition', await cookies('persist:portal') === 1);

  // workspace scope
  const ws = await mk({ url: base, scope: 'workspace' });
  await waitLoaded(ws, 'Hello portal');
  const wsPart = await t.js(`rt.get(state.active).live.get('${ws}').api.portal.partition()`);
  t.check('workspace scope has a workspace-specific partition', /^persist:portal-ws-/.test(wsPart) && wsPart !== 'persist:portal', wsPart);

  // ---- settings dialog: change scope and user agent ----
  await t.js(`(() => { const el = rt.get(state.active).live.get('${iso}').el; el.querySelector('button[title^="Portal settings"]').click(); return 0; })()`);
  await t.sleep(300);
  const dlg = await t.js(`(() => { const m = document.querySelector('#modal-root'); const sel = m.querySelectorAll('select'); return { text: m.innerText, ua: [...sel[0].options].map((o) => o.value), scope: [...sel[1].options].map((o) => o.value) }; })()`);
  t.check('settings offers UA presets, a custom option and storage scopes', dlg.ua.join() === 'default,desktop,mobile,custom' && dlg.scope.join() === 'global,workspace,isolated', dlg);
  await t.js(`(() => { const m = document.querySelector('#modal-root'); const sel = m.querySelectorAll('select'); sel[0].value = 'mobile'; sel[0].dispatchEvent(new Event('change')); sel[1].value = 'global'; return 0; })()`);
  t.check('choosing a user agent warns about sign-in', /break sign-in/.test(await t.js(`(() => { const w = [...document.querySelectorAll('#modal-root .err')].find((x) => x.offsetParent); return w ? w.textContent : ''; })()`)));
  await t.js(`(() => { [...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Save').click(); return 0; })()`);
  await t.sleep(500);
  t.check('saving a new scope rebuilds the view on the shared partition', (await t.js(`rt.get(state.active).live.get('${iso}').api.portal.partition()`)) === 'persist:portal');
  t.check('mobile user agent reaches the page', await waitLoaded(iso, 'iPhone') && (await portalJs(iso, 'document.getElementById("ua").textContent')).includes('iPhone'));

  // ---- auto-reload of a local file ----
  const html = path.join(t.dataDir, 'local.html');
  fs.writeFileSync(html, '<!doctype html><body>version one</body>');
  const loc = await mk({ url: 'file:///' + html.replace(/\\/g, '/') });
  t.check('local file portal loads', await waitLoaded(loc, 'version one'));
  await t.sleep(600);
  fs.writeFileSync(html, '<!doctype html><body>version two</body>');
  t.check('the portal reloads when the local file changes', await waitLoaded(loc, 'version two'));

  // ---- design mode ----
  const term = await t.js(`addNode('terminal', { title: 'Agent', x: 760, y: 40 }, activeFloor()).id`);
  await t.js(`(() => { const f = activeFloor(); f.ropes.push({ id: uid(), a: '${glob}', b: '${term}' }); save(); wakeRopes(); window.__sent = []; rt.get(f.id).live.get('${term}').api.send = (x) => { window.__sent.push(x); }; return 0; })()`);
  await t.sleep(300);
  await t.js(`(() => { rt.get(state.active).live.get('${glob}').el.querySelector('button[title^="Design mode"]').click(); return 0; })()`);
  await t.sleep(700);
  t.check('design mode shows its banner', await t.js(`!!(rt.get(state.active).live.get('${glob}').el.querySelector('.portal-banner')?.offsetParent)`));
  // click the heading inside the page
  await portalJs(glob, `(() => { const r = document.getElementById('head').getBoundingClientRect(); const o = { clientX: r.left + 10, clientY: r.top + 10, bubbles: true }; window.dispatchEvent(new MouseEvent('mousemove', o)); window.dispatchEvent(new MouseEvent('mousedown', o)); window.dispatchEvent(new MouseEvent('mouseup', o)); return 1; })()`);
  await t.sleep(1500);
  const dialog = await t.js(`(() => { const m = document.querySelector('#modal-root'); return { text: m.innerText, img: m.querySelector('img')?.src.slice(0, 22), w: m.querySelector('img')?.naturalWidth }; })()`);
  t.check('picking an element opens a capture dialog with a screenshot', /Captured element/.test(dialog.text) && /#head|h1/.test(dialog.text) && dialog.img === 'data:image/png;base64,' && dialog.w > 50, dialog);
  await t.js(`(() => { const m = document.querySelector('#modal-root'); const ta = m.querySelector('textarea'); ta.value = 'Make it blue'; [...m.querySelectorAll('button')].find((b) => b.textContent === 'Send').click(); return 0; })()`);
  await t.sleep(400);
  const sent = (await t.js(`window.__sent[0] || ''`)).split(String.fromCharCode(27) + '[200~').join('').split(String.fromCharCode(27) + '[201~').join('');
  const shotPath = (/Screenshot: (.+)$/m.exec(sent) || [])[1];
  t.check('the message reaches the connected terminal with selector, request and image path', /Element: #head/.test(sent) && /Request: Make it blue/.test(sent) && shotPath && fs.existsSync(shotPath.trim()), sent);
  t.check('the screenshot is a PNG', shotPath && fs.readFileSync(shotPath.trim()).subarray(1, 4).toString() === 'PNG');

  // region by dragging
  await t.js(`(() => { rt.get(state.active).live.get('${glob}').el.querySelector('button[title^="Design mode"]').click(); return 0; })()`);
  await t.sleep(600);
  await portalJs(glob, `(() => { const f = (type, x, y) => window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })); f('mousemove', 20, 20); f('mousedown', 20, 20); f('mousemove', 120, 90); f('mouseup', 120, 90); return 1; })()`);
  await t.sleep(1500);
  const reg = await t.js(`document.querySelector('#modal-root').innerText`);
  t.check('dragging captures a region', /Captured region/.test(reg), reg);
  await t.js(`closeModal(); 0`);

  // Esc cancels
  await t.js(`(() => { rt.get(state.active).live.get('${glob}').el.querySelector('button[title^="Design mode"]').click(); return 0; })()`);
  await t.sleep(600);
  await portalJs(glob, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`);
  await t.sleep(700);
  t.check('Esc cancels design mode without a dialog', !(await t.js(`!!document.querySelector('#modal-root .modal')`)) && !(await t.js(`!!(rt.get(state.active).live.get('${glob}').el.querySelector('.portal-banner')?.offsetParent)`)));

  // ---- agent automation over ropes ----
  const bridge = (m, p, scope = 'peer') => t.js(`bridgeHandle(${JSON.stringify(m)}, ${JSON.stringify(p)}, '${term}', '${scope}').then((r) => ({ r }), (e) => ({ err: e.message }))`);
  const list = await bridge('portal-list', {});
  t.check('a terminal sees only the portal it is roped to', list.r?.length === 1 && list.r[0].id === glob, list);
  t.check('a Maestro sees every portal', (await bridge('portal-list', {}, 'maestro')).r.length >= 4);
  t.check('page text can be read', /Hello portal/.test((await bridge('portal-text', { target: '' })).r));
  await bridge('portal-type', { target: glob, selector: '#name', text: 'Ada' });
  t.check('typing fills the input', await portalJs(glob, 'document.getElementById("name").value') === 'Ada');
  await bridge('portal-click', { target: glob, selector: '#btn' });
  t.check('clicking runs the page handler', await portalJs(glob, 'document.getElementById("out").textContent') === 'clicked');
  t.check('a missing selector is an error', /No element/.test((await bridge('portal-click', { target: glob, selector: '#nope' })).err));
  const shot = await bridge('portal-shot', { target: glob });
  t.check('screenshot returns a file path', shot.r?.path && fs.existsSync(shot.r.path), shot);
  t.check('an unconnected portal is refused for a peer', /No portal/.test((await bridge('portal-text', { target: loc })).err));
  t.check('navigation works', (await bridge('portal-nav', { target: glob, url: base + '?x=1' })).r?.url === base + '?x=1');

  await t.sleep(800);
  server.close();
};
