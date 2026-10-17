const routines = require('../../src/services/routines');

module.exports = async (t) => {
  const termId = await t.js(`(() => { const n = addNode('terminal', { title: 'Target', data: {} }); return n.id; })()`);
  await t.sleep(3500);
  const hist = () => t.js(`call('routines:list').then((r) => r.history.map((h) => h.outcome + ':' + h.name))`);

  // validation errors come back to the dialog
  const bad = await t.js(`call('routines:save', { name: 'x', text: 'a', target: { terminalId: '${termId}' }, schedule: { kind: 'daily', time: '99:99' } })`);
  t.check('invalid schedule is rejected', !bad.ok && /HH:MM/.test(bad.error), bad);
  const past = await t.js(`call('routines:save', { name: 'x', text: 'a', target: { terminalId: '${termId}' }, schedule: { kind: 'once', at: Date.now() - 1000 } })`);
  t.check('past one-off is rejected', !past.ok, past);

  // a recurring routine fires on schedule and types into its target
  const soon = Date.now() + 90000;
  const saved = await t.js(`call('routines:save', { name: 'Ping', text: 'Write-Output ROUTINE_MARK_42', target: { terminalId: '${termId}' }, schedule: { kind: 'every', minutes: 1, anchor: ${soon} } })`);
  t.check('routine saved with a next run', saved.ok && saved.routine.nextRun === soon, saved);
  routines.tick(soon + 1000);
  await t.sleep(2500);
  const screen = await t.js(`rt.get(state.active).live.get('${termId}').api.readScreen()`);
  t.check('due routine typed into the target', screen.includes('ROUTINE_MARK_42'), screen.slice(-200));
  t.check('history records ok', (await hist()).includes('ok:Ping'), await hist());
  const after = await t.js(`call('routines:list').then((r) => r.routines[0].nextRun)`);
  t.check('next run advanced', after === soon + 60000, after);

  // missed: far past the grace window is not replayed
  const before = await t.js(`rt.get(state.active).live.get('${termId}').api.readScreen().split('ROUTINE_MARK_42').length`);
  routines.tick(soon + 60000 + 30 * 60000);
  await t.sleep(1500);
  const afterScreen = await t.js(`rt.get(state.active).live.get('${termId}').api.readScreen().split('ROUTINE_MARK_42').length`);
  t.check('missed run is recorded, not replayed', (await hist()).includes('missed:Ping') && afterScreen === before, await hist());

  // toggle off stops firing; run now works manually
  await t.js(`call('routines:toggle', '${saved.routine.id}', false)`);
  const n0 = (await hist()).length;
  routines.tick(Date.now() + 10 * 3600000);
  await t.sleep(300);
  t.check('disabled routine does not fire', (await hist()).length === n0);
  await t.js(`call('routines:runNow', '${saved.routine.id}')`);
  await t.sleep(2000);
  const h2 = await hist();
  t.check('run now records a run', h2.filter((x) => x === 'ok:Ping').length === 2, h2);

  // persistence + clear
  const fs = require('fs'), path = require('path');
  const onDisk = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'routines.json'), 'utf8'));
  t.check('history persists to disk', onDisk.history.length >= 3 && onDisk.routines.length === 1, onDisk.history.length);
  await t.js(`call('routines:clearHistory')`);
  t.check('history can be cleared', (await hist()).length === 0);

  // one-shot disables itself after firing
  const once = await t.js(`call('routines:save', { name: 'Once', text: 'x', target: { terminalId: '${termId}' }, schedule: { kind: 'once', at: Date.now() + 120000 } })`);
  routines.tick(once.routine.nextRun + 500);
  await t.sleep(500);
  const o = await t.js(`call('routines:list').then((r) => r.routines.find((x) => x.name === 'Once'))`);
  t.check('one-shot switches itself off', o.enabled === false && o.nextRun == null, o);

  // panel opens and shows the routine
  await t.js(`document.getElementById('routines-btn').click()`);
  await t.sleep(500);
  t.check('panel lists routines', await t.js(`document.querySelectorAll('.routine-row').length`) === 2);
};
