module.exports = async (t) => {
  await t.js(`window.__errs = []; addEventListener('error', (e) => window.__errs.push(String(e.message)));`);
  const ids = await t.js(`(() => {
    const A = activeFloor();
    const note = addNode('note', { title: 'Sender', data: { text: 'Write-Output CROSS_FLOOR_OK' } }, A);
    const B = newFloor({ name: 'Floor B' }); state.floors.push(B); mountFloor(B);
    const term = addNode('terminal', { title: 'Receiver', data: {} }, B);
    return { A: A.id, B: B.id, note: note.id, term: term.id };
  })()`);
  await t.js(`switchFloor('${ids.B}'); 0`);
  await t.sleep(3500);
  await t.js(`switchFloor('${ids.A}'); 0`);
  await t.sleep(400);

  const ok = await t.js(`(() => { const A = activeFloor(); const n = A.nodes.find((x) => x.id === '${ids.note}'); const target = nodeOnFloor('${ids.B}', '${ids.term}'); return connectAcross(A, n, target); })()`);
  t.check('connectAcross creates the rope', ok === true);
  const both = await t.js(`({ a: state.floors.find((f) => f.id === '${ids.A}').ropes.map((r) => [r.a, r.b, r.rf].join()), b: state.floors.find((f) => f.id === '${ids.B}').ropes.map((r) => [r.a, r.b, r.rf].join()) })`);
  t.check('rope is stored on both floors', both.a[0] === `${ids.note},${ids.term},${ids.B}` && both.b[0] === `${ids.term},${ids.note},${ids.A}`, both);
  await t.sleep(300);
  const stub = await t.js(`document.querySelector('.floor-root:not(.hidden) .rope-stub .stub-label')?.textContent`);
  t.check('floor A shows a stub naming the far node and floor', stub === '⇢ Receiver · Floor B', stub);

  // the note can send to the terminal on the other floor
  await t.js(`rt.get('${ids.A}').live.get('${ids.note}').el.querySelector('.node-head button[title^="Send text"]').click(); 0`);
  await t.sleep(2500);
  const screen = await t.js(`rt.get('${ids.B}').live.get('${ids.term}').api.readScreen()`);
  t.check('note sends through the cross-floor rope', screen.includes('CROSS_FLOOR_OK'), screen.slice(-160));

  // stub jumps to the far node
  await t.js(`document.querySelector('.floor-root:not(.hidden) .rope-stub .stub-label').click(); 0`);
  await t.sleep(300);
  const jumped = await t.js(`({ floor: state.active, sel: [...selection] })`);
  t.check('stub jumps to the far node', jumped.floor === ids.B && jumped.sel[0] === ids.term, jumped);

  // the far end shows the way back
  const back = await t.js(`document.querySelector('.floor-root:not(.hidden) .rope-stub .stub-label')?.textContent`);
  t.check('far floor shows a stub back', back === '⇢ Sender · ' + (await t.js(`state.floors.find((f) => f.id === '${ids.A}').name`)), back);

  // undo / redo restores the connection on both floors
  await t.js(`switchFloor('${ids.A}'); 0`);
  await t.sleep(700); // let the history snapshot settle
  await t.js(`(() => { const A = activeFloor(); const id = A.ropes[0].id; removeRope(A, id); })()`);
  await t.sleep(900);
  t.check('removing the rope clears both ends', await t.js(`allFloors().every((f) => f.ropes.length === 0)`));
  await t.js(`stepHistory(-1); 0`);
  await t.sleep(500);
  t.check('undo restores the connection on both floors', await t.js(`allFloors().filter((f) => f.ropes.length === 1 && f.ropes[0].rf).length === 2`));
  await t.js(`stepHistory(1); 0`);
  await t.sleep(500);
  t.check('redo removes it again', await t.js(`allFloors().every((f) => f.ropes.length === 0)`));
  await t.js(`stepHistory(-1); 0`);
  await t.sleep(500);

  // deleting either end removes the rope everywhere without errors
  await t.js(`removeNode(state.floors.find((f) => f.id === '${ids.B}'), '${ids.term}'); 0`);
  await t.sleep(500);
  const after = await t.js(`({ ropes: allFloors().reduce((n, f) => n + f.ropes.length, 0), stubs: document.querySelectorAll('.rope-stub').length, errs: window.__errs })`);
  t.check('deleting the far end removes rope and stub with no errors', after.ropes === 0 && after.stubs === 0 && after.errs.length === 0, after);

  // deleting a whole floor with a connection is clean too
  await t.js(`(() => { const A = activeFloor(); const C = newFloor({ name: 'Floor C' }); state.floors.push(C); mountFloor(C); const n2 = addNode('note', { title: 'Far' }, C); connectAcross(A, A.nodes.find((x) => x.id === '${ids.note}'), nodeOnFloor(C.id, n2.id)); window.__C = C; return 0; })()`);
  await t.sleep(300);
  await t.js(`removeFloor(window.__C)`);
  await t.sleep(500);
  const gone = await t.js(`({ ropes: allFloors().reduce((n, f) => n + f.ropes.length, 0), stubs: document.querySelectorAll('.rope-stub').length, errs: window.__errs })`);
  t.check('removing a floor drops its cross-floor ropes', gone.ropes === 0 && gone.stubs === 0 && gone.errs.length === 0, gone);
};
