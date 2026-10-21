// The New / Edit Terminal sheet: tabs, validation, creating a terminal and editing one.
module.exports = async (t) => {
  const sheet = (code) => t.js(`(() => { const s = document.querySelector('.sheet'); return ${code}; })()`);
  const setInput = (placeholder, value) => t.js(`(() => { const i = [...document.querySelectorAll('.sheet input')].find((x) => (x.placeholder || '').startsWith(${JSON.stringify(placeholder)})); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input')); return !!i; })()`);
  const clickHead = (label) => t.js(`[...document.querySelectorAll('.sheet-head button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  const selectRuns = (v) => t.js(`(() => { const s = [...document.querySelectorAll('.sheet select')].find((x) => [...x.options].some((o) => o.value === 'ssh')); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); return 0; })()`);
  const tabBtn = (label) => t.js(`[...document.querySelectorAll('.sheet .seg button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  const nodeByTitle = (title) => t.js(`(() => { const n = activeFloor().nodes.find((x) => x.title === ${JSON.stringify(title)}); return n ? { id: n.id, data: JSON.parse(JSON.stringify(n.data)) } : null; })()`);
  const open = async (args) => { await t.js(`terminalDialog(${args}); 0`); await t.sleep(900); };

  // ---- new terminal ----
  await open(`{ mode: 'new', floor: activeFloor() }`);
  t.check('the sheet is titled New Terminal', (await sheet(`s.querySelector('.sheet-title').textContent`)) === 'New Terminal');
  t.check('it has Details, Appearance and Role tabs', JSON.stringify(await sheet(`[...s.querySelectorAll('.seg button')].map((b) => b.textContent)`)) === '["Details","Appearance","Role"]');
  t.check('Details shows the main fields', await sheet(`['Terminal Name', 'Command', 'Runs on', 'Working Directory', 'Monitor Activity', 'Maestro'].every((l) => s.textContent.includes(l))`));
  t.check('quick-start presets are offered for a new terminal', (await sheet(`s.querySelectorAll('.quick-item').length`)) > 0);

  // ---- validation ----
  await selectRuns('ssh');
  await t.sleep(200);
  await clickHead('Create');
  await t.sleep(300);
  t.check('SSH without a host is refused', (await sheet(`s.querySelector('.err')?.textContent`)) === 'Enter the SSH host.');
  t.check('the sheet stays open', await sheet(`!!s`));
  await selectRuns('docker');
  await t.sleep(200);
  await clickHead('Create');
  await t.sleep(300);
  t.check('Docker without a container is refused', (await sheet(`s.querySelector('.err')?.textContent`)) === 'Choose or enter a container.');
  await selectRuns('default');
  await t.sleep(200);

  // ---- tabs keep their state ----
  await setInput('Terminal name', 'Builder');
  await setInput('e.g. claude', 'node --version');
  await tabBtn('Appearance');
  await t.sleep(200);
  t.check('Appearance offers theme and color choices', await sheet(`/Theme|Color|Icon/i.test(s.textContent)`));
  await tabBtn('Role');
  await t.sleep(200);
  t.check('Role tab opens', await sheet(`/role/i.test(s.querySelector('.sheet-body').textContent)`));
  await tabBtn('Details');
  await t.sleep(200);
  t.check('what was typed survives switching tabs', (await sheet(`[...s.querySelectorAll('input')].find((x) => x.placeholder === 'Terminal name').value`)) === 'Builder');

  // ---- create ----
  await clickHead('Create');
  await t.sleep(600);
  const made = await nodeByTitle('Builder');
  t.check('Create adds the terminal with its command', made && made.data.command === 'node --version', made);
  t.check('the sheet closes', await t.js(`!document.querySelector('.sheet')`));
  t.check('an untouched Runs on stays the workspace default', made && made.data.runsOn === undefined, made && made.data);

  // ---- a blank name falls back to the command ----
  await open(`{ mode: 'new', floor: activeFloor() }`);
  await setInput('e.g. claude', 'node -v');
  await clickHead('Create');
  await t.sleep(500);
  t.check('with no name the title comes from the command', !!(await nodeByTitle('node')));

  // ---- cancel adds nothing ----
  const before = await t.js(`activeFloor().nodes.length`);
  await open(`{ mode: 'new', floor: activeFloor() }`);
  await setInput('Terminal name', 'Ghost');
  await clickHead('Cancel');
  await t.sleep(300);
  t.check('Cancel creates nothing', (await t.js(`activeFloor().nodes.length`)) === before && !(await nodeByTitle('Ghost')));

  // ---- edit ----
  await t.sleep(1500); // let the terminal start
  await open(`{ mode: 'edit', floor: activeFloor(), node: activeFloor().nodes.find((n) => n.title === 'Builder') }`);
  t.check('the edit sheet is titled and prefilled', (await sheet(`s.querySelector('.sheet-title').textContent`)) === 'Edit Terminal' && (await sheet(`[...s.querySelectorAll('input')].find((x) => x.placeholder === 'Terminal name').value`)) === 'Builder');
  t.check('edit has no quick-start row', (await sheet(`s.querySelectorAll('.quick-item').length`)) === 0);
  await setInput('Terminal name', 'Builder 2');
  await clickHead('Save');
  await t.sleep(500);
  const renamed = await nodeByTitle('Builder 2');
  t.check('renaming saves without asking for a restart', renamed && renamed.data.command === 'node --version' && !(await t.js(`document.getElementById('modal-root').textContent.includes('Restart terminal?')`)));
  t.check('the node header shows the new name', (await t.js(`rt.get(state.active).live.get('${renamed.id}').el.querySelector('.title').textContent`)) === 'Builder 2');

  // ---- changing the command offers a restart ----
  await open(`{ mode: 'edit', floor: activeFloor(), node: activeFloor().nodes.find((n) => n.title === 'Builder 2') }`);
  await setInput('e.g. claude', 'node -e 1');
  await clickHead('Save');
  await t.sleep(500);
  t.check('a launch change asks whether to restart', await t.js(`document.getElementById('modal-root').textContent.includes('Restart terminal?')`));
  await t.js(`[...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Cancel').click(); 0`);
  await t.sleep(300);
  const edited = await nodeByTitle('Builder 2');
  t.check('declining keeps the new settings but does not restart', edited && edited.data.command === 'node -e 1');
};
