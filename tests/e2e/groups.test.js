const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const ids = await t.js(`(() => {
    const f = activeFloor();
    const mk = (title, x, y) => addNode('note', { title, x, y, w: 200, h: 120 }, f).id;
    return { a: mk('A', 100, 100), b: mk('B', 400, 100), c: mk('C', 100, 400), d: mk('Loose', 900, 100), term: f.nodes[0].id };
  })()`);
  await t.js(`setSelection(activeFloor(), ['${ids.a}', '${ids.b}']); 0`);
  await t.key('G', ['control']);
  const g = await t.js(`(() => { const f = activeFloor(); const g = f.nodes.find((n) => n.kind === 'group'); return g && { id: g.id, members: g.data.members, x: g.x, y: g.y, w: g.w, h: g.h, title: g.title, sel: [...selection] }; })()`);
  t.check('Ctrl+G creates a frame around the selection', g && g.members.length === 2 && g.members.includes(ids.a) && g.members.includes(ids.b) && g.sel[0] === g.id, g);
  t.check('frame bounds enclose its members', g.x < 100 && g.y < 100 && g.x + g.w > 600 && g.y + g.h > 220, g);
  t.check('frame sits behind the nodes', await t.js(`getComputedStyle(rt.get(state.active).live.get('${g.id}').el).zIndex`) === '0');

  // moving the frame moves members
  const moved = await t.js(`(() => {
    const f = activeFloor(); const gn = f.nodes.find((n) => n.id === '${g.id}'); const a = f.nodes.find((n) => n.id === '${ids.a}'), c = f.nodes.find((n) => n.id === '${ids.c}');
    const before = { ax: a.x, cx: c.x };
    const head = rt.get(f.id).live.get(gn.id).el.querySelector('.node-head');
    const r = head.getBoundingClientRect();
    // The workspace sidebar is open by default and covers the left edge on a small window: grab the header to its right.
    const sb = document.getElementById('sidebar');
    const minX = sb && !sb.classList.contains('hidden') ? sb.getBoundingClientRect().right + 24 : 0;
    return { before, x: Math.round(Math.max(r.left + 60, minX)), y: Math.round(r.top + r.height / 2) };
  })()`);
  await t.win.webContents.sendInputEvent({ type: 'mouseMove', x: moved.x, y: moved.y });
  await t.win.webContents.sendInputEvent({ type: 'mouseDown', x: moved.x, y: moved.y, button: 'left', clickCount: 1 });
  await t.win.webContents.sendInputEvent({ type: 'mouseMove', x: moved.x + 90, y: moved.y + 40 });
  await t.win.webContents.sendInputEvent({ type: 'mouseMove', x: moved.x + 120, y: moved.y + 60 });
  await t.win.webContents.sendInputEvent({ type: 'mouseUp', x: moved.x + 120, y: moved.y + 60, button: 'left', clickCount: 1 });
  await t.sleep(300);
  const after = await t.js(`(() => { const f = activeFloor(); const a = f.nodes.find((n) => n.id === '${ids.a}'), c = f.nodes.find((n) => n.id === '${ids.c}'); return { ax: a.x, cx: c.x }; })()`);
  t.check('dragging the frame moves its members, not others', after.ax - moved.before.ax > 80 && after.cx === moved.before.cx, { moved, after });

  // rename + recolor
  await t.js(`(() => { const f = activeFloor(); const gn = f.nodes.find((n) => n.id === '${g.id}'); gn.title = 'Backend'; gn.data.color = 'green'; save(); return 0; })()`);
  // save/load keeps membership
  await t.sleep(600);
  const saved = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'workspace.json'), 'utf8'));
  const sg = saved.workspaces[0].floors[0].nodes.find((n) => n.kind === 'group');
  t.check('membership, title and color are saved', sg && sg.data.members.length === 2 && sg.title === 'Backend' && sg.data.color === 'green', sg);

  // grouping with a frame selected adds to it; fit wraps around new member
  await t.js(`setSelection(activeFloor(), ['${g.id}', '${ids.c}']); 0`);
  await t.key('G', ['control']);
  const merged = await t.js(`(() => { const f = activeFloor(); const gs = f.nodes.filter((n) => n.kind === 'group'); const c = f.nodes.find((n) => n.id === '${ids.c}'); return { groups: gs.length, members: gs[0].data.members.length, covers: gs[0].y + gs[0].h >= c.y + c.h }; })()`);
  t.check('Ctrl+G with a frame selected adds nodes to it', merged.groups === 1 && merged.members === 3 && merged.covers, merged);

  // tidy treats the group as one block
  await t.js(`setSelection(activeFloor(), []); 0`);
  await t.key('T');
  await t.sleep(700);
  const tidied = await t.js(`(() => { const f = activeFloor(); const g = f.nodes.find((n) => n.kind === 'group'); const ms = membersOf(f, g); const inside = ms.every((m) => m.x >= g.x && m.y >= g.y && m.x + m.w <= g.x + g.w && m.y + m.h <= g.y + g.h);
    const others = f.nodes.filter((n) => n !== g && !ms.includes(n)); const overlap = others.some((o) => o.x < g.x + g.w && o.x + o.w > g.x && o.y < g.y + g.h && o.y + o.h > g.y); return { inside, overlap }; })()`);
  t.check('tidy keeps members inside the frame and other nodes outside it', tidied.inside && !tidied.overlap, tidied);

  // undo restores membership
  await t.sleep(700);
  await t.js(`setSelection(activeFloor(), [activeFloor().nodes.find((n) => n.kind === 'group').id]); 0`);
  await t.key('G', ['control', 'shift']);
  const ung = await t.js(`({ groups: activeFloor().nodes.filter((n) => n.kind === 'group').length, nodes: activeFloor().nodes.length, sel: selection.size })`);
  t.check('Ctrl+Shift+G removes the frame and keeps the nodes', ung.groups === 0 && ung.nodes === 5 && ung.sel === 3, ung);
  await t.sleep(700);
  await t.js(`stepHistory(-1); 0`);
  await t.sleep(400);
  const undone = await t.js(`(() => { const g = activeFloor().nodes.find((n) => n.kind === 'group'); return g && g.data.members.length; })()`);
  t.check('undo brings the group and its membership back', undone === 3, undone);
};
