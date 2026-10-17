const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const root = path.join(t.dataDir, 'floortest');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'base');

  // ---- isolated floor ----
  const wt = await call('git:worktreeAdd', repo, { name: 'feat', root: path.join(root, 'wt') });
  t.check('worktree created', wt.ok, wt);
  fs.writeFileSync(path.join(wt.dir, 'a.txt'), 'feature\n');
  git(wt.dir, 'config', 'user.email', 't@t'); git(wt.dir, 'config', 'user.name', 't');
  git(wt.dir, 'commit', '-am', 'feature change');

  // clean dry run
  let dry = await call('git:landDryRun', { repo: wt.repo, branch: wt.branch });
  t.check('dry run reports a clean merge', dry.ok && dry.clean && dry.changed.includes('a.txt'), dry);
  t.check('dry run left the base checkout untouched', fs.readFileSync(path.join(repo, 'a.txt'), 'utf8') === 'base\n' && git(repo, 'status', '--porcelain').trim() === '' && git(repo, 'worktree', 'list').trim().split('\n').length === 2);

  // conflicting change on main
  fs.writeFileSync(path.join(repo, 'a.txt'), 'main side\n');
  git(repo, 'commit', '-am', 'main change');
  dry = await call('git:landDryRun', { repo: wt.repo, branch: wt.branch });
  t.check('dry run reports conflicts', dry.ok && !dry.clean && dry.conflicts.includes('a.txt'), dry);
  t.check('no merge state leaked into the base', !fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')) && git(repo, 'status', '--porcelain').trim() === '');

  // ---- floor in the UI ----
  await t.js(`(() => {
    const f = newFloor({ name: 'Feat', dir: ${JSON.stringify(wt.dir)}, repo: ${JSON.stringify(wt.repo)}, branch: ${JSON.stringify(wt.branch)}, hooks: { setup: '', beforeLand: 'node -e "process.exit(3)"' } });
    state.floors.push(f); mountFloor(f); switchFloor(f.id);
    addNode('note', { title: 'N', x: 50, y: 50 }, f); addNode('terminal', { title: 'T', x: 400, y: 50 }, f);
    return 0;
  })()`);

  // status
  const st = await t.js(`(() => { const f = activeFloor(); setFloorStatus(f, 'Running tests', 'waiting'); return { s: f.status, badge: document.querySelector('.floor-tab.active .floor-status')?.textContent }; })()`);
  t.check('status shows as a badge on the tab', st.s.state === 'waiting' && st.badge === 'Running tests', st);
  const bad = await t.js(`(() => { try { setFloorStatus(activeFloor(), 'x', 'nope'); return false; } catch (e) { return e.message; } })()`);
  t.check('invalid state rejected', typeof bad === 'string' && /State must be/.test(bad), bad);
  await t.js(`(() => { setFloorStatus(activeFloor(), '', ''); return 0; })()`);
  t.check('empty text clears the status', await t.js(`activeFloor().status === null && !document.querySelector('.floor-status')`));

  // status through the CLI bridge path
  const term = await t.js(`activeFloor().nodes.find((n) => n.kind === 'terminal').id`);
  const viaBridge = await t.js(`bridgeHandle('floor-status', { text: 'from agent', state: 'done' }, ${JSON.stringify(term)}, 'peer').then((r) => ({ r, s: activeFloor().status }))`);
  t.check('a peer-scoped terminal can set its floor status', viaBridge.s?.text === 'from agent' && viaBridge.s.state === 'done', viaBridge);

  // hook history
  const run = await t.js(`runHookRecorded(activeFloor(), 'check', 'node -e "console.log(42);process.exit(3)"').then((r) => ({ r, runs: activeFloor().hookRuns }))`);
  t.check('hook runs are recorded with output and exit code', run.runs.length === 1 && run.runs[0].code === 3 && /42/.test(run.runs[0].output), run);

  // duplicate (same folder)
  const dup = await t.js(`(async () => {
    const f = activeFloor(); const before = state.floors.length;
    const c = await duplicateFloor(f);
    return { added: state.floors.length - before, name: c.name, kinds: c.nodes.map((n) => n.kind).sort(), ids: c.nodes.every((n) => !f.nodes.some((o) => o.id === n.id)), repo: c.repo, status: c.status, active: state.active === c.id };
  })()`);
  t.check('duplicate copies the layout with fresh ids', dup.added === 1 && dup.name === 'Feat copy' && dup.kinds.join() === 'note,terminal' && dup.ids && dup.active, dup);
  t.check('duplicate on the same folder is not an isolated floor', dup.repo === null && dup.status === null);

  // duplicate with a new worktree
  await t.js(`switchFloor(state.floors.find((f) => f.name === 'Feat').id); 0`);
  const dup2 = await t.js(`(async () => { const c = await duplicateFloor(activeFloor(), { worktree: true }); return c && { repo: c.repo, branch: c.branch, dir: c.dir }; })()`);
  t.check('duplicate with a worktree gets its own branch and folder', dup2 && dup2.repo && dup2.branch && dup2.dir && dup2.branch !== wt.branch && dup2.dir !== wt.dir && fs.existsSync(dup2.dir), dup2);

  // persisted
  const saved = await t.readSaved((s) => s.workspaces[0].floors.some((f) => f.name === 'Feat' && f.hookRuns && f.hookRuns.length));
  const sf = saved.workspaces[0].floors.find((f) => f.name === 'Feat');
  t.check('status and hook history are saved', sf && sf.hookRuns.length === 1 && sf.status.text === 'from agent', sf && { runs: sf.hookRuns, status: sf.status });

  // UI: test-landing dialog shows conflicts
  await t.js(`switchFloor(state.floors.find((f) => f.name === 'Feat').id); testLanding(activeFloor()); 0`);
  await t.sleep(1500);
  const txt = await t.js(`document.querySelector('#modal-root')?.innerText || ''`);
  t.check('test landing dialog lists the conflicting file', /conflicting/.test(txt) && /a\.txt/.test(txt), txt);
  await t.js(`closeModal(); 0`);
};
