// The web app served to paired devices. Everything is inline (no external requests), and all text from terminals is put on the
// page with textContent, never as HTML.

function html(nonce) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>OrchestrAI</title>
<style nonce="${nonce}">
  :root { --bg: #1a1a1c; --card: #2c2c2e; --fg: #f5f5f7; --muted: #98989d; --accent: #0a84ff; --ok: #30d158; --warn: #ff9f0a; --err: #ff453a; --border: #3a3a3c; }
  @media (prefers-color-scheme: light) { :root { --bg: #f6f6f6; --card: #fff; --fg: #1d1d1f; --muted: #6e6e73; --border: #d2d2d7; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
  header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--border); z-index: 2; }
  header h1 { font-size: 17px; margin: 0; flex: 1; }
  main { padding: 12px 16px 24px; max-width: 760px; margin: 0 auto; }
  button { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; min-height: 44px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:active { opacity: .7; }
  input { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; min-height: 44px; width: 100%; }
  .card { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin: 8px 0; width: 100%; text-align: left; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.running { background: var(--ok); } .dot.error, .dot.exited { background: var(--err); } .dot.attention { background: var(--warn); box-shadow: 0 0 0 4px #ff9f0a33; }
  .grow { flex: 1; min-width: 0; } .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .sub { color: var(--muted); font-size: 13px; }
  pre { margin: 8px 0; padding: 10px; background: #000; color: #e8e8e8; border-radius: 10px; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-all; overflow: auto; max-height: 52vh; min-height: 120px; }
  .keys { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; } .keys button { min-height: 40px; padding: 6px 12px; }
  .row { display: flex; gap: 8px; } .err { color: var(--err); } .hidden { display: none !important; }
  .banner { background: #ff9f0a22; border: 1px solid var(--warn); border-radius: 10px; padding: 8px 12px; margin: 8px 0; }
  h2 { font-size: 20px; margin: 16px 0 6px; }
</style>
</head>
<body>
<header><button id="back" class="hidden" aria-label="Back">‹</button><h1 id="title">OrchestrAI</h1><span id="live" class="sub"></span></header>
<main>
  <section id="pair" class="hidden">
    <h2>Pair this device</h2>
    <p class="sub">On the computer, open OrchestrAI, choose Remote control, and press “Pair a device”. Type the code it shows.</p>
    <p><input id="code" placeholder="Code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12"></p>
    <p><input id="devname" placeholder="Name for this device" maxlength="40"></p>
    <p><button id="go" class="primary">Pair</button></p>
    <p id="pairerr" class="err"></p>
  </section>
  <section id="list" class="hidden"><div id="alert" class="banner hidden"></div><div id="cards"></div><p id="empty" class="sub hidden">No terminals are open.</p>
    <p><button id="notify" class="hidden">Turn on notifications</button></p><p><button id="logout">Unpair this device</button></p></section>
  <section id="view" class="hidden">
    <pre id="screen" aria-live="polite"></pre>
    <div class="keys" id="keys"></div>
    <div class="row"><input id="text" placeholder="Type, then Send" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><button id="send" class="primary">Send</button></div>
    <p id="viewerr" class="err"></p>
  </section>
</main>
<script nonce="${nonce}">
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { method: opts.body ? 'POST' : 'GET', headers: { 'X-Orchestrai': '1', 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { show('pair'); throw new Error('Not paired'); }
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  };
  const sections = ['pair', 'list', 'view'];
  const show = (name) => { sections.forEach((s) => $(s).classList.toggle('hidden', s !== name)); $('back').classList.toggle('hidden', name !== 'view'); $('title').textContent = name === 'view' && current ? current.name : 'OrchestrAI'; };
  let current = null, terminals = [], screenTimer = null, events = null, lastAttention = new Set(), notifyOn = false;

  const KEYS = [['Enter', 'enter'], ['Esc', 'esc'], ['Ctrl+C', 'ctrl-c'], ['↑', 'up'], ['↓', 'down'], ['←', 'left'], ['→', 'right'], ['Tab', 'tab'], ['y', 'y'], ['n', 'n'], ['1', '1'], ['2', '2'], ['3', '3']];
  for (const [label, key] of KEYS) {
    const b = document.createElement('button'); b.textContent = label;
    b.addEventListener('click', () => sendKey(key));
    $('keys').append(b);
  }

  function renderList() {
    const cards = $('cards'); cards.replaceChildren();
    const needs = terminals.filter((t) => t.attention);
    $('alert').classList.toggle('hidden', !needs.length);
    $('alert').textContent = needs.length ? needs.length + (needs.length === 1 ? ' terminal needs' : ' terminals need') + ' your attention' : '';
    $('empty').classList.toggle('hidden', terminals.length > 0);
    document.title = (needs.length ? '(' + needs.length + ') ' : '') + 'OrchestrAI';
    for (const t of [...terminals].sort((a, b) => Number(b.attention) - Number(a.attention))) {
      const card = document.createElement('button'); card.className = 'card';
      const dot = document.createElement('span'); dot.className = 'dot ' + (t.attention ? 'attention' : t.status);
      const box = document.createElement('span'); box.className = 'grow';
      const name = document.createElement('div'); name.className = 'name'; name.textContent = t.name;
      const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = [t.floor, t.role, t.attention ? 'needs attention' : t.status].filter(Boolean).join(' · ');
      box.append(name, sub); card.append(dot, box);
      card.addEventListener('click', () => open(t));
      cards.append(card);
    }
  }

  function alertNew() {
    const now = new Set(terminals.filter((t) => t.attention).map((t) => t.id));
    for (const t of terminals) {
      if (now.has(t.id) && !lastAttention.has(t.id)) {
        if (navigator.vibrate) navigator.vibrate(200);
        if (notifyOn && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) { try { new Notification(t.name + ' needs attention'); } catch {} }
      }
    }
    lastAttention = now;
  }

  async function refresh() { terminals = (await api('/api/terminals')).terminals; renderList(); alertNew(); }

  function connect() {
    if (events) events.close();
    events = new EventSource('/api/events');
    events.addEventListener('terminals', (e) => { terminals = JSON.parse(e.data).terminals; renderList(); alertNew(); });
    events.onopen = () => { $('live').textContent = 'live'; };
    events.onerror = () => { $('live').textContent = 'reconnecting…'; };
  }

  async function loadScreen() {
    if (!current) return;
    try { const r = await api('/api/terminals/' + encodeURIComponent(current.id) + '/screen?lines=80'); const pre = $('screen'); const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20; pre.textContent = r.text || ''; if (stick) pre.scrollTop = pre.scrollHeight; $('viewerr').textContent = ''; }
    catch (e) { $('viewerr').textContent = e.message; }
  }

  function open(t) {
    current = t; show('view'); $('screen').textContent = 'Loading…';
    api('/api/terminals/' + encodeURIComponent(t.id) + '/ack', { body: {} }).catch(() => {});
    loadScreen(); clearInterval(screenTimer); screenTimer = setInterval(loadScreen, 1500);
  }
  function close() { current = null; clearInterval(screenTimer); show('list'); refresh().catch(() => {}); }

  async function sendText() {
    const v = $('text').value; if (!v || !current) return;
    try { await api('/api/terminals/' + encodeURIComponent(current.id) + '/input', { body: { text: v } }); $('text').value = ''; setTimeout(loadScreen, 300); } catch (e) { $('viewerr').textContent = e.message; }
  }
  async function sendKey(key) {
    if (!current) return;
    try { await api('/api/terminals/' + encodeURIComponent(current.id) + '/input', { body: { key } }); setTimeout(loadScreen, 300); } catch (e) { $('viewerr').textContent = e.message; }
  }

  $('back').addEventListener('click', close);
  $('send').addEventListener('click', sendText);
  $('text').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
  $('logout').addEventListener('click', async () => { try { await api('/api/logout', { body: {} }); } catch {} if (events) events.close(); show('pair'); });
  $('notify').addEventListener('click', async () => { try { notifyOn = (await Notification.requestPermission()) === 'granted'; $('notify').classList.toggle('hidden', notifyOn); } catch {} });
  $('go').addEventListener('click', async () => {
    $('pairerr').textContent = '';
    try { await api('/api/pair', { body: { code: $('code').value, name: $('devname').value } }); start(); } catch (e) { $('pairerr').textContent = e.message; }
  });

  async function start() {
    try { await api('/api/me'); } catch { show('pair'); return; }
    show('list');
    if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') { notifyOn = Notification.permission === 'granted'; $('notify').classList.toggle('hidden', notifyOn); }
    await refresh().catch(() => {}); connect();
  }
  start();
})();
</script>
</body>
</html>`;
}

module.exports = { html };
