// Config files sheet (CLAUDE.md / AGENTS.md): create, edit, sync and the guards, driven through the UI.
const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const dir = path.join(t.dataDir, 'cfg-ui');
  fs.mkdirSync(dir);
  const C = path.join(dir, 'CLAUDE.md'), A = path.join(dir, 'AGENTS.md');
  const root = (code) => t.js(`(() => { const r = document.getElementById('modal-root'); return ${code}; })()`);
  const text = () => root('r.textContent');
  const clickBtn = (label, nth = 0) => root(`[...r.querySelectorAll('button')].filter((b) => b.textContent === ${JSON.stringify(label)})[${nth}].click()`);
  const cardBtn = (name, label) => root(`[...r.querySelectorAll('.cfg-card')].find((c) => c.textContent.includes(${JSON.stringify(name)})).querySelector(${JSON.stringify(label === 'Create' ? 'button.primary' : 'button:not(.danger):not(.primary)')}).click()`);
  const open = async () => { await t.js(`configDialog(activeFloor()); 0`); await t.sleep(500); };
  const wait = (ms = 500) => t.sleep(ms);

  // ---- a floor without a directory explains itself ----
  await t.js(`activeFloor().dir = ''; 0`);
  await open();
  t.check('without a working directory it asks for one', /no working directory/.test(await text()), await text());
  await clickBtn('OK');
  await t.js(`closeModal(); activeFloor().dir = ${JSON.stringify(dir)}; 0`);

  // ---- neither file exists ----
  await open();
  let tx = await text();
  t.check('it lists both files as missing', tx.includes('CLAUDE.md') && tx.includes('AGENTS.md') && (tx.match(/Does not exist/g) || []).length === 2, tx);
  t.check('it shows the sync state', tx.includes('Neither exists'));
  t.check('the directory is shown', tx.includes(dir));
  t.check('there is nothing to sync yet', !(await root(`[...r.querySelectorAll('button')].some((b) => b.textContent.startsWith('Sync'))`)));

  // ---- create CLAUDE.md ----
  await cardBtn('CLAUDE.md', 'Create');
  await wait(800);
  t.check('Create makes an empty file', fs.existsSync(C) && fs.readFileSync(C, 'utf8') === '');
  tx = await text();
  t.check('the sheet refreshes: one exists, with Edit and Delete', tx.includes('Only one exists') && (await root(`!![...r.querySelectorAll('button')].find((b) => b.textContent === 'Edit') && !![...r.querySelectorAll('button')].find((b) => b.textContent === 'Delete')`)), tx);

  // ---- create AGENTS.md from CLAUDE.md ----
  fs.writeFileSync(C, '# Rules\nBe kind.');
  await clickBtn('Close');
  await open();
  await cardBtn('AGENTS.md', 'Create');
  await wait(500);
  t.check('it offers to copy the other file', /Start from the content of CLAUDE\.md/.test(await text()), await text());
  await clickBtn('Copy it');
  await wait(800);
  t.check('the copy has the same content', fs.existsSync(A) && fs.readFileSync(A, 'utf8') === '# Rules\nBe kind.');
  t.check('both exist and match: in sync', (await text()).includes('In sync'));
  t.check('no Sync button when in sync', !(await root(`[...r.querySelectorAll('button')].some((b) => b.textContent.startsWith('Sync'))`)));

  // ---- edit and save ----
  await cardBtn('CLAUDE.md', 'Edit');
  await wait(600);
  t.check('Edit opens the file in a text box', (await root(`r.querySelector('textarea')?.value`)) === '# Rules\nBe kind.');
  await root(`(() => { const ta = r.querySelector('textarea'); ta.value = '# Rules\\nBe kind.\\nTest first.'; return 0; })()`);
  await clickBtn('Save');
  await wait(800);
  t.check('Save writes the file', fs.readFileSync(C, 'utf8').includes('Test first.'));
  t.check('after saving the sheet shows the files differ', (await text()).includes('Different'));

  // ---- a change made elsewhere is not overwritten ----
  await cardBtn('CLAUDE.md', 'Edit');
  await wait(600);
  fs.writeFileSync(C, 'changed by someone else');
  fs.utimesSync(C, new Date(), new Date(Date.now() + 5000));
  await root(`(() => { r.querySelector('textarea').value = 'my stale edit'; return 0; })()`);
  await clickBtn('Save');
  await wait(600);
  t.check('a stale save is refused with a message', (await root(`r.querySelector('.err')?.textContent`)).length > 0 && fs.readFileSync(C, 'utf8') === 'changed by someone else', await root(`r.querySelector('.err')?.textContent`));
  await clickBtn('Reload');
  await wait(500);
  t.check('Reload brings in the other version', (await root(`r.querySelector('textarea').value`)) === 'changed by someone else');
  await root(`(() => { r.querySelector('textarea').value = 'merged'; return 0; })()`);
  await clickBtn('Save');
  await wait(800);
  t.check('saving after a reload works', fs.readFileSync(C, 'utf8') === 'merged');

  // ---- sync: choose the winner ----
  t.check('the sheet offers Sync when they differ', await root(`[...r.querySelectorAll('button')].some((b) => b.textContent.startsWith('Sync'))`));
  await clickBtn('Sync…');
  await wait(400);
  tx = await text();
  t.check('sync asks which version wins', /Keep CLAUDE\.md, overwrite AGENTS\.md/.test(tx) && /Keep AGENTS\.md, overwrite CLAUDE\.md/.test(tx), tx);
  await clickBtn('Cancel');
  await wait(500);
  t.check('Cancel returns to the sheet without changing anything', fs.readFileSync(A, 'utf8') === '# Rules\nBe kind.' && (await text()).includes('Different'));
  await clickBtn('Sync…');
  await wait(400);
  await clickBtn('Keep CLAUDE.md, overwrite AGENTS.md');
  await wait(900);
  t.check('the chosen file overwrites the other', fs.readFileSync(A, 'utf8') === 'merged');
  t.check('and the sheet shows in sync', (await text()).includes('In sync'));

  // ---- sync when only one exists ----
  fs.rmSync(A);
  await clickBtn('Close');
  await open();
  t.check('with one file the state says so', (await text()).includes('Only one exists'));
  await clickBtn('Sync…');
  await wait(400);
  t.check('the only choice creates the missing file', /Create AGENTS\.md from CLAUDE\.md/.test(await text()) && !/overwrite/.test(await text()));
  await clickBtn('Create AGENTS.md from CLAUDE.md');
  await wait(900);
  t.check('it is created with the same content', fs.existsSync(A) && fs.readFileSync(A, 'utf8') === 'merged');

  // ---- delete asks first ----
  await cardBtn('AGENTS.md', 'Edit'); // opens the editor; go back to the sheet
  await wait(500);
  await clickBtn('Back');
  await wait(500);
  await root(`[...r.querySelectorAll('.cfg-card')].find((c) => c.textContent.includes('AGENTS.md')).querySelector('button.danger').click()`);
  await wait(400);
  t.check('Delete asks for confirmation', /Move AGENTS\.md to the trash\?/.test(await text()), await text());
  await clickBtn('Cancel');
  await wait(500);
  t.check('cancelling keeps the file', fs.existsSync(A));
  await clickBtn('Close');

  // ---- the command palette entry ----
  t.check('the palette has a Config files command', await t.js(`PALETTE_COMMANDS.some((c) => c.id === 'config-files')`));
};
