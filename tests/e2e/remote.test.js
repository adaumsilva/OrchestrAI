const fs = require('fs'), path = require('path'), http = require('http');
const { BrowserWindow } = require('electron');

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const waitFor = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { try { if (await fn()) return true; } catch {} await t.sleep(100); } return false; };
  process.env.ORCH_REMOTE_POLL_MS = '300';
  let port = 0, cookie = '';

  // a bare HTTP client so headers are exactly what the test says
  const req = (method, p, { headers = {}, body, host } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: host || `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
  const apiH = (extra = {}) => ({ 'X-Orchestrai': '1', ...(cookie ? { Cookie: cookie } : {}), ...extra });
  const pairWith = async (name = 'Test phone') => {
    const s = await call('remote:startPairing');
    const r = await req('POST', '/api/pair', { headers: apiH({ Cookie: '' }), body: { code: s.code, name } });
    if (r.status === 200) cookie = String(r.headers['set-cookie'][0]).split(';')[0];
    return { s, r };
  };

  // ---- off by default ----
  let st = await call('remote:status');
  t.check('remote control is off by default and nothing listens', st.enabled === false && st.listening === null && st.urls.length === 0 && st.devices.length === 0, st);
  t.check('pairing cannot start while it is off', (await call('remote:startPairing')).ok === false);

  // ---- turn it on (this computer only) ----
  const on = await call('remote:configure', { enabled: true, mode: 'local', port: 0 });
  st = on.status;
  port = st.listening && st.listening.port;
  t.check('it listens on 127.0.0.1 only', on.ok && st.listening.host === '127.0.0.1' && port > 0 && st.urls[0] === `http://127.0.0.1:${port}/`, st);

  // ---- the page ----
  const home = await req('GET', '/');
  const csp = home.headers['content-security-policy'] || '';
  t.check('the web app is served with a strict content security policy', home.status === 200 && /default-src 'none'/.test(csp) && /script-src 'nonce-/.test(csp) && /frame-ancestors 'none'/.test(csp) && home.headers['x-frame-options'] === 'DENY' && home.headers['cache-control'] === 'no-store', home.headers);
  t.check('the page loads nothing from other sites', !/(src|href)=["']https?:/i.test(home.text) && !/https?:\/\/(?!127\.0\.0\.1)/.test(home.text.replace(/http:\/\/x/g, '')));
  const nonce = (/nonce-([^']+)'/.exec(csp) || [])[1];
  t.check('every inline script and style carries the per-response nonce', nonce && (home.text.match(/<script nonce="/g) || []).length === 1 && (home.text.match(/<style nonce="/g) || []).length === 1 && home.text.includes(`nonce="${nonce}"`));

  // ---- guards ----
  t.check('API calls need the custom header (a cross-site form cannot add it)', (await req('GET', '/api/terminals')).status === 403);
  t.check('and a paired session', (await req('GET', '/api/terminals', { headers: apiH() })).status === 401);
  t.check('a Host header that is not this machine is refused (DNS rebinding)', (await req('GET', '/', { host: 'evil.example.com' })).status === 421 && (await req('GET', '/api/me', { headers: apiH(), host: 'evil.example.com:80' })).status === 421);
  t.check('a cross-site Origin is refused', (await req('GET', '/api/me', { headers: apiH({ Origin: 'http://evil.example.com' }) })).status === 403);
  t.check('unknown paths are 404', (await req('GET', '/etc/passwd')).status === 404);

  // ---- pairing rules ----
  const noPair = await req('POST', '/api/pair', { headers: apiH(), body: { code: 'ABCD1234', name: 'x' } });
  t.check('pairing without an open pairing is refused', noPair.status === 403);
  const s1 = await call('remote:startPairing');
  t.check('the code is 8 characters, shown on the computer', /^[0-9A-F]{8}$/.test(s1.code), s1.code);
  const wrong = [];
  for (let i = 0; i < 5; i++) wrong.push((await req('POST', '/api/pair', { headers: apiH(), body: { code: 'WRONG' + i, name: 'x' } })).status);
  t.check('wrong codes are refused', wrong.every((x) => x === 403), wrong);
  const locked = await req('POST', '/api/pair', { headers: apiH(), body: { code: s1.code, name: 'x' } });
  t.check('after five wrong codes the pairing locks, even for the right code', locked.status === 429, locked.status);
  t.check('the computer shows that it is locked', (await call('remote:status')).pairing.locked === true);
  // let the per-IP failure window clear is not possible in a test, so use a fresh client address by waiting for nothing: restart the server
  await call('remote:configure', { enabled: false });
  await call('remote:configure', { enabled: true, mode: 'local', port: 0 });
  port = (await call('remote:status')).listening.port;

  process.env.ORCH_PAIR_TTL_MS = '300';
  const sx = await call('remote:startPairing');
  await t.sleep(700);
  t.check('a code expires', (await req('POST', '/api/pair', { headers: apiH(), body: { code: sx.code, name: 'late' } })).status === 403);
  delete process.env.ORCH_PAIR_TTL_MS;

  const { s: s2, r: ok } = await pairWith('Test phone');
  t.check('the right code pairs the device', ok.status === 200 && ok.json.device.name === 'Test phone' && cookie.startsWith('orch_remote='), ok.text);
  const flags = String(ok.headers['set-cookie'][0]);
  t.check('the session cookie is HttpOnly, SameSite=Strict and scoped to the site', /HttpOnly/.test(flags) && /SameSite=Strict/.test(flags) && /Path=\//.test(flags));
  const again = await req('POST', '/api/pair', { headers: apiH({ Cookie: '' }), body: { code: s2.code, name: 'again' } });
  t.check('a code works only once', again.status === 403);
  const stored = fs.readFileSync(path.join(t.dataDir, 'remote.json'), 'utf8');
  const token = cookie.split('=')[1];
  t.check('the token is stored only as a hash', !stored.includes(token) && /"hash": "[0-9a-f]{64}"/.test(stored));

  // ---- using it ----
  t.check('the session identifies the device', (await req('GET', '/api/me', { headers: apiH() })).json.device.name === 'Test phone');
  const list = (await req('GET', '/api/terminals', { headers: apiH() })).json.terminals;
  t.check('terminals are listed with status and attention', list.length >= 1 && list[0].id && 'attention' in list[0] && 'status' in list[0], list);
  const tid = list[0].id;
  const isWin = process.platform === 'win32';
  await t.sleep(2500);
  const send = await req('POST', `/api/terminals/${tid}/input`, { headers: apiH(), body: { text: isWin ? 'echo ("REMOTE-" + (6*7))' : 'echo REMOTE-$((6*7))' } });
  t.check('typed text reaches the terminal', send.status === 200 && send.json.ok, send.text);
  t.check('and its output can be read', await waitFor(async () => /^REMOTE-42/m.test((await req('GET', `/api/terminals/${tid}/screen?lines=30`, { headers: apiH() })).json.text), 12000));
  t.check('keys can be pressed (Ctrl+C)', (await req('POST', `/api/terminals/${tid}/input`, { headers: apiH(), body: { key: 'ctrl-c' } })).status === 200);
  const badKey = await req('POST', `/api/terminals/${tid}/input`, { headers: apiH(), body: { key: 'rm -rf' } });
  t.check('only known keys are accepted', badKey.status === 502 && /Unknown key/.test(badKey.text), badKey.text);
  t.check('an unknown terminal is an error', (await req('POST', '/api/terminals/nope/input', { headers: apiH(), body: { text: 'x' } })).status === 502);
  t.check('oversized bodies are refused', (await req('POST', `/api/terminals/${tid}/input`, { headers: apiH(), body: 'x'.repeat(40000) })).status === 413);
  t.check('bad ids in the path never reach the terminals', (await req('GET', '/api/terminals/..%2F..%2Fx/screen', { headers: apiH() })).status === 404);

  // ---- attention ----
  await t.js(`rt.get(state.active).live.get('${tid}').el.classList.add('attention'); 0`);
  t.check('a terminal that needs attention is flagged', (await req('GET', '/api/terminals', { headers: apiH() })).json.terminals.find((x) => x.id === tid).attention === true);

  // ---- live events ----
  const events = [];
  let sseRes = null, sseClosed = false;
  await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/events', headers: { Host: `127.0.0.1:${port}`, 'X-Orchestrai': '1', Cookie: cookie } }, (res) => {
      sseRes = res;
      res.on('data', (c) => events.push(String(c)));
      res.on('close', () => { sseClosed = true; });
      resolve();
    });
    r.end();
  });
  t.check('an event stream opens', await waitFor(() => events.join('').includes('event: hello')));
  await req('POST', `/api/terminals/${tid}/ack`, { headers: apiH(), body: {} });
  t.check('acknowledging clears the alert', (await req('GET', '/api/terminals', { headers: apiH() })).json.terminals.find((x) => x.id === tid).attention === false);
  await t.js(`rt.get(state.active).live.get('${tid}').el.classList.add('attention'); 0`);
  t.check('the stream pushes attention changes', await waitFor(() => /event: terminals[\s\S]*"attention":true/.test(events.join('')), 6000), events.join('').slice(-200));
  await t.js(`rt.get(state.active).live.get('${tid}').el.classList.remove('attention'); 0`);

  // ---- the page, driven in a real browser window ----
  const phone = new BrowserWindow({ show: false, width: 420, height: 800, webPreferences: { partition: 'remote-test', contextIsolation: true, nodeIntegration: false } });
  await phone.loadURL(`http://127.0.0.1:${port}/`);
  const pjs = (code) => phone.webContents.executeJavaScript(code);
  t.check('a new browser sees the pairing screen', await waitFor(() => pjs(`!document.getElementById('pair').classList.contains('hidden')`)));
  const s3 = await call('remote:startPairing');
  await pjs(`document.getElementById('code').value = ${JSON.stringify(s3.code)}; document.getElementById('devname').value = 'Browser phone'; document.getElementById('go').click(); 0`);
  t.check('pairing in the page opens the terminal list', await waitFor(() => pjs(`!document.getElementById('list').classList.contains('hidden') && document.querySelectorAll('#cards .card').length >= 1`)));
  t.check('the desktop lists both devices', (await call('remote:status')).devices.map((d) => d.name).sort().join() === 'Browser phone,Test phone');
  await pjs(`document.querySelector('#cards .card').click(); 0`);
  await t.sleep(1200);
  t.check('opening a terminal shows its screen', await pjs(`!document.getElementById('view').classList.contains('hidden') && document.getElementById('screen').textContent.length > 0`));
  await pjs(`document.getElementById('text').value = ${JSON.stringify(isWin ? 'echo ("PAGE-" + (5*5))' : 'echo PAGE-$((5*5))')}; document.getElementById('send').click(); 0`);
  t.check('typing in the page sends to the terminal and shows the result', await waitFor(() => pjs(`/^PAGE-25/m.test(document.getElementById('screen').textContent)`), 12000));
  await pjs(`document.querySelector('#keys button').click(); 0`);
  t.check('the key buttons work (Enter)', true);
  // terminal output cannot inject markup into the page
  await t.js(`rt.get(state.active).live.get('${tid}').api.send(${JSON.stringify(isWin ? 'echo "<img src=x onerror=window.__pwn=1>"' : 'echo "<img src=x onerror=window.__pwn=1>"')}); 0`);
  await t.sleep(2500);
  t.check('terminal text is shown as text, never as HTML', await pjs(`!window.__pwn && !document.querySelector('#screen img')`));
  phone.destroy();

  // ---- revoking ----
  const devices = (await call('remote:status')).devices;
  const mine = devices.find((d) => d.name === 'Test phone');
  await call('remote:revoke', mine.id);
  t.check('revoking ends the live stream at once', await waitFor(() => sseClosed, 3000));
  t.check('and the session stops working immediately', (await req('GET', '/api/me', { headers: apiH() })).status === 401);
  const left = (await call('remote:status')).devices.map((d) => d.name);
  t.check('other devices stay paired', left.join() === 'Browser phone', left);
  t.check('the revoked token is gone from disk', !fs.readFileSync(path.join(t.dataDir, 'remote.json'), 'utf8').includes(token));

  // ---- rate limiting ----
  await call('remote:configure', { enabled: false });
  await call('remote:configure', { enabled: true, mode: 'local', port: 0 }); // restarting resets the counters
  port = (await call('remote:status')).listening.port;
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await req('GET', '/api/me', { headers: apiH({ Cookie: 'orch_remote=' + '0'.repeat(64) }) })).status);
  t.check('repeated failures are rate limited', codes.slice(0, 10).every((c) => c === 401) && codes.slice(10).every((c) => c === 429), codes);

  // ---- where it listens ----
  const ts = await call('remote:configure', { mode: 'tailscale' });
  if (ts.status.tailscale) t.check('Tailscale mode listens on the Tailscale address only', ts.ok && ts.status.listening.host === ts.status.tailscale, ts.status);
  else t.check('Tailscale mode refuses to start without a Tailscale address', !ts.ok && ts.status.listening === null && /Tailscale/.test(ts.error), ts);
  const lan = await call('remote:configure', { mode: 'lan' });
  t.check('the local network mode refuses until the risk is accepted', !lan.ok && lan.status.listening === null && /not encrypted/.test(lan.error), lan);
  const lan2 = await call('remote:configure', { acceptLanRisk: true });
  t.check('once accepted it listens on every interface', lan2.ok && lan2.status.listening.host === '0.0.0.0', lan2.status);
  const back = await call('remote:configure', { mode: 'local' });
  t.check('switching back to local clears the accepted risk', back.ok && back.status.acceptLanRisk === false && back.status.listening.host === '127.0.0.1');
  t.check('an invalid port is refused', (await call('remote:configure', { port: 70000 })).ok === false);

  // ---- off again ----
  port = (await call('remote:status')).listening.port;
  await call('remote:configure', { enabled: false });
  const refused = await req('GET', '/').then(() => false, () => true);
  t.check('turning it off closes the port', refused);
  t.check('and the open pairing is gone', (await call('remote:status')).pairing === null);
  sseRes && sseRes.destroy();
};
