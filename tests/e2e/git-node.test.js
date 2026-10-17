const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const root = path.join(t.dataDir, 'gitnode');
  const bare = path.join(root, 'origin.git'), repo = path.join(root, 'repo'), other = path.join(root, 'other');
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(root, 'clone', bare, repo);
  const ident = (d) => { git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't'); };
  ident(repo);
  git(repo, 'checkout', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'base commit', '-m', 'Body line one.\nBody line two.');

  // ---- push (no upstream yet -> sets it) ----
  let r = await call('git:push', repo, { opId: 'p1' });
  t.check('push publishes a branch without upstream', r.ok && /main/.test(git(bare, 'branch')), r);

  // ---- fetch + pull ----
  git(root, 'clone', bare, other); ident(other);
  fs.writeFileSync(path.join(other, 'b.txt'), 'from other\n');
  git(other, 'add', '-A'); git(other, 'commit', '-m', 'other work'); git(other, 'push');
  r = await call('git:fetch', repo, { opId: 'f1' });
  t.check('fetch succeeds', r.ok, r);
  t.check('state shows we are behind', (await call('git:state', repo)).behind === 1);
  r = await call('git:pull', repo, { opId: 'pl1' });
  t.check('pull brings the remote commit', r.ok && fs.existsSync(path.join(repo, 'b.txt')), r);

  // ---- cancel ----
  const slow = path.join(root, 'slow'); // a remote that never answers: a local TCP server that accepts and stays silent
  const net = require('net');
  const srv = net.createServer((s) => { s.on('error', () => {}); }); await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  git(repo, 'remote', 'add', 'hang', `git://127.0.0.1:${srv.address().port}/x.git`);
  const pending = call('git:fetch', repo, { opId: 'cancel-me' }).catch((e) => ({ err: String(e) }));
  await t.sleep(800);
  const cancelled = await call('git:cancel', 'cancel-me');
  const res = await Promise.race([pending, t.sleep(8000).then(() => 'timeout')]);
  t.check('a running network operation can be cancelled', cancelled === true && res && res.cancelled === true && res.err === 'Cancelled', { cancelled, res });
  srv.close(); git(repo, 'remote', 'remove', 'hang');

  // ---- merge preview / merge with conflicts ----
  git(repo, 'checkout', '-b', 'topic');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'topic side\n');
  git(repo, 'commit', '-am', 'topic change');
  git(repo, 'checkout', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'main side\n');
  git(repo, 'commit', '-am', 'main change');
  const prev = await call('git:mergePreview', repo, 'topic');
  t.check('merge preview lists conflicts before merging', prev.ok && !prev.clean && prev.conflicts.join() === 'a.txt', prev);
  t.check('preview did not touch the checkout', git(repo, 'status', '--porcelain').trim() === '' && fs.readFileSync(path.join(repo, 'a.txt'), 'utf8') === 'main side\n');
  const mg = await call('git:merge', repo, 'topic');
  t.check('merge stops on the conflict and reports files', !mg.ok && mg.conflicts.join() === 'a.txt', mg);
  const ms = await call('git:mergeState', repo);
  t.check('merge state is detected', ms.merging && ms.conflicts.join() === 'a.txt', ms);

  // UI: git node shows the banner and conflicted row
  const nodeId = await t.js(`(() => { const f = activeFloor(); f.dir = ${JSON.stringify(repo)}; return addNode('git', { x: 50, y: 50 }, f).id; })()`);
  await t.sleep(1500);
  const ui = await t.js(`(() => { const el = rt.get(state.active).live.get('${nodeId}').el; return { banner: el.querySelector('.git-banner')?.innerText || '', conflicted: el.querySelectorAll('.change.conflicted').length, sync: [...el.querySelectorAll('button')].map((b) => b.textContent).filter((x) => /Fetch|Pull|Push/.test(x)) }; })()`);
  t.check('git node shows merge-in-progress banner and conflicted file', /Merge in progress/.test(ui.banner) && ui.conflicted === 1, ui);
  t.check('git node has fetch, pull and push buttons', ui.sync.length === 3, ui);

  await call('git:mergeAbort', repo);
  const afterAbort = { merging: (await call('git:mergeState', repo)).merging, text: fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), status: git(repo, 'status', '--short') };
  t.check('abort restores the checkout', !afterAbort.merging && afterAbort.text.split(String.fromCharCode(13)).join('') === 'main side' + String.fromCharCode(10), afterAbort);

  // clean merge
  git(repo, 'checkout', '-b', 'clean'); fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'clean work'); git(repo, 'checkout', 'main');
  t.check('clean merge preview', (await call('git:mergePreview', repo, 'clean')).clean === true);
  t.check('clean merge completes', (await call('git:merge', repo, 'clean')).ok && fs.existsSync(path.join(repo, 'c.txt')));

  // ---- commit details ----
  const first = git(repo, 'rev-list', '--max-parents=0', 'HEAD').trim();
  const d = await call('git:commitDetails', repo, first);
  t.check('commit details include body and files', d.ok && d.subject === 'base commit' && /Body line two/.test(d.body) && d.files.some((f) => f.file === 'a.txt' && f.status === 'A'), d);
  const fd = await call('git:commitFileDiff', repo, { hash: first, file: 'a.txt' });
  t.check('per-file diff of a commit', /\+base/.test(fd), fd);

  // UI: history row click shows details
  await t.js(`(() => { const el = rt.get(state.active).live.get('${nodeId}').el; [...el.querySelectorAll('button')].find((b) => b.textContent === 'history').click(); return 0; })()`);
  await t.sleep(900);
  await t.js(`(() => { const el = rt.get(state.active).live.get('${nodeId}').el; [...el.querySelectorAll('.commit-row')].pop().click(); return 0; })()`);
  await t.sleep(800);
  const shown = await t.js(`rt.get(state.active).live.get('${nodeId}').el.querySelector('.commit-subject')?.textContent`);
  t.check('clicking a commit in history shows its details', shown === 'base commit', shown);

  // ---- stashes ----
  fs.writeFileSync(path.join(repo, 'a.txt'), 'stash me\n');
  await call('git:stashPush', repo, 'wip');
  t.check('stash cleared the change', fs.readFileSync(path.join(repo, 'a.txt'), 'utf8') !== 'stash me\n');
  await call('git:stashApply', repo, 0);
  const afterApply = { text: fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), stashes: await call('git:stashes', repo) };
  t.check('stash apply restores the change and keeps the stash', afterApply.text.replace(/\r/g, '') === 'stash me\n' && afterApply.stashes.length === 1, afterApply);
  git(repo, 'checkout', '--', 'a.txt');
  await call('git:stashDrop', repo, 0);
  t.check('stash drop removes it', (await call('git:stashes', repo)).length === 0);

  // ---- stale index.lock ----
  fs.writeFileSync(path.join(repo, '.git', 'index.lock'), '');
  const lock = await call('git:lockInfo', repo);
  t.check('index.lock is detected', lock.locked === true, lock);
  await t.sleep(4500); // the node polls every 4 s
  const bannerLock = await t.js(`rt.get(state.active).live.get('${nodeId}').el.querySelector('.git-banner')?.innerText || ''`);
  t.check('banner offers to remove the stale lock', /index\.lock/.test(bannerLock), bannerLock);
  await call('git:removeLock', repo);
  t.check('lock removed', !fs.existsSync(path.join(repo, '.git', 'index.lock')) && (await call('git:lockInfo', repo)).locked === false);
};
