// Pull requests for floors, through the host CLI (gh / glab): status badge on the floor tab, push, create, merge,
// and "new floor from a pull request". The app stores no credentials; sign-in is the CLI's own.

const prInfo = new Map(); // floor id -> last status result
let prRefreshAt = 0;

function prBadge(f) {
  const s = prInfo.get(f.id);
  if (!s?.pr) return null;
  const { pr } = s;
  const cls = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : pr.checks.state;
  return h('span', { class: 'pr-badge ' + cls, title: `#${pr.number} ${pr.title}\n${pr.state}${pr.checks.total ? ` · checks ${pr.checks.state}` : ''}${pr.review ? ` · review ${pr.review}` : ''}`, onclick: (e) => { e.stopPropagation(); prDialog(f); } },
    pr.state === 'merged' ? 'merged' : `#${pr.number}`);
}

async function refreshPrBadges(force) {
  if (!force && Date.now() - prRefreshAt < 20000) return;
  prRefreshAt = Date.now();
  let changed = false;
  for (const f of allFloors()) {
    if (!f.repo || !f.dir) continue;
    const r = await call('pr:status', f.dir);
    const prev = JSON.stringify(prInfo.get(f.id)?.pr || null);
    if (r.pr) prInfo.set(f.id, r); else prInfo.delete(f.id);
    if (JSON.stringify(r.pr || null) !== prev) changed = true;
  }
  if (changed) renderTabs();
}
addEventListener('focus', () => refreshPrBadges());
setTimeout(() => refreshPrBadges(true), 4000);

const CHECK_TEXT = { pass: 'Checks passed', fail: 'Checks failing', pending: 'Checks running', none: 'No checks' };

async function prDialog(f) {
  if (!f.dir) return alertModal('Pull request', 'This floor has no working directory.');
  const r = await call('pr:status', f.dir);
  const reopen = () => { closeModal(); refreshPrBadges(true).then(() => prDialog(f)); };
  const note = h('div', { class: 'err' });
  if (r.error) {
    return modal({ title: 'Pull request', content: h('div', {}, r.message), actions: [{ label: 'Close', primary: true, onClick: (c) => c() }] });
  }
  const doPush = async () => {
    note.className = 'muted'; note.textContent = 'Pushing…';
    const p = await call('pr:push', f.dir, { remoteBranch: f.prHead });
    note.className = p.ok ? 'muted' : 'err'; note.textContent = p.ok ? 'Pushed.' : p.message;
    return p.ok;
  };

  if (r.none) {
    const title = h('input', { placeholder: 'Title', value: f.name });
    const body = h('textarea', { rows: 5, placeholder: 'Description (optional)' });
    const draft = h('input', { type: 'checkbox' });
    return modal({
      title: `Pull request · ${f.name}`,
      content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:480px' },
        h('div', { class: 'muted' }, 'No pull request for this branch yet. Pushing publishes the branch to origin.'),
        h('label', {}, 'Title', title), h('label', {}, 'Description', body), h('label', { class: 'check' }, draft, 'Draft'), note),
      actions: [
        { label: 'Close', onClick: (c) => c() },
        { label: 'Push only', onClick: doPush },
        {
          label: 'Push & open PR', primary: true, onClick: async () => {
            if (!title.value.trim()) { note.textContent = 'Give the pull request a title.'; return; }
            if (!(await doPush())) return;
            const c = await call('pr:create', f.dir, { title: title.value.trim(), body: body.value, draft: draft.checked });
            if (c.error) { note.className = 'err'; note.textContent = c.message; return; }
            if (c.url) call('pr:open', c.url);
            reopen();
          },
        },
      ],
    });
  }

  const { pr } = r;
  const method = h('select', {}, ...[['squash', 'Squash and merge'], ['merge', 'Create a merge commit'], ['rebase', 'Rebase and merge']].map(([v, l]) => h('option', { value: v }, l)));
  const open = pr.state === 'open';
  modal({
    title: `#${pr.number} · ${pr.title}`,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:480px' },
      h('div', { class: 'muted' }, `${pr.head} → ${pr.base} · ${pr.state}${pr.draft ? ' (draft)' : ''}`),
      h('div', {}, h('span', { class: 'pr-badge ' + pr.checks.state }, CHECK_TEXT[pr.checks.state]), pr.checks.failed ? ` (${pr.checks.failed} of ${pr.checks.total} failing)` : pr.checks.total ? ` (${pr.checks.total})` : ''),
      pr.review ? h('div', { class: 'muted' }, `Review: ${pr.review.replace(/_/g, ' ')}`) : null,
      pr.mergeable === 'conflicting' ? h('div', { class: 'err' }, 'Merge conflicts with the base branch.') : null,
      open ? h('label', {}, 'Merge method', method) : null, note),
    actions: [
      { label: 'Close', onClick: (c) => c() },
      { label: 'Refresh', onClick: () => reopen() },
      { label: 'Push branch', onClick: doPush },
      { label: 'Open in browser', onClick: () => call('pr:open', pr.url) },
      ...(open ? [{
        label: 'Merge', primary: true, onClick: async () => {
          if (pr.checks.state === 'fail' && !(await confirmModal('Checks are failing', 'Merge anyway?', 'Merge'))) return;
          note.className = 'muted'; note.textContent = 'Merging…';
          const m = await call('pr:merge', f.dir, method.value);
          if (m.error) { note.className = 'err'; note.textContent = m.message; return; }
          closeModal();
          await refreshPrBadges(true);
          if (f.repo && await confirmModal('Merged', `Remove the floor "${f.name}" and its branch now?`, 'Remove floor')) {
            await removeFloor(f);
            await call('git:discardWorktree', { repo: f.repo, dir: f.dir, branch: f.branch });
          }
        },
      }] : []),
    ],
  });
}

// New floor from an existing PR/MR (number or URL) of the repository in `dir`.
async function floorFromPrDialog() {
  const cur = activeFloor();
  const dir = h('input', { placeholder: 'Repository folder', value: cur?.repo || cur?.dir || '' });
  const ref = h('input', { placeholder: 'Pull request number or URL' });
  const msg = h('div', { class: 'err' });
  const browse = h('button', { onclick: async () => { const d = await call('files:pickDirectory'); if (d) dir.value = d; } }, 'Browse');
  modal({
    title: 'New floor from a pull request',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:460px' },
      h('label', {}, 'Repository', h('div', { class: 'row' }, dir, browse)), h('label', {}, 'Pull request', ref), msg),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Create floor', primary: true, onClick: async () => {
          if (!dir.value.trim() || !ref.value.trim()) { msg.textContent = 'Fill in both fields.'; return; }
          msg.className = 'muted'; msg.textContent = 'Fetching the pull request…';
          const root = await call('app:worktreeRoot');
          const r = await call('pr:fromPr', dir.value.trim(), ref.value.trim(), root);
          if (r.error) { msg.className = 'err'; msg.textContent = r.message; return; }
          closeModal();
          const f = newFloor({ name: `PR #${r.pr.number}`, dir: r.dir, repo: r.repo, branch: r.branch, hooks: { setup: '', beforeLand: '' } });
          f.prHead = r.pr.head;
          state.floors.push(f);
          mountFloor(f);
          switchFloor(f.id);
          addNode('terminal');
          addNode('files', { title: 'PR files' });
          prInfo.set(f.id, { pr: r.pr });
          renderTabs();
        },
      },
    ],
  });
}

registerCommand({ id: 'floor-from-pr', label: 'New floor from a pull request…', run: floorFromPrDialog });
registerCommand({ id: 'floor-pr', label: 'Pull request for this floor…', run: () => prDialog(activeFloor()) });
