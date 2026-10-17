const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const root = path.join(t.dataDir, 'sbx');
  fs.mkdirSync(root, { recursive: true });
  const stateFile = path.join(root, 'docker-state.json');
  const proj = path.join(root, 'project');
  fs.mkdirSync(proj);
  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const writeState = (patch) => fs.writeFileSync(stateFile, JSON.stringify({ ...(fs.existsSync(stateFile) ? readState() : {}), ...patch }));
  writeState({ sandboxes: [
    { name: 'zeta', agent: 'codex', status: 'stopped', workspace: path.join(root, 'other') },
    { name: 'alpha', agent: 'claude', status: 'running', workspace: path.join(root, 'elsewhere') },
    { name: 'web', agent: 'claude', status: 'running', workspace: proj },
  ] });
  process.env.FAKE_DOCKER_STATE = stateFile;
  process.env.ORCH_CLI_DOCKER = JSON.stringify(['node', path.join(__dirname, 'fake-docker.js')]);

  // ---- list ----
  const list = await call('sandbox:list');
  t.check('lists sandboxes with agent, status and workspace', list.ok && list.sandboxes.length === 3 && list.sandboxes.find((s) => s.name === 'web').workspace === proj && list.sandboxes.find((s) => s.name === 'alpha').agent === 'claude' && list.sandboxes.find((s) => s.name === 'zeta').status === 'stopped', list);

  // ---- picker in the terminal sheet: this workspace's sandbox first ----
  await t.js(`(() => { activeFloor().dir = ${JSON.stringify(proj)}; terminalDialog({ mode: 'new', floor: activeFloor() }); return 0; })()`);
  await t.sleep(600);
  await t.js(`(() => { const sel = [...document.querySelectorAll('#modal-root select')].find((s) => [...s.options].some((o) => o.value === 'sandbox')); sel.value = 'sandbox'; sel.dispatchEvent(new Event('change')); return 0; })()`);
  await t.sleep(1500);
  const opts = await t.js(`(() => { const sel = [...document.querySelectorAll('#modal-root select')].find((s) => [...s.options].some((o) => /^web/.test(o.textContent))); return sel ? [...sel.options].map((o) => o.value) : null; })()`);
  t.check('the sandbox picker lists sandboxes, matching workspace first', opts && opts.join() === ',web,alpha,zeta', opts);
  await t.js(`closeModal(); 0`);

  // ---- create ----
  const made = await t.js(`(async () => {
    const p = createSandboxDialog(${JSON.stringify(proj)});
    await new Promise((r) => setTimeout(r, 300));
    const m = document.querySelector('#modal-root');
    m.querySelectorAll('input')[1].value = 'api-box';
    [...m.querySelectorAll('button')].find((b) => b.textContent === 'Create').click();
    return p;
  })()`);
  t.check('create flow makes a sandbox and returns its name', made === 'api-box' && readState().sandboxes.some((s) => s.name === 'api-box' && s.workspace === proj), { made, st: readState().sandboxes });
  t.check('a bad name is refused', (await call('sandbox:create', { agent: 'claude', workspace: proj, name: 'bad name!' })).ok === false);
  t.check('agent and workspace are required', (await call('sandbox:create', { agent: '', workspace: '' })).ok === false);

  // ---- connection test ----
  const ok = await call('sandbox:test', 'web');
  t.check('connection test passes and records each command', ok.ok && ok.steps.length === 3 && /sandbox exec web echo/.test(ok.diagnostic) && ok.steps.every((s) => s.ok), ok);
  writeState({ broken: true });
  const bad = await call('sandbox:test', 'web');
  t.check('a failing test explains where it failed', !bad.ok && bad.steps.length === 1 && /FAILED/.test(bad.diagnostic) && /dockerDesktopLinuxEngine/.test(bad.diagnostic), bad);
  await t.js(`testSandbox('web'); 0`);
  await t.sleep(1500);
  const dlg = await t.js(`(() => { const m = document.querySelector('#modal-root'); return { text: m.innerText.slice(0, 200), ta: m.querySelector('textarea')?.value || '' }; })()`);
  t.check('the failure dialog shows a copyable diagnostic', /Failed at/.test(dlg.text) && /OrchestrAI/.test(dlg.ta) && /FAILED/.test(dlg.ta), dlg);
  await t.js(`closeModal(); 0`);
  writeState({ broken: false });

  // ---- attach a terminal ----
  const term = async (title) => {
    const id = await t.js(`addNode('terminal', { title: ${JSON.stringify(title)}, x: 40, y: 40, data: { runsOn: { kind: 'sandbox', sandbox: 'web' } } }, activeFloor()).id`);
    await t.sleep(3500);
    return { id, screen: await t.js(`rt.get(state.active).live.get('${id}').api.readScreen()`) };
  };
  const t1 = await term('in-sandbox');
  t.check('a terminal attaches to the chosen sandbox', /SANDBOX-SHELL web/.test(t1.screen), t1.screen.slice(-200));
  t.check('no policy notice without a denial', !/policy denied/.test(t1.screen));

  // ---- policy denial ----
  writeState({ policyDeny: true });
  const t2 = await term('denied');
  const flat = t2.screen.split('\n').join(''); // the terminal wraps long lines
  t.check('a policy denial is called out with the suggested fix', /policy denied something/.test(flat) && /Suggested fix: docker sandbox network proxy web --allow-host api\.example\.com/.test(flat), t2.screen.slice(-400));
  const denial = await t.js(`findSandboxDenial('GET x\\nblocked by network policy\\n run: docker sandbox network proxy foo --allow-host a.b')`);
  t.check('the denial finder extracts the fix command', denial && denial.fix === 'docker sandbox network proxy foo --allow-host a.b', denial);
  t.check('unrelated output is not a denial', (await t.js(`findSandboxDenial('npm ERR! blocked a build step')`)) === null);

  // ---- never deletes ----
  t.check('OrchestrAI never removed a sandbox', !readState().calls.some((c) => /sandbox (rm|remove|delete|stop)/.test(c)) && readState().sandboxes.length === 4);
};
