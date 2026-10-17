// Regenerates the README screenshots: ORCH_TEST=tests/e2e/screenshots.script.js electron tests/e2e/entry.js
// (not named *.test.js, so `npm test` skips it). Writes PNGs to docs/images.
const fs = require('fs');
const path = require('path');

module.exports = async (t) => {
  const out = path.join(__dirname, '..', '..', 'docs', 'images');
  const shot = async (name) => {
    t.win.show(); t.win.focus();
    await t.sleep(900);
    const img = await t.win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name), img.toPNG());
    console.log('wrote', name);
  };
  t.win.setSize(1500, 950);
  await t.js(`(() => {
    const f = activeFloor();
    const term = f.nodes[0]; term.title = 'Claude'; term.x = 80; term.y = 80; term.w = 520; term.h = 300;
    const note = addNode('note', { title: 'Plan', x: 760, y: 200, data: { text: '# Plan\\n\\n- [x] sketch the API\\n- [ ] write tests\\n\\n` + "`orchestrai ask reviewer`" + ` when done', mode: 'preview', color: 'blue' } });
    const rev = addNode('terminal', { title: 'Reviewer', x: 80, y: 460, w: 520, h: 300, data: {} });
    f.ropes.push({ id: 'r1', a: note.id, b: term.id }, { id: 'r2', a: note.id, b: rev.id });
    const g = addNode('note', { title: 'Scratch', x: 760, y: 520, data: { text: 'ideas' } });
    rt.get(f.id).live.forEach((e) => place(e.node, e.el));
    setSelection(f, [term.id, rev.id, g.id, note.id]); groupSelection();
    save(); wakeRopes(); return 0;
  })()`);
  await t.sleep(3500);
  await t.js(`fitFloor(activeFloor()); 0`);
  await shot('ropes-groups.png');
  await t.js(`addWorkspace({ name: 'Docs site' }); switchWorkspace(state.workspaces[0].id); setSidebar(true); 0`);
  await t.key('K', ['control']);
  await t.type('pla');
  await shot('palette-workspaces.png');
  await t.key('Escape');
  await t.js(`terminalDialog({ mode: 'edit', floor: activeFloor(), node: activeFloor().nodes[0] }); 0`);
  await shot('terminal-sheet.png');
};
