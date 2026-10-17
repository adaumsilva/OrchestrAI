const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

module.exports = async (t) => {
  const root = path.join(t.dataDir, 'prtest');
  const bare = path.join(root, 'github-origin.git'), repo = path.join(root, 'repo');
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(root, 'clone', bare, repo);
  git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't');
  git(repo, 'checkout', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base');
  git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'base'); git(repo, 'push', 'origin', 'main');
  // a "pull request" branch published under the host's PR ref
  git(repo, 'checkout', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'pr-file.txt'), 'from the PR');
  git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'pr work'); git(repo, 'push', 'origin', 'feature:refs/pull/7/head', 'feature:feature');
  git(repo, 'checkout', 'main');

  const stateFile = path.join(root, 'gh-state.json');
  const writeState = (s) => fs.writeFileSync(stateFile, JSON.stringify(s));
  process.env.FAKE_GH_STATE = stateFile;
  process.env.ORCH_CLI_GH = JSON.stringify([process.execPath.includes('electron') ? 'node' : process.execPath, path.join(__dirname, 'fake-gh.js')]);
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);

  // host detection and CLI problems
  const host = await call('pr:host', repo);
  t.check('host detected from origin', host.host === 'gh', host);
  writeState({ auth: false });
  const noAuth = await call('pr:status', repo);
  t.check('signed-out CLI gives a clear message', noAuth.error === 'auth' && /gh auth login/.test(noAuth.message), noAuth);
  const saveCli = process.env.ORCH_CLI_GH;
  process.env.ORCH_CLI_GH = JSON.stringify(['definitely-not-a-real-binary-xyz']);
  const missing = await call('pr:status', repo);
  t.check('missing CLI gives an install hint', missing.error === 'missing' && /install/i.test(missing.message), missing);
  process.env.ORCH_CLI_GH = saveCli;

  // no PR yet -> push + create
  writeState({});
  t.check('no PR reports none', (await call('pr:status', repo)).none === true);
  git(repo, 'checkout', 'feature');
  const pushed = await call('pr:push', repo, {});
  t.check('push publishes the branch', pushed.ok && git(bare, 'branch', '--list', 'feature').includes('feature'), pushed);
  git(repo, 'checkout', 'main');
  const created = await call('pr:create', repo, { title: 'My change', body: 'details', draft: false });
  t.check('create returns the PR url', created.ok && created.url === 'https://github.com/x/y/pull/7', created);
  const st = await call('pr:status', repo);
  t.check('status normalizes PR fields and checks', st.pr && st.pr.number === 7 && st.pr.state === 'open' && st.pr.checks.state === 'pending' && st.pr.head === 'feature', st);

  // floor from an existing PR: worktree with the PR files
  const wtRoot = path.join(root, 'worktrees');
  const fp = await call('pr:fromPr', repo, '7', wtRoot);
  t.check('floor from PR creates a worktree on the PR head', fp.ok && fs.readFileSync(path.join(fp.dir, 'pr-file.txt'), 'utf8') === 'from the PR' && fp.branch === 'orchestrai/pr-7', fp);
  t.check('PR diff files are listed', fp.files && fp.files.some((f) => f.file === 'pr-file.txt' && f.status === 'A'), fp.files);

  // badge on the floor tab + dialog + merge
  await t.js(`(() => { const f = newFloor({ name: 'PR floor', dir: ${JSON.stringify(fp.dir)}, repo: ${JSON.stringify(fp.repo)}, branch: ${JSON.stringify(fp.branch)} }); state.floors.push(f); mountFloor(f); switchFloor(f.id); return 0; })()`);
  await t.js(`refreshPrBadges(true)`);
  await t.sleep(800);
  const badge = await t.js(`document.querySelector('.floor-tab.active .pr-badge')?.textContent`);
  t.check('floor tab shows the PR badge', badge === '#7', badge);
  const dlg = await t.js(`(async () => { await prDialog(activeFloor()); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('#modal-root h3')?.textContent; })()`);
  t.check('PR dialog shows number and title', /#7/.test(dlg), dlg);
  await t.js(`closeModal()`);
  const merged = await call('pr:merge', fp.dir, 'squash');
  t.check('merge runs the host merge with the chosen method', merged.ok && JSON.parse(fs.readFileSync(stateFile, 'utf8')).mergedWith === '--squash', merged);
  await t.js(`refreshPrBadges(true)`);
  await t.sleep(600);
  t.check('badge reflects merged state', (await t.js(`document.querySelector('.floor-tab.active .pr-badge')?.textContent`)) === 'merged');

  // credentials are never read or stored: the service never touches tokens
  const src = fs.readFileSync(path.join(__dirname, '../../src/services/prs.js'), 'utf8');
  t.check('service does not handle tokens', !/GH_TOKEN|GITHUB_TOKEN|auth token/i.test(src.replace(/auth login|authentication/gi, '')));
};
