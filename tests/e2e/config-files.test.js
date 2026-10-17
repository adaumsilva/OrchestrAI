const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const dir = path.join(t.dataDir, 'proj');
  fs.mkdirSync(dir);
  await t.js(`activeFloor().dir = ${JSON.stringify(dir)}`);
  const st = () => t.js(`call('config:status', ${JSON.stringify(dir)})`);
  const C = path.join(dir, 'CLAUDE.md'), A = path.join(dir, 'AGENTS.md');

  let s = await st();
  t.check('neither exists at first', s.sync === 'none' && !s.files['CLAUDE.md'].exists, s);

  const created = await t.js(`call('config:write', ${JSON.stringify(dir)}, 'CLAUDE.md', '# Rules', null)`);
  t.check('create works', created.ok && fs.readFileSync(C, 'utf8') === '# Rules', created);
  const again = await t.js(`call('config:write', ${JSON.stringify(dir)}, 'CLAUDE.md', 'x', null)`);
  t.check('create refuses to overwrite an existing file', !again.ok && again.stale, again);
  s = await st();
  t.check('status: only one exists, with character count', s.sync === 'onlyOne' && s.files['CLAUDE.md'].chars === 7, s);

  const edit = await t.js(`call('config:write', ${JSON.stringify(dir)}, 'CLAUDE.md', '# Rules v2', ${created.mtime})`);
  t.check('edit with the mtime we read works', edit.ok && fs.readFileSync(C, 'utf8') === '# Rules v2', edit);

  // stale-write protection
  fs.writeFileSync(C, '# changed elsewhere');
  fs.utimesSync(C, new Date(), new Date(Date.now() + 5000));
  const staleW = await t.js(`call('config:write', ${JSON.stringify(dir)}, 'CLAUDE.md', 'mine', ${edit.mtime})`);
  t.check('stale write is refused and file kept', !staleW.ok && staleW.stale && fs.readFileSync(C, 'utf8') === '# changed elsewhere', staleW);

  const read1 = await t.js(`call('config:read', ${JSON.stringify(dir)}, 'CLAUDE.md')`);
  // sync creates the missing file
  const sy1 = await t.js(`call('config:sync', ${JSON.stringify(dir)}, 'CLAUDE.md', { 'CLAUDE.md': ${read1.mtime}, 'AGENTS.md': null })`);
  t.check('sync creates the other file', sy1.ok && fs.readFileSync(A, 'utf8') === '# changed elsewhere', sy1);
  s = await st();
  t.check('status: in sync', s.sync === 'inSync', s);

  // differing content: explicit winner, and stale protection on both sides
  fs.writeFileSync(A, 'agents version');
  s = await st();
  t.check('status: different', s.sync === 'different', s);
  const seen = { 'CLAUDE.md': s.files['CLAUDE.md'].mtime, 'AGENTS.md': s.files['AGENTS.md'].mtime };
  fs.writeFileSync(C, 'claude touched after reading');
  fs.utimesSync(C, new Date(), new Date(Date.now() + 9000));
  const sy2 = await t.js(`call('config:sync', ${JSON.stringify(dir)}, 'AGENTS.md', ${JSON.stringify(seen)})`);
  t.check('sync refuses when either file changed since read', !sy2.ok && sy2.stale && fs.readFileSync(A, 'utf8') === 'agents version', sy2);
  s = await st();
  const seen2 = { 'CLAUDE.md': s.files['CLAUDE.md'].mtime, 'AGENTS.md': s.files['AGENTS.md'].mtime };
  const sy3 = await t.js(`call('config:sync', ${JSON.stringify(dir)}, 'AGENTS.md', ${JSON.stringify(seen2)})`);
  t.check('chosen winner overwrites the other', sy3.ok && sy3.overwrote === 'CLAUDE.md' && fs.readFileSync(C, 'utf8') === 'agents version', sy3);

  const bad = await t.js(`call('config:write', ${JSON.stringify(dir)}, '../evil.md', 'x', null)`);
  t.check('only the two known names are accepted', !bad.ok, bad);

  // UI: the dialog shows both files and the sync state; the floor menu links to it
  await t.js(`configDialog(activeFloor())`);
  await t.sleep(500);
  const ui = await t.js(`({ cards: document.querySelectorAll('.cfg-card').length, sync: document.querySelector('.cfg-sync').textContent })`);
  t.check('dialog shows both files and sync state', ui.cards === 2 && ui.sync === 'In sync', ui);
};
