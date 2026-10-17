const fs = require('fs'), path = require('path');
const templates = require('../../src/services/templates');

module.exports = async (t) => {
  const proj = path.join(t.dataDir, 'myproj');
  fs.mkdirSync(proj);
  // a 3-terminal setup: planner -> worker -> tester, commands, a role and a cwd inside the project folder
  await t.js(`(() => {
    const f = activeFloor(); f.dir = ${JSON.stringify(proj)}; f.nodes[0].title = 'Planner';
    const mk = (title, cmd, o) => addNode('terminal', { title, x: 200 + o, y: 100 + o, data: { command: cmd, cwd: ${JSON.stringify(proj)} + '/sub', roleId: 'role-x' } }, f).id;
    const w = mk('Worker', 'echo work', 40), te = mk('Tester', 'echo test', 80);
    f.ropes.push({ id: 'ra', a: f.nodes[0].id, b: w }, { id: 'rb', a: w, b: te });
    setSelection(f, [f.nodes[0].id, w, te]);
    return 0;
  })()`);
  const saveAs = async (name) => {
    await t.js(`window.__p = saveSelectionAsTemplate(); 0`);
    await t.sleep(300);
    await t.js(`(() => { document.querySelector('#modal-root input').value = ${JSON.stringify(name)}; document.querySelector('#modal-root .primary').click(); return 0; })()`);
    return t.js(`window.__p.then((x) => x && { id: x.id, name: x.name, nodes: x.nodes, ropes: x.ropes })`);
  };
  const tpl = await saveAs('Trio');
  t.check('saves a 3-terminal setup with its ropes', tpl && tpl.nodes.length === 3 && tpl.ropes.length === 2, tpl);
  const cwds = tpl.nodes.map((n) => n.data.cwd).filter(Boolean);
  t.check('the project folder becomes a {{dir}} variable', cwds.length === 2 && cwds.every((c) => c.startsWith('{{dir}}')), cwds);
  t.check('commands and roles are kept', tpl.nodes.some((n) => n.data.command === 'echo work') && tpl.nodes.filter((n) => n.data.roleId === 'role-x').length === 2);
  t.check('no terminal history in the template', !JSON.stringify(tpl).includes('scrollback'));

  // insert on another floor with variables filled in
  await t.js(`(() => { const f2 = newFloor({ name: 'Other' }); state.floors.push(f2); mountFloor(f2); switchFloor(f2.id); f2.nodes.forEach((n) => removeNode(f2, n.id)); return 0; })()`);
  const tplFull = (await t.js(`call('templates:list')`)).find((x) => x.id === tpl.id);
  const other = path.join(t.dataDir, 'other');
  const ins = await t.js(`(() => { const f2 = activeFloor(); const made = insertTemplate(${JSON.stringify(tplFull)}, f2, { dir: ${JSON.stringify(other)} }); return { n: made.length, ropes: f2.ropes.length, names: made.map((m) => m.title).sort(), cwds: made.map((m) => m.data.cwd).filter(Boolean), ropesOk: f2.ropes.every((r) => made.some((m) => m.id === r.a) && made.some((m) => m.id === r.b)), floor: f2.name }; })()`);
  t.check('inserts nodes and ropes on another floor with fresh ids', ins.n === 3 && ins.ropes === 2 && ins.ropesOk && ins.names.join() === 'Planner,Tester,Worker', ins);
  t.check('variables are substituted on insert', ins.cwds.length === 2 && ins.cwds.every((c) => c === other + '/sub'), ins.cwds);
  t.check('insert prompts for variables', await t.js(`(() => { askVars(${JSON.stringify(tplFull)}, activeFloor()); const ok = !!document.querySelector('#modal-root input[data-var="dir"]'); closeModal(); return ok; })()`));
  await t.sleep(2000); // let the inserted shells start so exit is clean

  // library: update, rename, duplicate names, export/import round trip, delete
  const dup = await saveAsOn(t, 'Trio');
  t.check('duplicate names are made unique', dup.name === 'Trio (2)', dup);
  await t.js(`call('templates:rename', '${dup.id}', 'Copy of trio')`);
  const exportFile = path.join(t.dataDir, 'layouts.json');
  const n = templates.exportTo(exportFile, [tpl.id]);
  const file = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  t.check('export writes a layout file', n === 1 && file.format === 'orchestrai-templates' && file.templates[0].nodes.length === 3 && !file.templates[0].id, file.format);
  const added = templates.importFrom(exportFile);
  const names = (await t.js(`call('templates:list')`)).map((x) => x.name);
  t.check('import round-trips (renamed on collision)', added === 1 && names.filter((x) => x.startsWith('Trio')).length === 2, names);
  fs.writeFileSync(path.join(t.dataDir, 'bad.json'), '{"format":"nope"}');
  let bad = null; try { templates.importFrom(path.join(t.dataDir, 'bad.json')); } catch (e) { bad = e.message; }
  t.check('importing a wrong file is refused', /layout file/.test(bad), bad);
  const upd = await t.js(`(async () => { setSelection(activeFloor(), activeFloor().nodes.slice(0, 1).map((x) => x.id)); const tpl = await saveSelectionAsTemplate({ id: '${tpl.id}', name: 'Trio' }); return tpl && tpl.nodes.length; })()`);
  t.check('update replaces a layout with the current selection', upd === 1, upd);
  await t.js(`call('templates:remove', '${dup.id}')`);
  t.check('delete removes it and the library persists to disk', JSON.parse(fs.readFileSync(path.join(t.dataDir, 'templates.json'), 'utf8')).every((x) => x.id !== dup.id));

  await t.js(`templatesDialog()`);
  await t.sleep(400);
  t.check('library dialog lists layouts', (await t.js(`document.querySelectorAll('.routine-row').length`)) >= 2);
};

async function saveAsOn(t, name) {
  await t.js(`(() => { const f = state.floors[0]; switchFloor(f.id); setSelection(f, f.nodes.slice(0, 2).map((x) => x.id)); window.__p = saveSelectionAsTemplate(); return 0; })()`);
  await t.sleep(300);
  await t.js(`(() => { document.querySelector('#modal-root input').value = ${JSON.stringify(name)}; document.querySelector('#modal-root .primary').click(); return 0; })()`);
  return t.js(`window.__p.then((x) => x && { id: x.id, name: x.name })`);
}
