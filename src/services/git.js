const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cwd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, out: stdout || '', err: (stderr || (err && err.message) || '').trim() })
    );
  });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'floor';

async function isRepo(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  const r = await run(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok;
}

function parseStatus(out) {
  const lines = out.split('\n').filter(Boolean);
  let branch = null, upstream = null, ahead = 0, behind = 0;
  const changes = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const m = line.slice(3).match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/);
      if (m) {
        branch = m[1].replace(/^No commits yet on /, '');
        upstream = m[2] || null;
        const a = (m[3] || '').match(/ahead (\d+)/), b = (m[3] || '').match(/behind (\d+)/);
        ahead = a ? +a[1] : 0;
        behind = b ? +b[1] : 0;
      }
      continue;
    }
    const x = line[0], y = line[1];
    let file = line.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ')[1];
    file = file.replace(/^"|"$/g, '');
    changes.push({ file, index: x, worktree: y, untracked: x === '?' });
  }
  return { branch, upstream, ahead, behind, changes };
}

const handlers = {
  isRepo: (cwd) => isRepo(cwd),

  async state(cwd) {
    if (!(await isRepo(cwd))) return { isRepo: false };
    const r = await run(cwd, ['status', '--porcelain=v1', '-b']);
    return r.ok ? { isRepo: true, ...parseStatus(r.out) } : { isRepo: true, error: r.err };
  },

  async diff(cwd, { file, staged, untracked }) {
    if (untracked) {
      const r = await run(cwd, ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file]);
      return r.out; // exit code 1 is expected for differing files
    }
    const r = await run(cwd, ['diff', ...(staged ? ['--cached'] : []), '--', file]);
    return r.out || r.err;
  },

  stage: (cwd, files) => run(cwd, ['add', '--', ...files]),
  unstage: (cwd, files) => run(cwd, ['restore', '--staged', '--', ...files]),
  discardFile: (cwd, { file, untracked }) =>
    untracked ? run(cwd, ['clean', '-f', '--', file]) : run(cwd, ['checkout', '--', file]),
  commit: (cwd, message) => run(cwd, ['commit', '-m', message]),

  async log(cwd, n = 30) {
    const r = await run(cwd, ['log', `-${n}`, '--pretty=format:%h%x1f%an%x1f%ar%x1f%s']);
    if (!r.ok) return [];
    return r.out.split('\n').filter(Boolean).map((l) => {
      const [hash, author, when, subject] = l.split('\x1f');
      return { hash, author, when, subject };
    });
  },

  async branches(cwd) {
    const r = await run(cwd, ['branch', '--format=%(refname:short)%x1f%(HEAD)']);
    if (!r.ok) return [];
    return r.out.split('\n').filter(Boolean).map((l) => {
      const [name, head] = l.split('\x1f');
      return { name, current: head === '*' };
    });
  },
  checkout: (cwd, branch) => run(cwd, ['checkout', branch]),
  createBranch: (cwd, branch) => run(cwd, ['checkout', '-b', branch]),

  async stashes(cwd) {
    const r = await run(cwd, ['stash', 'list']);
    return r.out.split('\n').filter(Boolean);
  },
  stashPush: (cwd, msg) => run(cwd, ['stash', 'push', '-u', ...(msg ? ['-m', msg] : [])]),
  stashPop: (cwd) => run(cwd, ['stash', 'pop']),

  // --- floors: isolated worktrees ---
  async worktreeAdd(repo, { name, root }) {
    const top = (await run(repo, ['rev-parse', '--show-toplevel'])).out.trim();
    if (!top) return { ok: false, err: 'Not a git repository' };
    const s = slug(name);
    const branch = `orchestrai/${s}-${Date.now().toString(36)}`;
    const dir = path.join(root, `${path.basename(top)}-${s}-${Date.now().toString(36)}`);
    fs.mkdirSync(root, { recursive: true });
    const r = await run(top, ['worktree', 'add', '-b', branch, dir]);
    return r.ok ? { ok: true, dir, branch, repo: top } : { ok: false, err: r.err };
  },

  async landPreflight({ repo, dir, branch }) {
    const wt = await run(dir, ['status', '--porcelain']);
    const main = await run(repo, ['status', '--porcelain']);
    const head = (await run(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
    const ahead = (await run(repo, ['rev-list', '--count', `HEAD..${branch}`])).out.trim();
    const stat = (await run(repo, ['diff', '--stat', `HEAD...${branch}`])).out;
    return {
      target: head,
      commitsAhead: +ahead || 0,
      worktreeDirty: wt.out.trim().length > 0,
      targetDirty: main.out.trim().length > 0,
      stat,
    };
  },

  // Files the branch would bring in, including uncommitted work in the floor.
  async landFiles({ repo, dir, branch }) {
    const committed = await run(repo, ['diff', '--name-status', `HEAD...${branch}`]);
    const files = new Map();
    for (const l of committed.out.split('\n').filter(Boolean)) {
      const [status, ...rest] = l.split('\t');
      files.set(rest[rest.length - 1], { file: rest[rest.length - 1], status: status[0], committed: true });
    }
    const pending = await run(dir, ['status', '--porcelain=v1']);
    for (const l of pending.out.split('\n').filter(Boolean)) {
      const file = l.slice(3).replace(/^"|"$/g, '');
      if (!files.has(file)) files.set(file, { file, status: l[0] === '?' ? 'U' : 'M', committed: false });
    }
    return [...files.values()];
  },

  async landFileDiff({ repo, dir, branch, file, committed }) {
    if (committed) return (await run(repo, ['diff', `HEAD...${branch}`, '--', file])).out;
    return handlers.diff(dir, { file, staged: false, untracked: (await run(dir, ['ls-files', '--', file])).out.trim() === '' });
  },

  async land({ repo, dir, branch, message, commitFirst }) {
    if (commitFirst) {
      const st = await run(dir, ['status', '--porcelain']);
      if (st.out.trim()) {
        await run(dir, ['add', '-A']);
        const c = await run(dir, ['commit', '-m', message || 'OrchestrAI floor changes']);
        if (!c.ok) return { ok: false, err: c.err };
      }
    }
    const m = await run(repo, ['merge', '--no-ff', '-m', message || `Land ${branch}`, branch]);
    if (!m.ok) {
      await run(repo, ['merge', '--abort']);
      return { ok: false, err: m.err || m.out };
    }
    await run(repo, ['worktree', 'remove', '--force', dir]);
    await run(repo, ['branch', '-d', branch]);
    return { ok: true };
  },

  // Merge in a throwaway detached worktree so the base checkout is never touched.
  async landDryRun({ repo, branch }) {
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrai-dry-'));
    const dir = path.join(tmp, 'wt');
    try {
      const add = await run(repo, ['worktree', 'add', '--detach', dir, 'HEAD']);
      if (!add.ok) return { ok: false, err: add.err };
      const m = await run(dir, ['-c', 'user.name=OrchestrAI', '-c', 'user.email=orchestrai@localhost', 'merge', '--no-commit', '--no-ff', branch]);
      const lines = (r) => r.out.split(/\r?\n/).filter(Boolean);
      const conflicts = lines(await run(dir, ['diff', '--name-only', '--diff-filter=U']));
      const changed = lines(await run(dir, ['diff', '--cached', '--name-only']));
      await run(dir, ['merge', '--abort']);
      return { ok: true, clean: m.ok && !conflicts.length, conflicts, changed, message: m.ok ? '' : (m.out || m.err) };
    } finally {
      await run(repo, ['worktree', 'remove', '--force', dir]);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  },

  async discardWorktree({ repo, dir, branch }) {
    await run(repo, ['worktree', 'remove', '--force', dir]);
    await run(repo, ['branch', '-D', branch]);
    return { ok: true };
  },
};

function register(ipcMain) {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`git:${name}`, (_e, ...args) => fn(...args));
  }
}

module.exports = { register };
