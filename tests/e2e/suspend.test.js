// Idle floors: terminals are stopped to free memory and come back when the floor is opened.
module.exports = async (t) => {
  const ids = await t.js(`(() => {
    const A = activeFloor();
    const B = newFloor({ name: 'Floor B' }); state.floors.push(B); mountFloor(B);
    const term = addNode('terminal', { title: 'Sleeper', data: {} }, B);
    const linked = addNode('terminal', { title: 'Linked', data: {} }, B);
    const other = addNode('note', { title: 'N', data: { text: '' } }, B);
    B.ropes.push({ a: linked.id, b: other.id });
    return { A: A.id, B: B.id, term: term.id, linked: linked.id };
  })()`);
  await t.js(`switchFloor('${ids.B}'); 0`);
  await t.sleep(2500);
  await t.js(`switchFloor('${ids.A}'); 0`);
  await t.sleep(300);

  const before = await t.js(`call('app:ptyCount')`);
  const res = await t.js(`({ s: rt.get('${ids.B}').live.get('${ids.term}').api.suspend(true), l: rt.get('${ids.B}').live.get('${ids.linked}').api.suspend(true) })`);
  t.check('an unlinked terminal on a hidden floor suspends', res.s === true, res);
  t.check('a terminal wired to another node is left running', res.l === false, res);
  await t.sleep(400);
  const after = await t.js(`call('app:ptyCount')`);
  t.check('the process is gone', after === before - 1, { before, after });
  t.check('status is suspended', (await t.js(`rt.get('${ids.B}').live.get('${ids.term}').api.status()`)) === 'suspended');

  await t.js(`switchFloor('${ids.B}'); 0`);
  await t.sleep(2500);
  t.check('opening the floor starts it again', (await t.js(`call('app:ptyCount')`)) === before, await t.js(`call('app:ptyCount')`));
};
