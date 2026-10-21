// Prompt delivery to an idle agent (Maestro -> terminal): a TUI that swallows the Enter right after a paste must still get the message submitted.
// The fake agent is written without backslashes on purpose (control characters come from fromCharCode) so nothing is mangled on the way to the shell.
const fs = require('fs'), os = require('os'), path = require('path');

const FAKE_TUI = `
const C = String.fromCharCode;
let buf = '', last = 0, ignored = 0;
if (process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  const s = String(d), now = Date.now();
  if (s === C(13)) {
    if (now - last < 1200 && ignored < 1) { ignored++; return; }
    console.log('SUBMITTED:' + buf.split(C(27) + '[200~').join('').split(C(27) + '[201~').join('').split(C(10)).join(' '));
    buf = '';
    return;
  }
  buf += s; last = now;
  setTimeout(() => console.log('repaint'), 700); // an idle TUI redraws late; that is not a reaction to Enter
});
console.log('TUI-READY');
setInterval(() => {}, 1000);
`;

module.exports = async (t) => {
  const script = path.join(os.tmpdir(), `orch-tui-${process.pid}.js`);
  fs.writeFileSync(script, FAKE_TUI);
  const id = await t.js(`addNode('terminal', { title: 'Idle agent', data: {} }, activeFloor()).id`);
  const api = (code) => t.js(`(() => { const a = rt.get(state.active).live.get('${id}').api; return ${code}; })()`);
  await t.sleep(4000);
  await api(`a.send(${JSON.stringify(`node "${script.split(path.sep).join('/')}"`)})`);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { await t.sleep(250); ready = /TUI-READY/.test(await api('a.readScreen()')); }
  t.check('the fake agent started', ready, await api('a.readScreen()'));
  await t.sleep(5000); // let it sit idle

  const delivered = await t.js(`deliverPrompt(allTerminals().find((x) => x.node.id === '${id}'), 'do the task' + String.fromCharCode(10) + 'second line')`);
  const flat = (await api('a.readScreen()')).split(String.fromCharCode(10)).join('');
  t.check('delivery reports success', delivered === true, delivered);
  t.check('the idle agent received and submitted the whole message', flat.includes('SUBMITTED:do the task second line'), flat.slice(-300));
  fs.rmSync(script, { force: true });
};
