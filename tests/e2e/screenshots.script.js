// Regenerates the README screenshots:
//   ORCH_TEST=tests/e2e/screenshots.script.js ORCH_SHOTS_DIR=<dir> electron tests/e2e/entry.js
// (not named *.test.js, so `npm test` skips it). Writes PNGs to ORCH_SHOTS_DIR (default docs/images).
//
// Privacy: the app runs against a throwaway profile, and the terminals run C:\demo\agent.js, a scripted demo that prints
// made-up output. No real agent, account, path or project is shown. Check the PNGs by eye before committing them.
const fs = require('fs');
const path = require('path');

module.exports = async (t) => {
  const out = process.env.ORCH_SHOTS_DIR || path.join(__dirname, '..', '..', 'docs', 'images');
  fs.mkdirSync(out, { recursive: true });
  const demoDir = process.env.ORCH_DEMO_DIR || 'C:\\demo';
  const shot = async (name) => {
    t.win.show(); t.win.focus();
    await t.sleep(900);
    fs.writeFileSync(path.join(out, name), (await t.win.webContents.capturePage()).toPNG());
    console.log('wrote', name);
  };
  t.win.setSize(1500, 950);
  await t.js(`(() => {
    const f = activeFloor();
    f.nodes.slice().forEach((n) => removeNode(f, n.id, true));
    const cwd = ${JSON.stringify(demoDir + '\\orchestrai-api')};
    const demo = (who) => 'node ..\\\\agent.js ' + who;
    const mk = (title, who, x, y, w, h, extra = {}) => addNode('terminal', { title, x, y, w, h, data: { command: demo(who), cwd, min: false, ...extra } });
    const plan = addNode('note', { title: 'Plan', x: 60, y: 170, w: 330, h: 150, data: { text: 'Split the work: api-builder writes the API, test-writer covers it. The Maestro coordinates.', mode: 'preview' } });
    const m = mk('Maestro', 'maestro', 60, 360, 400, 340, { maestro: true });
    const a = mk('api-builder', 'builder', 560, 170, 540, 270);
    const b = mk('test-writer', 'tests', 560, 500, 540, 270);
    f.ropes.push({ id: 'r1', a: plan.id, b: m.id }, { id: 'r2', a: m.id, b: a.id }, { id: 'r3', a: m.id, b: b.id });
    rt.get(f.id).live.forEach((e) => place(e.node, e.el));
    save(); wakeRopes(); return 0;
  })()`);
  await t.sleep(7000);
  await t.js(`setActivity(false); fitFloor(activeFloor()); activeFloor().view.y += 55; applyView(activeFloor()); setSelection(activeFloor(), []); 0`);
  await shot('canvas.png');

  await t.js(`showView('tasks'); 0`);
  await t.sleep(2500);
  await shot('tasks.png');
  await t.js(`showView('canvas'); 0`);

  await t.js(`terminalDialog({ mode: 'new', floor: activeFloor() }); 0`);
  await shot('terminal-sheet.png');
  await t.key('Escape');
};
