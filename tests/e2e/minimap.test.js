// Minimap: the overview of the floor, with the visible area marked; clicking or dragging it pans the canvas.
module.exports = async (t) => {
  const f = await t.js(`(() => {
    const fl = activeFloor();
    addNode('note', { title: 'Far', x: 3000, y: 2000, data: { text: '' } }, fl);
    addNode('note', { title: 'Near', x: 0, y: 0, data: { text: '' } }, fl);
    return fl.id;
  })()`);
  const hidden = () => t.js(`document.getElementById('minimap').classList.contains('hidden')`);
  const filledPixels = () => t.js(`(() => { const c = document.querySelector('#minimap canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()`);

  await t.js(`toggleMinimap(false); 0`);
  t.check('the minimap can be hidden', await hidden());
  await t.js(`toggleMinimap(true); 0`);
  await t.sleep(400);
  t.check('and shown', !(await hidden()));
  t.check('the toolbar button reflects it', await t.js(`document.getElementById('minimap-btn').classList.contains('active')`));
  t.check('it draws something', (await filledPixels()) > 100, await filledPixels());

  // ---- geometry covers every node and the viewport ----
  const g = await t.js(`(() => { const fl = activeFloor(), g = mmGeometry(fl); const w = mmCanvas.width, h = mmCanvas.height;
    const inside = (x, y) => { const px = (x - g.x0) * g.scale + g.offX, py = (y - g.y0) * g.scale + g.offY; return px >= 0 && py >= 0 && px <= w && py <= h; };
    return { all: fl.nodes.every((n) => inside(n.x, n.y) && inside(n.x + n.w, n.y + n.h)), view: inside(g.view.x, g.view.y) && inside(g.view.x + g.view.w, g.view.y + g.view.h), scale: g.scale };
  })()`);
  t.check('every node fits in the map', g.all, g);
  t.check('the visible area fits in the map', g.view, g);

  // ---- clicking pans the canvas so that spot is centred ----
  const target = await t.js(`(() => {
    const fl = activeFloor(), far = fl.nodes.find((n) => n.title === 'Far'), g = mmGeometry(fl), r = mmCanvas.getBoundingClientRect();
    const cx = far.x + far.w / 2, cy = far.y + far.h / 2;
    const px = ((cx - g.x0) * g.scale + g.offX) * (r.width / mmCanvas.width), py = ((cy - g.y0) * g.scale + g.offY) * (r.height / mmCanvas.height);
    return { x: Math.round(r.left + px), y: Math.round(r.top + py), cx, cy };
  })()`);
  const before = await t.js(`({ ...activeFloor().view })`);
  await t.click(target.x, target.y);
  await t.sleep(300);
  const after = await t.js(`({ ...activeFloor().view })`);
  t.check('clicking the minimap moves the view', before.x !== after.x || before.y !== after.y, { before, after });
  const centre = await t.js(`(() => { const fl = activeFloor(), vr = viewport.getBoundingClientRect(); return { x: (vr.width / 2 - fl.view.x) / fl.view.zoom, y: (vr.height / 2 - fl.view.y) / fl.view.zoom }; })()`);
  t.check('the clicked spot becomes the centre of the view', Math.abs(centre.x - target.cx) < 150 && Math.abs(centre.y - target.cy) < 150, { centre, target });

  // ---- dragging follows the pointer ----
  const near = await t.js(`(() => { const r = mmCanvas.getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.2), y: Math.round(r.top + r.height * 0.3) }; })()`);
  const viewA = await t.js(`({ ...activeFloor().view })`);
  await t.click(near.x, near.y);
  const viewB = await t.js(`({ ...activeFloor().view })`);
  t.check('clicking elsewhere pans again', viewA.x !== viewB.x || viewA.y !== viewB.y);

  // ---- the keyboard shortcut and the saved preference ----
  await t.js(`document.activeElement?.blur?.(); 0`);
  await t.key('m');
  await t.sleep(200);
  t.check('M hides it', await hidden());
  t.check('the choice is remembered', (await t.js(`localStorage.getItem('minimap')`)) === '0');
  await t.key('m');
  await t.sleep(200);
  t.check('M shows it again', !(await hidden()));
  await t.js(`toggleMinimap(false); 0`);
  void f;
};
