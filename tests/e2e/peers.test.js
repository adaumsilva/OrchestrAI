const http = require('http');
const bridge = require('../../src/services/bridge');

function rpc(env, method, params) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ method, params, from: 'spoofed' });
    const req = http.request(`${env.ORCHESTRAI_URL}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ORCHESTRAI_TOKEN}` } }, (res) => {
      let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.end(body);
  });
}

module.exports = async (t) => {
  const ids = await t.js(`(() => { const f = activeFloor(); const mk = (title) => addNode('terminal', { title, data: {} }).id; const a = mk('Alpha'), b = mk('Beta'), c = mk('Gamma'); f.ropes.push({ id: 'r1', a, b }); save(); wakeRopes(); return [a, b, c]; })()`);
  const [a, b, c] = ids;
  await t.sleep(4000); // shells start
  const envA = bridge.envFor(a, 'x', 'peer');

  const peers = await rpc(envA, 'peers', {});
  t.check('peers lists only the connected terminal', peers.ok && peers.result.length === 1 && peers.result[0].name === 'Beta', peers);

  const denied = await rpc(envA, 'ask', { target: 'Gamma', text: 'echo nope' });
  t.check('unconnected peer is rejected', !denied.ok && /not connected/.test(denied.error), denied);
  const unknown = await rpc(envA, 'check', { target: 'Nobody' });
  t.check('unknown peer is rejected', !unknown.ok && /No peer/.test(unknown.error), unknown);
  const noMaestro = await rpc(envA, 'list', {});
  t.check('peer scope cannot use maestro methods', !noMaestro.ok && /not a Maestro/.test(noMaestro.error), noMaestro);
  const send = await rpc(envA, 'send', { target: 'Gamma', text: 'echo nope' });
  t.check('peer scope cannot send to arbitrary terminals', !send.ok, send);

  // allowed: Beta answers; rope flashes while waiting
  const flashed = t.js(`new Promise((res) => { let seen = false; const iv = setInterval(() => { const sim = [...sims.values()].some((s) => s.flashUntil > performance.now()); if (sim) seen = true; }, 100); setTimeout(() => { clearInterval(iv); res(seen); }, 3500); })`);
  const ok = await rpc(envA, 'ask', { target: 'Beta', text: 'Write-Output (1000+337)', quiet: 1.2, timeout: 30 });
  t.check('ask returns the peer response', ok.ok && ok.result.includes('1337'), ok);
  t.check('rope animates during the exchange', await flashed);

  const chk = await rpc(envA, 'check', { target: b, lines: 5 });
  t.check('check returns status and screen', chk.ok && typeof chk.result.status === 'string' && chk.result.screen.length > 0, chk);

  // timeout path
  const slow = await rpc(envA, 'ask', { target: 'Beta', text: 'Start-Sleep 6', quiet: 4, timeout: 1.5 });
  t.check('ask times out with an error', !slow.ok && /Timed out/.test(slow.error), slow);

  // a maestro-scoped token can reach any terminal
  await t.js(`(() => { const n = activeFloor().nodes.find((x) => x.id === '${a}'); n.data.maestro = true; })()`);
  const envM = bridge.envFor(a, 'x', 'maestro');
  const m = await rpc(envM, 'peers', {});
  t.check('maestro scope sees every other terminal', m.ok && m.result.length >= 3, m);
  const mk = await rpc(envM, 'check', { target: 'Gamma' });
  t.check('maestro scope can address unconnected terminals', mk.ok, mk);
  // a bad token is refused
  const bad = await rpc({ ORCHESTRAI_URL: envA.ORCHESTRAI_URL, ORCHESTRAI_TOKEN: 'nope' }, 'peers', {});
  t.check('unknown token is unauthorized', bad.ok === false && bad.error === 'Unauthorized', bad);
};
