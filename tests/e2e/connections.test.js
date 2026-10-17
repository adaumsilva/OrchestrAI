const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  // ---- circuit geometry for every pair of sides ----
  const geo = await t.js(`(() => {
    const dirs = SIDE_DIRS, bad = [];
    const start = { x: 100, y: 100 }, end = { x: 420, y: 300 };
    for (const sa of dirs) for (const sb of dirs) for (const pin of [null, { x: 260, y: 220 }]) {
      const pts = circuitPoints(start, sa, end, sb, pin);
      const axis = pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 0.6 || Math.abs(p.y - pts[i].y) < 0.6);
      const ends = pts[0] === start && pts[pts.length - 1] === end;
      const leaves = pts.length < 3 || (sa.x ? Math.abs(pts[1].y - start.y) < 0.6 : Math.abs(pts[1].x - start.x) < 0.6);
      if (!axis || !ends || !leaves) bad.push({ sa, sb, pin: !!pin, pts });
      const onPath = !pin || pts.slice(1).some((q, i) => { const a = pts[i]; return pin.x >= Math.min(a.x, q.x) - 0.6 && pin.x <= Math.max(a.x, q.x) + 0.6 && pin.y >= Math.min(a.y, q.y) - 0.6 && pin.y <= Math.max(a.y, q.y) + 0.6 && (Math.abs(a.x - q.x) < 0.6 || Math.abs(a.y - q.y) < 0.6); });
      if (pin && !onPath) bad.push({ sa, sb, missingPin: true });
    }
    return bad;
  })()`);
  t.check('circuit routes use only right angles, start and end at the pins, and pass through a tie', geo.length === 0, geo.slice(0, 2));

  // ---- routing switch re-renders every rope ----
  await t.js(`(() => {
    const f = activeFloor();
    const mk = (title, x, y) => addNode('note', { title, x, y, w: 200, h: 120 }, f).id;
    const a = mk('A', 80, 80), b = mk('B', 520, 300), c = mk('C', 80, 420);
    f.ropes.push({ id: 'r1', a, b }, { id: 'r2', a, b: c });
    window.__ids = { a, b, c };
    wakeRopes(); return 0;
  })()`);
  await t.sleep(900);
  const cable = await t.js(`[...sims.values()].map((s) => ({ circuit: !!s.circuit, d: s.dom.line.getAttribute('d') }))`);
  t.check('cable mode draws smoothed curves', cable.length === 2 && cable.every((r) => !r.circuit && r.d.split('Q').length > 5), cable);
  await t.js(`setRopeRouting('circuit'); 0`);
  await t.sleep(500);
  const circ = await t.js(`[...sims.values()].map((s) => ({ circuit: !!s.circuit, d: s.dom.line.getAttribute('d'), pts: s.circuit }))`);
  t.check('switching to circuit re-renders all ropes as right-angle traces', circ.length === 2 && circ.every((r) => r.circuit && r.pts.slice(1).every((p, i) => Math.abs(p.x - r.pts[i].x) < 0.6 || Math.abs(p.y - r.pts[i].y) < 0.6)), circ);
  t.check('the routing choice is saved', (await t.js(`state.settings.ropeRouting`)) === 'circuit');
  t.check('moving a node re-routes the trace', await t.js(`(() => { const f = activeFloor(); const before = JSON.stringify([...sims.values()].map((s) => s.circuit)); const n = f.nodes.find((x) => x.id === window.__ids.b); n.x += 140; place(n, rt.get(f.id).live.get(n.id).el); drawRopes(f); return new Promise((r) => setTimeout(() => r(before !== JSON.stringify([...sims.values()].map((s) => s.circuit))), 300)); })()`));

  // ---- ties: drag a rope to hold it ----
  const grab = await t.js(`(() => { try {
    const f = activeFloor(); const rope = f.ropes[0]; const dom = sims.get(rope.id).dom;
    const len = dom.line.getTotalLength(); const p = dom.line.getPointAtLength(len * 0.3); const m = dom.line.getScreenCTM();
    return { x: Math.round(m.a * p.x + m.e), y: Math.round(m.d * p.y + m.f), zoom: f.view.zoom, vx: f.view.x, vy: f.view.y };
  } catch (e) { return { err: String(e) }; } })()`);
  if (grab.err) { t.check('rope handle is available', false, grab); return; }
  const wc = t.win.webContents;
  wc.sendInputEvent({ type: 'mouseMove', x: grab.x, y: grab.y });
  wc.sendInputEvent({ type: 'mouseDown', x: grab.x, y: grab.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) wc.sendInputEvent({ type: 'mouseMove', x: grab.x + i * 12, y: grab.y + i * 20 });
  wc.sendInputEvent({ type: 'mouseUp', x: grab.x + 72, y: grab.y + 120, button: 'left', clickCount: 1 });
  await t.sleep(600);
  const tied = await t.js(`(() => { const f = activeFloor(); const r = f.ropes[0]; const s = sims.get(r.id); return { pin: r.pin, passes: !!s.circuit && s.circuit.some((p, i) => i && Math.min(s.circuit[i - 1].x, p.x) - 1 <= r.pin.x && r.pin.x <= Math.max(s.circuit[i - 1].x, p.x) + 1 && Math.min(s.circuit[i - 1].y, p.y) - 1 <= r.pin.y && r.pin.y <= Math.max(s.circuit[i - 1].y, p.y) + 1), handle: s.dom.pinEl.style.display }; })()`);
  t.check('dragging a rope ties it at the drop point', tied.pin && tied.passes && tied.handle !== 'none', tied);
  await t.sleep(700);
  const saved = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'workspace.json'), 'utf8'));
  t.check('the tie is saved with the rope', saved.workspaces[0].floors[0].ropes.some((r) => r.pin && r.pin.x === tied.pin.x), saved.workspaces[0].floors[0].ropes);

  // a plain click on a rope must not tie it
  await t.js(`(() => { delete activeFloor().ropes[1].pin; return 0; })()`);
  const grab2 = await t.js(`(() => { const f = activeFloor(); const dom = sims.get(f.ropes[1].id).dom; const len = dom.line.getTotalLength(); const p = dom.line.getPointAtLength(len * 0.3); const m = dom.line.getScreenCTM(); return { x: Math.round(m.a * p.x + m.e), y: Math.round(m.d * p.y + m.f) }; })()`);
  wc.sendInputEvent({ type: 'mouseMove', x: grab2.x, y: grab2.y });
  wc.sendInputEvent({ type: 'mouseDown', x: grab2.x, y: grab2.y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: grab2.x, y: grab2.y, button: 'left', clickCount: 1 });
  await t.sleep(300);
  t.check('a click without dragging does not tie the rope', await t.js(`!activeFloor().ropes[1].pin`));

  // cable mode honours the tie too
  await t.js(`setRopeRouting('cable'); 0`);
  await t.sleep(2500);
  const held = await t.js(`(() => { const r = activeFloor().ropes[0]; const s = sims.get(r.id); const m = s.pts[Math.floor(s.pts.length / 2)]; return { d: Math.hypot(m.x - r.pin.x, m.y - r.pin.y) }; })()`);
  t.check('a cable is held at its tie', held.d < 2, held);

  // double-clicking the handle unties
  await t.js(`(() => { const r = activeFloor().ropes[0]; sims.get(r.id).dom.pinEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return 0; })()`);
  t.check('double-click on the tie handle releases it', await t.js(`!activeFloor().ropes[0].pin`));

  // ---- the panel ----
  await t.js(`connectionsDialog({}); 0`);
  await t.sleep(300);
  const panel = await t.js(`({ rows: document.querySelectorAll('#modal-root .conn-row').length, text: document.querySelector('#modal-root').innerText })`);
  t.check('the panel lists every connection with its endpoints', panel.rows === 2 && /A/.test(panel.text) && /B/.test(panel.text) && /C/.test(panel.text), panel);
  await t.js(`closeModal(); connectionsDialog({ nodeId: window.__ids.b }); 0`);
  await t.sleep(300);
  t.check('a node-scoped panel lists only that node', (await t.js(`document.querySelectorAll('#modal-root .conn-row').length`)) === 1);
  await t.js(`closeModal(); connectionsDialog({}); 0`);
  await t.sleep(300);
  await t.js(`[...document.querySelectorAll('#modal-root .conn-row button')].find((b) => b.textContent === 'Tie').click(); 0`);
  await t.sleep(300);
  t.check('the panel can tie a connection', await t.js(`activeFloor().ropes.some((r) => r.pin)`));
  await t.js(`[...document.querySelectorAll('#modal-root .conn-row button')].find((b) => b.textContent === 'Remove').click(); 0`);
  await t.sleep(300);
  t.check('Remove deletes one connection', await t.js(`activeFloor().ropes.length`) === 1);
  await t.js(`[...document.querySelectorAll('#modal-root button')].find((b) => /^Remove all/.test(b.textContent)).click(); 0`);
  await t.sleep(300);
  await t.js(`[...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Remove all').click(); 0`);
  await t.sleep(500);
  t.check('Remove all clears them after confirming', await t.js(`activeFloor().ropes.length`) === 0 && (await t.js(`sims.size`)) === 0);
  await t.js(`closeModal(); 0`);
};
