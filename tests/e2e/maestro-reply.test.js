const http = require('http');
const bridge = require('../../src/services/bridge');

function rpc(env, method, params) {
  return new Promise((resolve) => {
    const req = http.request(`${env.ORCHESTRAI_URL}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ORCHESTRAI_TOKEN}` } }, (res) => {
      let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.end(JSON.stringify({ method, params, from: 'x' }));
  });
}

// A Maestro that sends work to a terminal must be told when it finishes, without any polling by the Maestro.
module.exports = async (t) => {
  const [m, w] = await t.js(`(() => { const mk = (title, data) => addNode('terminal', { title, data }).id; return [mk('Boss', { maestro: true }), mk('Worker', {})]; })()`);
  await t.sleep(4000);
  const env = bridge.envFor(m, 'x', 'maestro');
  const sent = await rpc(env, 'send', { target: 'Worker', text: 'Write-Output (4000+242)' });
  t.check('send succeeds', sent.ok, sent);
  let seen = '';
  for (let i = 0; i < 40 && !/finished the task/.test(seen); i++) {
    await t.sleep(1000);
    seen = await t.js(`allTerminals().find((x) => x.node.id === '${m}').entry.api.readScreen()`);
  }
  t.check('Maestro is told the worker finished, with its output', /"Worker" finished the task/.test(seen) && seen.includes('4242'), seen.slice(-400));
  t.check('the watch is cleared afterwards', await t.js(`!replyWatch.has('${w}')`));

  // Stop hook: Claude launches get --settings pointing at a file that calls `orchestrai-cli turn-end`.
  const cmd = await t.js(`withTurnHook('claude --model x')`);
  t.check('claude launch gets the turn hook', /^claude --settings ".+claude-turn-hook\.json" --model x$/.test(cmd), cmd);
  t.check('other commands and -p runs are untouched', await t.js(`(async () => (await withTurnHook('codex')) === 'codex' && (await withTurnHook('claude -p hi')) === 'claude -p hi')()`));
  const file = cmd.match(/"(.+)"/)[1];
  t.check('hook file runs orchestrai-cli turn-end on Stop', /orchestrai-cli turn-end/.test(require('fs').readFileSync(file, 'utf8')));
  const peerEnv = bridge.envFor(w, 'x', 'peer');
  const te = await rpc(peerEnv, 'turn-end', {});
  t.check('turn-end is accepted from a plain terminal', te.ok, te);
};
