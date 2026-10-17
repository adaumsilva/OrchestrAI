module.exports = async (t) => {
  // second floor with a distinctly named note so we can jump across floors
  await t.js(`(() => { const nf = newFloor({ name: 'Backend' }); state.floors.push(nf); mountFloor(nf); const n = addNode('note', { title: 'Deploy checklist' }, nf); window.__noteId = n.id; return 1; })()`);
  await t.key('K', ['control']);
  t.check('Ctrl+K opens palette', await t.js(`!!document.getElementById('palette')`));
  t.check('input focused', await t.js(`document.activeElement.classList.contains('pal-input')`));
  await t.type('deploy');
  const top = await t.js(`document.querySelector('.pal-row.sel .pal-label').textContent`);
  t.check('cross-floor node ranks first', top === 'Deploy checklist', top);
  await t.key('Return');
  const r = await t.js(`({ open: !!document.getElementById('palette'), floor: activeFloor().name, sel: [...selection].includes(window.__noteId) })`);
  t.check('Enter closes palette', !r.open, r);
  t.check('switches floor', r.floor === 'Backend', r);
  t.check('selects node', r.sel, r);
  // ranking: prefix beats fuzzy
  await t.key('K', ['control']);
  await t.type('tidy');
  const tidy = await t.js(`document.querySelector('.pal-row.sel .pal-label').textContent`);
  t.check('command found and shows shortcut', tidy === 'Tidy nodes' && await t.js(`document.querySelector('.pal-row.sel kbd').textContent`) === 'T', tidy);
  await t.key('Escape');
  t.check('Esc closes', !(await t.js(`!!document.getElementById('palette')`)));
  t.check('ranking exact>prefix>fuzzy', await t.js(`fuzzyScore('tidy','tidy') > fuzzyScore('tid','tidy nodes') && fuzzyScore('tid','tidy nodes') > fuzzyScore('tn','tidy nodes') && fuzzyScore('zz','tidy')===0`));
  // pickNode
  const p = await t.js(`(async () => { const pr = pickNode({ kind: 'note' }); await new Promise(r=>setTimeout(r,50)); document.querySelector('.pal-row').click(); const x = await pr; return x && x.node.title; })()`);
  t.check('pickNode resolves chosen node', p === 'Deploy checklist', p);
};
