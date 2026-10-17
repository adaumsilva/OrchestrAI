// Pull request integration through the host's own CLI (gh for GitHub, glab for GitLab). No token is ever read or stored here:
// authentication is whatever the user did with `gh auth login` / `glab auth login`.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

// Tests point a host at a stand-in script: ORCH_CLI_GH='["node","C:/fake-gh.js"]'.
function cliFor(host) {
  const override = process.env[`ORCH_CLI_${host.toUpperCase()}`];
  if (override) { try { const a = JSON.parse(override); return { cmd: a[0], pre: a.slice(1) }; } catch {} }
  return { cmd: host, pre: [] };
}

function exec(cmd, args, cwd, timeout = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' } },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '').trim(), missing: !!(err && err.code === 'ENOENT') }));
  });
}
const git = (cwd, args) => exec('git', args, cwd);

function hostFromRemote(url) {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[/:]/.exec(String(url).trim());
  const name = (m ? m[1] : '').toLowerCase();
  const probe = name.length > 1 ? name : String(url).toLowerCase(); // a bare path (no host) is matched on the whole string
  if (probe.includes('github')) return 'gh';
  if (probe.includes('gitlab')) return 'glab';
  return null;
}

async function detect(dir) {
  if (!dir || !fs.existsSync(dir)) return { error: 'nodir', message: 'The folder does not exist.' };
  const r = await git(dir, ['remote', 'get-url', 'origin']);
  if (!r.ok) return { error: 'noremote', message: 'This repository has no "origin" remote.' };
  const host = hostFromRemote(r.out);
  if (!host) return { error: 'unsupported', message: `Unsupported git host (${r.out.trim()}). GitHub and GitLab are supported.` };
  return { host, remote: r.out.trim() };
}

function cliError(host, r) {
  const name = host === 'gh' ? 'GitHub CLI (gh)' : 'GitLab CLI (glab)';
  if (r.missing) return { error: 'missing', message: `${name} is not installed. Install it from ${host === 'gh' ? 'https://cli.github.com' : 'https://gitlab.com/gitlab-org/cli'} and sign in.` };
  if (/auth login|not logged in|authentication|401|token/i.test(r.err)) return { error: 'auth', message: `${name} is not signed in. Run "${host} auth login" in a terminal.` };
  return { error: 'failed', message: r.err || 'The command failed.' };
}

// Run the host CLI in a repo directory; returns { ok, out } or { error, message }.
async function hostCli(dir, args) {
  const d = await detect(dir);
  if (d.error) return d;
  const { cmd, pre } = cliFor(d.host);
  const r = await exec(cmd, [...pre, ...args(d.host)], dir);
  return r.ok ? { ok: true, out: r.out, host: d.host } : cliError(d.host, r);
}

function checksOf(rollup) {
  const items = Array.isArray(rollup) ? rollup : [];
  if (!items.length) return { state: 'none', total: 0, failed: 0 };
  const bad = (c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'failed'].includes(c.conclusion || c.state || c.status);
  const pending = (c) => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'running', 'pending'].includes(c.status || c.state) && !c.conclusion;
  const failed = items.filter(bad).length;
  return { state: failed ? 'fail' : items.some(pending) ? 'pending' : 'pass', total: items.length, failed };
}

function normalizeGh(j) {
  return { number: j.number, title: j.title, state: String(j.state || '').toLowerCase(), url: j.url, draft: !!j.isDraft, head: j.headRefName, base: j.baseRefName,
    review: String(j.reviewDecision || '').toLowerCase(), mergeable: String(j.mergeable || '').toLowerCase(), checks: checksOf(j.statusCheckRollup) };
}
function normalizeGlab(j) {
  return { number: j.iid, title: j.title, state: j.state === 'opened' ? 'open' : j.state, url: j.web_url, draft: !!j.draft, head: j.source_branch, base: j.target_branch,
    review: j.approved ? 'approved' : '', mergeable: j.merge_status === 'can_be_merged' ? 'mergeable' : j.has_conflicts ? 'conflicting' : '', checks: checksOf(j.pipeline ? [{ status: j.pipeline.status }] : []) };
}
const GH_FIELDS = 'number,title,state,url,isDraft,headRefName,baseRefName,reviewDecision,mergeable,statusCheckRollup';

// PR for the branch checked out in `dir`, or { none: true }.
async function status(dir, ref) {
  const r = await hostCli(dir, (h) => (h === 'gh' ? ['pr', 'view', ...(ref ? [String(ref)] : []), '--json', GH_FIELDS] : ['mr', 'view', ...(ref ? [String(ref)] : []), '-F', 'json']));
  if (r.error === 'failed' && /no (pull requests|open merge requests?|merge request)|could not find|not found/i.test(r.message)) return { none: true };
  if (r.error) return r;
  try { const j = JSON.parse(r.out); return { pr: r.host === 'gh' ? normalizeGh(j) : normalizeGlab(j), host: r.host }; } catch { return { error: 'failed', message: 'Unexpected output from the CLI.' }; }
}

async function currentBranch(dir) { return (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim(); }

// Push the floor's branch. Floors made from a PR push to that PR's own branch.
async function push(dir, { remoteBranch } = {}) {
  const branch = await currentBranch(dir);
  if (!branch || branch === 'HEAD') return { ok: false, message: 'Not on a branch.' };
  const r = await git(dir, remoteBranch ? ['push', 'origin', `HEAD:${remoteBranch}`] : ['push', '-u', 'origin', branch]);
  return r.ok ? { ok: true } : { ok: false, message: r.err };
}

async function create(dir, { title, body, base, draft }) {
  const r = await hostCli(dir, (h) => (h === 'gh'
    ? ['pr', 'create', '--title', title, '--body', body || '', ...(base ? ['--base', base] : []), ...(draft ? ['--draft'] : [])]
    : ['mr', 'create', '--title', title, '--description', body || '', ...(base ? ['--target-branch', base] : []), ...(draft ? ['--draft'] : []), '--yes']));
  if (r.error) return r;
  const url = (r.out.match(/https?:\/\/\S+/) || [''])[0];
  return { ok: true, url };
}

async function merge(dir, method = 'squash') {
  const r = await hostCli(dir, (h) => (h === 'gh' ? ['pr', 'merge', `--${method}`] : ['mr', 'merge', ...(method === 'squash' ? ['--squash'] : method === 'rebase' ? ['--rebase'] : []), '--yes']));
  return r.error ? r : { ok: true, out: r.out };
}

// Make a worktree for an existing PR/MR: fetch its head into a local branch, then add the worktree.
async function fromPr(repo, ref, root) {
  const info = await status(repo, ref);
  if (info.error || info.none) return info.none ? { error: 'failed', message: `No pull request "${ref}" found.` } : info;
  const top = (await git(repo, ['rev-parse', '--show-toplevel'])).out.trim();
  if (!top) return { error: 'failed', message: 'Not a git repository.' };
  const { pr, host } = info;
  const branch = `orchestrai/pr-${pr.number}`;
  const refspec = host === 'gh' ? `pull/${pr.number}/head` : `merge-requests/${pr.number}/head`;
  const f = await git(top, ['fetch', 'origin', `+${refspec}:${branch}`]);
  if (!f.ok) return { error: 'failed', message: f.err };
  const dir = path.join(root, `${path.basename(top)}-pr-${pr.number}-${Date.now().toString(36)}`);
  fs.mkdirSync(root, { recursive: true });
  const w = await git(top, ['worktree', 'add', dir, branch]);
  if (!w.ok) return { error: 'failed', message: w.err };
  const files = (await git(top, ['diff', '--name-status', `${pr.base ? 'origin/' + pr.base : 'HEAD'}...${branch}`])).out.split('\n').filter(Boolean).map((l) => { const [s, ...r] = l.split('\t'); return { status: s[0], file: r[r.length - 1] }; });
  return { ok: true, dir, branch, repo: top, pr, files };
}

function register(ipcMain) {
  ipcMain.handle('pr:status', (_e, dir, ref) => status(dir, ref));
  ipcMain.handle('pr:push', (_e, dir, opts) => push(dir, opts || {}));
  ipcMain.handle('pr:create', (_e, dir, opts) => create(dir, opts || {}));
  ipcMain.handle('pr:merge', (_e, dir, method) => merge(dir, method));
  ipcMain.handle('pr:fromPr', (_e, repo, ref, root) => fromPr(repo, ref, root));
  ipcMain.handle('pr:open', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
  ipcMain.handle('pr:host', (_e, dir) => detect(dir));
}

module.exports = { register, status, push, create, merge, fromPr, detect, hostFromRemote, checksOf };
