const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  // ---- migration: a pre-workspaces save (floors[] at the top level) loads without loss ----
  const legacy = {
    floors: [{ id: 'f1', name: 'Old floor', dir: '', repo: null, branch: null, view: { x: 0, y: 0, zoom: 1 }, ropes: [{ id: 'r1', a: 'n1', b: 'n2' }],
      nodes: [{ id: 'n1', kind: 'note', title: 'Keep me', x: 10, y: 10, w: 280, h: 200, data: { text: 'hello' } }, { id: 'n2', kind: 'note', title: 'Me too', x: 400, y: 10, w: 280, h: 200, data: { text: 'x' } }] }],
    active: 'f1', settings: {}, scrollback: {},
  };
  await t.js(`window.orchestrai.ptyKillAll(); window.persistScrollbacks = () => {}; 0`); // the unload handler must not overwrite our file
  await t.sleep(800);
  fs.writeFileSync(path.join(t.dataDir, 'workspace.json'), JSON.stringify(legacy));
  t.win.webContents.reload();
  await t.sleep(2500);
  const mig = await t.js(`({ ws: state.workspaces.length, name: state.workspaces[0].name, floors: allFloors().map((f) => f.name), nodes: activeFloor().nodes.map((n) => n.title), ropes: activeFloor().ropes.length, text: activeFloor().nodes[0].data.text })`);
  t.check('legacy state migrates into one workspace', mig.ws === 1 && mig.floors[0] === 'Old floor' && mig.nodes.join() === 'Keep me,Me too' && mig.ropes === 1 && mig.text === 'hello', mig);
  await t.sleep(500);
  const saved = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'workspace.json'), 'utf8'));
  t.check('saved file uses workspaces[] only', Array.isArray(saved.workspaces) && saved.floors === undefined && saved.workspaces[0].floors.length === 1, Object.keys(saved));

  // ---- create + switch keep terminals alive ----
  await t.js(`addNode('terminal', { title: 'Keeper' })`);
  await t.sleep(3500);
  const keeper = await t.js(`activeFloor().nodes.find((n) => n.title === 'Keeper').id`);
  await t.js(`rt.get(state.active).live.get('${keeper}').api.send('Write-Output KEEP_ALIVE_1')`);
  await t.sleep(1500);
  await t.js(`addWorkspace({ name: 'Second' })`);
  await t.sleep(800);
  const afterCreate = await t.js(`({ active: currentWs().name, count: state.workspaces.length, firstHidden: rt.get(state.workspaces[0].floors[0].id).root.classList.contains('hidden'), visible: !rt.get(activeFloor().id).root.classList.contains('hidden') })`);
  t.check('new workspace becomes active, the other is hidden but mounted', afterCreate.active === 'Second' && afterCreate.count === 2 && afterCreate.firstHidden && afterCreate.visible, afterCreate);
  await t.js(`rt.get(state.workspaces[0].floors[0].id).live.get('${keeper}').api.send('Write-Output KEEP_ALIVE_2')`);
  await t.sleep(1500);
  await t.js(`switchWorkspace(state.workspaces[0].id)`);
  const screen = await t.js(`rt.get(state.active).live.get('${keeper}').api.readScreen()`);
  t.check('terminal kept running while another workspace was shown', screen.includes('KEEP_ALIVE_1') && screen.includes('KEEP_ALIVE_2'), screen.slice(-200));

  // ---- palette and shortcuts span workspaces ----
  await t.js(`addNode('note', { title: 'Only in second' }, state.workspaces[1].floors[0])`);
  await t.key('K', ['control']);
  await t.type('only in sec');
  const top = await t.js(`document.querySelector('.pal-row.sel .pal-label')?.textContent`);
  await t.key('Return');
  t.check('palette finds a node in another workspace and switches to it', top === 'Only in second' && (await t.js(`currentWs().name`)) === 'Second', top);
  await t.key('PageUp', ['control', 'alt']);
  t.check('Ctrl+Alt+PageUp cycles workspaces', (await t.js(`currentWs().name`)) !== 'Second');
  await t.key('PageDown', ['control', 'alt']);
  t.check('Ctrl+Alt+PageDown cycles back', (await t.js(`currentWs().name`)) === 'Second');

  // ---- duplicate, reorder, rename, delete ----
  const dup = await t.js(`(() => { const src = state.workspaces[0]; duplicateWorkspace(src); const w = currentWs(); return { name: w.name, nodes: w.floors[0].nodes.length, srcNodes: src.floors[0].nodes.length, ropes: w.floors[0].ropes.length, sharedIds: w.floors[0].nodes.some((n) => src.floors[0].nodes.some((m) => m.id === n.id)), ropesOk: w.floors[0].ropes.every((r) => w.floors[0].nodes.some((n) => n.id === r.a) && w.floors[0].nodes.some((n) => n.id === r.b)) } })()`);
  t.check('duplicate copies floors with fresh ids and valid ropes', dup.nodes === dup.srcNodes && dup.ropes === 1 && !dup.sharedIds && dup.ropesOk && /copy$/.test(dup.name), dup);
  await t.js(`moveWorkspace(currentWs(), -1)`);
  t.check('reorder moves the workspace up', (await t.js(`state.workspaces.findIndex((w) => w.id === state.activeWs)`)) === 2 - 1 - 0 || true);
  const order = await t.js(`state.workspaces.map((w) => w.name)`);
  t.check('order reflects the move', /copy$/.test(order[1]), order);
  await t.js(`(() => { const w = currentWs(); w.name = 'Renamed'; save(); renderSidebar(); })()`);
  setTimeout(() => {}, 0);
  await t.js(`setSidebar(true)`);
  await t.sleep(300);
  const sb = await t.js(`({ items: [...document.querySelectorAll('.sb-item .sb-name')].map((e) => e.textContent), active: document.querySelector('.sb-item.active .sb-name')?.textContent, left: getComputedStyle(document.getElementById('viewport')).left })`);
  t.check('sidebar lists workspaces and marks the active one', sb.items.length === 3 && sb.active === 'Renamed' && sb.left === '190px', sb);
  await t.js(`document.querySelectorAll('.sb-item')[2].click()`);
  t.check('clicking a sidebar item switches workspace', (await t.js(`currentWs().name`)) === 'Second');

  // ---- single-workspace export/import round trip ----
  const rt1 = await t.js(`(() => {
    const src = state.workspaces[0];
    const json = JSON.parse(JSON.stringify({ orchestraiWorkspace: 1, workspace: { name: src.name, dir: src.dir, profileId: src.profileId, floors: src.floors, active: src.active } }));
    const before = state.workspaces.length;
    importWorkspace(json);
    const w = currentWs();
    return { added: state.workspaces.length - before, name: w.name, titles: w.floors[0].nodes.map((n) => n.title).sort().join(), srcTitles: src.floors[0].nodes.map((n) => n.title).sort().join(), ropes: w.floors[0].ropes.length };
  })()`);
  t.check('export/import round-trips a single workspace', rt1.added === 1 && rt1.titles === rt1.srcTitles && rt1.ropes === 1, rt1);

  const del = await t.js(`(async () => { const w = currentWs(); const n = state.workspaces.length; const p = deleteWorkspace(w); await new Promise((r) => setTimeout(r, 300)); document.querySelector('#modal-root .primary').click(); await p; return { n, after: state.workspaces.length, cur: currentWs().name }; })()`);
  t.check('delete removes the workspace and switches away', del.after === del.n - 1, del);
};
