module.exports = async (t) => {
  const wc = t.win.webContents;
  await t.js(`(() => { const f = activeFloor(); f.view = { x: 0, y: 0, zoom: 1 }; applyView(f); return 0; })()`);
  const mk = (x, y) => t.js(`addNode('files', { x: ${x}, y: ${y}, w: 380, h: 260, data: { root: ${JSON.stringify(t.dataDir)} } }, activeFloor()).id`);
  const info = (id) => t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; const tr = el.querySelector('.tree').getBoundingClientRect(), ed = el.querySelector('.editor').getBoundingClientRect(), nr = el.getBoundingClientRect(); return { treeLeft: tr.left, editorLeft: ed.left, nodeCenter: nr.left + nr.width / 2, win: innerWidth, right: el.querySelector('.split').classList.contains('dock-right'), dock: state.floors.find((f) => f.id === state.active).nodes.find((n) => n.id === '${id}').data.dock || 'auto' }; })()`);

  const left = await mk(20, 330);
  const right = await mk(580, 330);
  await t.sleep(600);
  const l = await info(left), r = await info(right);
  t.check('auto: a node in the left half has the tree on the left', !l.right && l.treeLeft < l.editorLeft, l);
  t.check('auto: a node in the right half has the tree on the right, editor toward the canvas', r.nodeCenter > r.win / 2 && r.right && r.editorLeft < r.treeLeft, r);

  // the button cycles auto -> left -> right -> auto and persists
  const btn = (id) => `[...rt.get(state.active).live.get('${id}').el.querySelectorAll('button')].find((b) => /^Tree side/.test(b.title))`;
  await t.js(`${btn(right)}.click(); 0`);
  const pinnedLeft = await info(right);
  t.check('pinning left overrides the auto side', pinnedLeft.dock === 'left' && !pinnedLeft.right && pinnedLeft.treeLeft < pinnedLeft.editorLeft, pinnedLeft);
  await t.js(`${btn(left)}.click(); ${btn(left)}.click(); 0`);
  const pinnedRight = await info(left);
  t.check('pinning right puts the tree on the right even in the left half', pinnedRight.dock === 'right' && pinnedRight.right && pinnedRight.editorLeft < pinnedRight.treeLeft, pinnedRight);
  const saved = await t.readSaved((s) => s.workspaces[0].floors.some((f) => f.nodes.some((n) => n.id === left && n.data.dock === 'right')));
  t.check('the dock side is saved with the node', saved.workspaces[0].floors.some((f) => f.nodes.some((n) => n.id === left && n.data.dock === 'right')));

  // auto follows a dragged node: move the right-half node to the left half
  await t.js(`${btn(right)}.click(); ${btn(right)}.click(); 0`); // right -> auto (left, right, auto)
  t.check('back to auto', (await info(right)).dock === 'auto');
  await t.js(`(() => { const f = activeFloor(); const n = f.nodes.find((x) => x.id === '${right}'); n.x = 20; place(n, rt.get(f.id).live.get('${right}').el); return 0; })()`);
  await wc.executeJavaScript(`dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); 0`);
  await t.sleep(200);
  const moved = await info(right);
  t.check('auto re-evaluates after the node is moved', !moved.right, moved);

  // drag the handle to resize the tree (real mouse events); dock right so the sign is reversed
  const geo = await t.js(`(() => { const el = rt.get(state.active).live.get('${left}').el; const h = el.querySelector('.split-handle').getBoundingClientRect(), tr = el.querySelector('.tree').getBoundingClientRect(); return { x: Math.round(h.left + h.width / 2), y: Math.round(h.top + h.height / 2), w: tr.width }; })()`);
  wc.sendInputEvent({ type: 'mouseMove', x: geo.x, y: geo.y });
  wc.sendInputEvent({ type: 'mouseDown', x: geo.x, y: geo.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) { wc.sendInputEvent({ type: 'mouseMove', x: geo.x - i * 10, y: geo.y, modifiers: ['leftButtonDown'] }); await t.sleep(20); }
  wc.sendInputEvent({ type: 'mouseUp', x: geo.x - 60, y: geo.y, button: 'left', clickCount: 1 });
  await t.sleep(300);
  const after = await t.js(`rt.get(state.active).live.get('${left}').el.querySelector('.tree').getBoundingClientRect().width`);
  t.check('dragging the handle toward the editor widens a right-docked tree', after > geo.w + 40, { before: geo.w, after });
  const saved2 = await t.readSaved((s) => s.workspaces[0].floors.some((f) => f.nodes.some((n) => n.id === left && n.data.treeW)));
  t.check('the tree width is saved', saved2.workspaces[0].floors.some((f) => f.nodes.some((n) => n.id === left && n.data.treeW > geo.w)));
};
