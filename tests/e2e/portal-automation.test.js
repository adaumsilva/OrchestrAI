const http = require('http');

module.exports = async (t) => {
  // A page with a rich editor, a form that submits on Enter, tab order, and hidden/disabled controls.
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/slow')) { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<body>slow page</body>'); }, 1500); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Auto</title><body>
      <form id="f" onsubmit="event.preventDefault(); document.getElementById('res').textContent = 'submitted:' + document.getElementById('a').value + '|' + document.getElementById('b').value;">
        <input id="a"><input id="b"><button type="submit" id="go">go</button><div id="ed" contenteditable="true" style="border:1px solid #999;min-height:40px;width:300px"></div>
      </form>
      <button id="off" disabled>Off</button><button id="gone" style="display:none">Gone</button>
      <div id="res"></div><div id="focus"></div>
      <script>
        document.addEventListener('focusin', (e) => { document.getElementById('focus').textContent = e.target.id; });
        const ed = document.getElementById('ed');
        window.__beforeinput = 0; ed.addEventListener('beforeinput', () => window.__beforeinput++);
        // a rich editor that ignores the .value route and only reacts to real input events
        setTimeout(() => { const l = document.createElement('button'); l.id = 'late'; l.textContent = 'late'; document.body.append(l); }, 1200);
      </script></body>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const id = await t.js(`addNode('portal', { x: 40, y: 40, w: 640, h: 420, data: { url: ${JSON.stringify(base)}, scope: 'isolated' } }, activeFloor()).id`);
  const term = await t.js(`addNode('terminal', { title: 'Agent', x: 760, y: 40 }, activeFloor()).id`);
  await t.js(`(() => { const f = activeFloor(); f.ropes.push({ id: uid(), a: '${id}', b: '${term}' }); save(); wakeRopes(); return 0; })()`);
  await t.sleep(300);
  const bridge = (m, p) => t.js(`bridgeHandle(${JSON.stringify(m)}, ${JSON.stringify(p)}, '${term}', 'peer').then((r) => ({ r }), (e) => ({ err: e.message }))`);
  const page = (code) => t.js(`rt.get(state.active).live.get('${id}').api.portal.view().executeJavaScript(${JSON.stringify(code)})`);
  // wait for the page through the new wait command
  const w = await bridge('portal-wait', { target: id, selector: '#f', timeout: 15 });
  t.check('wait resolves once the selector is there', w.r?.ok, w);

  // ---- Tab moves between fields, typing goes to the focused one, Enter submits ----
  await bridge('portal-click', { target: id, selector: '#a' });
  await bridge('portal-type', { target: id, selector: '#a', text: 'Ada' });
  await bridge('portal-press', { target: id, key: 'Tab' });
  t.check('Tab moves focus to the next field', await page('document.activeElement.id') === 'b', await page('document.activeElement.id'));
  await bridge('portal-press', { target: id, key: 'Shift+Tab' });
  t.check('Shift+Tab moves back', await page('document.activeElement.id') === 'a');
  const typed = await bridge('portal-type', { target: id, selector: '#b', text: 'Lovelace', submit: true });
  t.check('type with --submit presses Enter', typed.r?.ok && await page('document.getElementById("res").textContent') === 'submitted:Ada|Lovelace', await page('document.getElementById("res").textContent'));
  await bridge('portal-type', { target: id, selector: '#a', text: ' Byron' });
  t.check('type appends by default', await page('document.getElementById("a").value') === 'Ada Byron');
  await bridge('portal-type', { target: id, selector: '#a', text: 'Grace', clear: true });
  t.check('--clear replaces the content', await page('document.getElementById("a").value') === 'Grace');

  // ---- rich editor: real input events reach it and --clear replaces ----
  await bridge('portal-type', { target: id, selector: '#ed', text: 'first line' });
  const ed1 = await page('document.getElementById("ed").textContent');
  t.check('typing into a contenteditable works', ed1 === 'first line', ed1);
  t.check('the editor saw real beforeinput events', await page('window.__beforeinput') > 0);
  await bridge('portal-type', { target: id, selector: '#ed', text: ' + more' });
  t.check('typing appends at the end of the editor', await page('document.getElementById("ed").textContent') === 'first line + more');
  await bridge('portal-type', { target: id, selector: '#ed', text: 'fresh', clear: true });
  t.check('--clear replaces the editor content', await page('document.getElementById("ed").textContent') === 'fresh', await page('document.getElementById("ed").textContent'));

  // ---- clear, specific errors ----
  t.check('missing element is named', /No element matches "#nope"/.test((await bridge('portal-click', { target: id, selector: '#nope' })).err));
  t.check('hidden element is explained', /not visible/.test((await bridge('portal-click', { target: id, selector: '#gone' })).err));
  t.check('disabled element is explained', /disabled/.test((await bridge('portal-click', { target: id, selector: '#off' })).err));
  t.check('typing into a non-input is explained', /not an input/.test((await bridge('portal-type', { target: id, selector: '#res', text: 'x' })).err));
  t.check('an empty key is refused', /No key/.test((await bridge('portal-press', { target: id, key: '' })).err));

  // ---- wait: an element that appears later, and a timeout ----
  const late = await bridge('portal-wait', { target: id, selector: '#late', timeout: 10 });
  t.check('wait picks up an element added later', late.r?.ok, late);
  const never = await bridge('portal-wait', { target: id, selector: '#never', timeout: 1 });
  t.check('wait times out with a clear message', /Timed out after 1s waiting for "#never"/.test(never.err), never);

  // ---- navigation: waits for the load, reports failures ----
  const slow = await bridge('portal-nav', { target: id, url: base + 'slow' });
  t.check('nav waits until the page has loaded', slow.r?.url === base + 'slow' && /slow page/.test(await page('document.body.innerText')), slow);
  const closedPort = await new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const bad = await bridge('portal-nav', { target: id, url: `http://127.0.0.1:${closedPort}/`, timeout: 15 });
  t.check('a failed load is reported with the reason', /Navigation failed: .*ERR_CONNECTION_REFUSED/.test(bad.err), bad);
  const ok = await bridge('portal-nav', { target: id, url: base });
  t.check('the portal recovers after a failed load', ok.r?.url === base, ok);

  server.close();
};
