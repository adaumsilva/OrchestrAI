// Maximising a minimised terminal resizes it, and an agent repaints after a resize. That repaint must not show as work.
const fs = require('fs'), os = require('os'), path = require('path');

module.exports = async (t) => {
  // A fake agent: quiet until its window changes size, then it repaints (like a TUI on SIGWINCH).
  const script = path.join(os.tmpdir(), `orch-repaint-${process.pid}.js`);
  fs.writeFileSync(script, "process.stdout.on('resize', () => process.stdout.write('REPAINT ' + 'x'.repeat(400) + '\\n')); console.log('READY'); setInterval(() => {}, 1000);");
  const id = await t.js(`addNode('terminal', { title: 'Repainter', data: {} }, activeFloor()).id`);
  const api = (code) => t.js(`(() => { const a = rt.get(state.active).live.get('${id}').api; return ${code}; })()`);
  await t.sleep(4000);
  await api(`a.send(${JSON.stringify(`node "${script.split(path.sep).join('/')}"`)})`);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { await t.sleep(250); ready = /^READY/m.test(await api('a.readScreen()')); }
  t.check('the fake agent started', ready, await api('a.readScreen()'));

  await api('a.setMin(true)');
  for (let i = 0; i < 40 && (await api('a.status()')) !== 'idle'; i++) await t.sleep(500);
  t.check('it is idle while minimised', (await api('a.status()')) === 'idle', await api('a.status()'));

  await api('a.setMin(false)');
  const seen = new Set();
  for (let i = 0; i < 16; i++) { await t.sleep(250); seen.add(await api('a.status()')); }
  t.check('maximising keeps the status idle', !seen.has('running') && seen.has('idle'), [...seen]);

  fs.rmSync(script, { force: true });
};
