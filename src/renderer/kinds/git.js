// Source control panel for the floor's directory.
NodeKinds.git = {
  label: 'Git', w: 560, h: 460,
  mount({ node, body, cwd, floor, addButton }) {
    const dir = () => cwd();
    let st = null, sel = null, tab = 'changes', commitSel = null, op = null;

    const branchSel = h('select', {});
    const info = h('span', { class: 'muted' });
    const banner = h('div', { class: 'git-banner', style: 'display:none' });
    const list = h('div', { class: 'scroll', style: 'flex:none;max-height:38%' });
    const diffEl = h('div', { class: 'scroll mono' });
    const msg = h('input', { placeholder: 'Commit message' });
    const commitBtn = h('button', { class: 'primary', onclick: doCommit }, 'Commit');
    const tabs = h('div', { class: 'row' });
    const sync = h('div', { class: 'row' });

    body.append(
      h('div', { class: 'row' }, branchSel,
        h('button', { title: 'New branch', onclick: newBranch }, '+'),
        h('button', { title: 'Merge a branch into this one', onclick: mergeDialog }, 'Merge…'),
        h('button', { title: 'Refresh', onclick: refresh }, '⟳'), info),
      sync, banner, tabs, list, diffEl,
      h('div', { class: 'row' }, msg, commitBtn));

    addButton('⌨', 'Open the repository folder in your IDE', () => openInIde(dir(), { floor }));

    const run = async (p) => {
      const r = await p;
      if (r && r.ok === false) alertModal('Git error', r.err || 'Command failed');
      await refresh();
    };

    // fetch / pull / push run with a visible progress line and can be cancelled.
    async function network(kind) {
      if (op) return;
      op = { id: uid(), kind };
      renderSync();
      const r = await call('git:' + kind, dir(), { opId: op.id });
      op = null;
      renderSync();
      if (!r.ok && !r.cancelled) alertModal(`git ${kind} failed`, r.err || 'Command failed');
      await refresh();
    }

    function renderSync() {
      if (op) {
        sync.replaceChildren(h('span', { class: 'spinner' }), h('span', { class: 'muted' }, op.kind === 'fetch' ? 'Fetching…' : op.kind === 'pull' ? 'Pulling…' : 'Pushing…'),
          h('button', { onclick: () => call('git:cancel', op.id) }, 'Cancel'));
        return;
      }
      sync.replaceChildren(
        h('button', { title: 'Fetch all remotes', onclick: () => network('fetch') }, 'Fetch'),
        h('button', { title: 'Pull (merge) from the upstream branch', onclick: () => network('pull') }, st?.behind ? `Pull ↓${st.behind}` : 'Pull'),
        h('button', { title: 'Push to the upstream branch', onclick: () => network('push') }, st?.ahead ? `Push ↑${st.ahead}` : 'Push'));
    }

    function renderTabs() {
      tabs.replaceChildren(...['changes', 'history', 'stashes'].map((t) =>
        h('button', { class: tab === t ? 'active' : '', onclick: () => { tab = t; sel = null; commitSel = null; refresh(); } }, t)));
    }

    async function renderBanner() {
      const [lock, ms] = await Promise.all([call('git:lockInfo', dir()), call('git:mergeState', dir())]);
      const parts = [];
      if (ms.merging) {
        parts.push(h('div', { class: 'row' },
          h('span', {}, ms.conflicts.length ? `Merge in progress: ${ms.conflicts.length} conflicted file(s). Resolve, stage and commit, or abort.` : 'Merge in progress. Commit to finish, or abort.'),
          h('button', { onclick: async () => { if (await confirmModal('Abort merge', 'Discard the merge in progress?', 'Abort')) run(call('git:mergeAbort', dir())); } }, 'Abort merge')));
      }
      if (lock.locked) {
        parts.push(h('div', { class: 'row' },
          h('span', {}, `A stale index.lock exists (${Math.round(lock.ageMs / 1000)}s old). Git commands will fail until it is removed.`),
          h('button', {
            onclick: async () => {
              if (await confirmModal('Remove index.lock', 'Only remove it if no other git process is running in this repository.', 'Remove')) run(call('git:removeLock', dir()));
            },
          }, 'Remove lock')));
      }
      banner.style.display = parts.length ? '' : 'none';
      banner.replaceChildren(...parts);
      return ms;
    }

    async function refresh() {
      renderTabs();
      if (!dir()) { list.replaceChildren(h('div', { class: 'muted' }, 'This floor has no directory.')); return; }
      st = await call('git:state', dir());
      if (!st.isRepo) { list.replaceChildren(h('div', { class: 'muted' }, 'Not a git repository.')); branchSel.replaceChildren(); banner.style.display = 'none'; return; }
      renderSync();
      const merge = await renderBanner();
      const bs = await call('git:branches', dir());
      branchSel.replaceChildren(...bs.map((b) => h('option', { value: b.name, selected: b.current }, b.name)));
      branchSel.onchange = () => run(call('git:checkout', dir(), branchSel.value));
      info.textContent = [st.upstream ? `↑${st.ahead} ↓${st.behind}` : 'no upstream', `${st.changes.length} change${st.changes.length === 1 ? '' : 's'}`].join(' · ');
      commitBtn.disabled = !st.changes.some((c) => c.index !== ' ' && !c.untracked) && !merge.merging;

      if (tab === 'changes') {
        list.replaceChildren(...st.changes.map((c) => changeRow(c, merge.conflicts.includes(c.file))));
        if (!st.changes.length) list.append(h('div', { class: 'muted' }, 'Working tree clean.'));
        if (sel && st.changes.find((c) => c.file === sel.file)) showDiff(sel); else diffEl.replaceChildren();
      } else if (tab === 'history') {
        const log = await call('git:log', dir(), 40);
        list.replaceChildren(...log.map((c) => h('div', {
          class: 'commit-row' + (commitSel === c.hash ? ' sel' : ''), onclick: () => { commitSel = c.hash; showCommit(c.hash); renderHistoryHighlight(); },
        }, h('span', { class: 'h' }, c.hash), h('span', {}, c.subject), h('span', { class: 'muted', style: 'margin-left:auto' }, c.when))));
        if (!commitSel) diffEl.replaceChildren();
      } else {
        const stashes = await call('git:stashes', dir());
        list.replaceChildren(
          h('div', { class: 'row' },
            h('button', { onclick: () => run(call('git:stashPush', dir(), '')) }, 'Stash changes'),
            h('button', { disabled: !stashes.length, onclick: () => run(call('git:stashPop', dir())) }, 'Pop latest')),
          ...stashes.map((s, i) => h('div', { class: 'commit-row mono' }, h('span', {}, s),
            h('button', { style: 'margin-left:auto', title: 'Apply, keeping the stash', onclick: () => run(call('git:stashApply', dir(), i)) }, 'Apply'),
            h('button', { title: 'Delete this stash', onclick: async () => { if (await confirmModal('Drop stash', `Delete ${s}?`, 'Drop')) run(call('git:stashDrop', dir(), i)); } }, 'Drop'))));
        diffEl.replaceChildren();
      }
    }

    function renderHistoryHighlight() {
      list.querySelectorAll('.commit-row').forEach((r) => r.classList.toggle('sel', r.querySelector('.h')?.textContent === commitSel));
    }

    function colorDiff(text) {
      return String(text || '(no diff)').split('\n').map((l) =>
        h('div', { class: l.startsWith('+') && !l.startsWith('+++') ? 'diff-add' : l.startsWith('-') && !l.startsWith('---') ? 'diff-del' : l.startsWith('@@') ? 'diff-hunk' : '' }, l || ' '));
    }

    // Full commit message plus a per-file diff, loaded when a file is clicked.
    async function showCommit(hash) {
      const d = await call('git:commitDetails', dir(), hash);
      if (!d.ok) { diffEl.replaceChildren(h('div', { class: 'err' }, d.err)); return; }
      const fileDiff = h('div', { class: 'commit-file-diff' });
      diffEl.replaceChildren(
        h('div', { class: 'commit-subject' }, d.subject),
        d.body ? h('div', { class: 'commit-body' }, d.body) : null,
        h('div', { class: 'muted' }, `${d.author} <${d.email}> · ${new Date(d.date).toLocaleString()} · ${d.hash.slice(0, 10)}`),
        ...d.files.map((f) => h('div', {
          class: 'change', onclick: async () => fileDiff.replaceChildren(...colorDiff(await call('git:commitFileDiff', dir(), { hash, file: f.file }))),
        }, h('span', { class: 'st' }, f.status), h('span', {}, f.file))),
        fileDiff);
    }

    function changeRow(c, conflicted) {
      const staged = c.index !== ' ' && !c.untracked;
      const unstaged = c.worktree !== ' ' || c.untracked;
      const row = h('div', { class: 'change' + (sel?.file === c.file ? ' sel' : '') + (conflicted ? ' conflicted' : '') },
        h('input', { type: 'checkbox', checked: staged, title: staged ? 'Unstage' : 'Stage', onclick: (e) => { e.stopPropagation(); run(call(staged ? 'git:unstage' : 'git:stage', dir(), [c.file])); } }),
        h('span', { class: 'st' }, c.untracked ? 'U' : `${c.index}${c.worktree}`.trim()),
        h('span', {}, c.file),
        conflicted ? h('button', { style: 'margin-left:auto', title: 'Open the conflicted file in your IDE', onclick: (e) => { e.stopPropagation(); openInIde(dir().replace(/[\\/]$/, '') + '/' + c.file, { floor }); } }, 'Open') : null,
        h('button', {
          style: conflicted ? '' : 'margin-left:auto', title: 'Discard changes',
          onclick: async (e) => {
            e.stopPropagation();
            if (await confirmModal('Discard changes', `Discard changes to ${c.file}? This cannot be undone.`, 'Discard')) run(call('git:discardFile', dir(), { file: c.file, untracked: c.untracked }));
          },
        }, '↺'));
      row.addEventListener('click', () => { sel = { file: c.file, staged: staged && !unstaged, untracked: c.untracked }; refresh(); });
      return row;
    }

    async function showDiff(s) {
      diffEl.replaceChildren(...colorDiff(await call('git:diff', dir(), s)));
    }

    async function doCommit() {
      const merging = (await call('git:mergeState', dir())).merging;
      if (!msg.value.trim() && !merging) return alertModal('Commit', 'Enter a commit message.');
      const r = merging && !msg.value.trim() ? await call('git:commitMerge', dir()) : await call('git:commit', dir(), msg.value.trim());
      if (r.ok) msg.value = '';
      await run(Promise.resolve(r));
    }

    function newBranch() {
      const input = h('input', { placeholder: 'branch-name' });
      modal({
        title: 'New branch', content: input,
        actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Create', primary: true, onClick: (c) => { if (input.value.trim()) { c(); run(call('git:createBranch', dir(), input.value.trim())); } } }],
      });
    }

    // Pick a branch, preview the result in a temporary worktree (conflicts are listed before anything changes), then merge.
    async function mergeDialog() {
      const bs = (await call('git:branches', dir())).filter((b) => !b.current);
      if (!bs.length) return alertModal('Merge', 'There is no other branch to merge.');
      const pick = h('select', {}, bs.map((b) => h('option', { value: b.name }, b.name)));
      const result = h('div', { class: 'mono scroll', style: 'max-height:200px' });
      let previewed = null;
      const preview = async () => {
        result.replaceChildren(h('span', { class: 'spinner' }));
        const r = await call('git:mergePreview', dir(), pick.value);
        previewed = r.ok ? pick.value : null;
        result.replaceChildren(!r.ok ? h('div', { class: 'err' }, r.err)
          : r.clean ? h('div', {}, `Clean merge. ${r.changed.length} file(s) would change:`, h('div', { class: 'muted' }, r.changed.join('\n')))
            : h('div', {}, h('div', { class: 'err' }, `${r.conflicts.length} conflicting file(s):`), h('div', {}, r.conflicts.join('\n') || r.message)));
      };
      pick.addEventListener('change', () => { previewed = null; result.replaceChildren(); });
      modal({
        title: `Merge into ${st?.branch || 'current branch'}`,
        content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('label', {}, 'Branch to merge', pick), h('button', { onclick: preview }, 'Preview'), result),
        actions: [
          { label: 'Cancel', onClick: (c) => c() },
          {
            label: 'Merge', primary: true, onClick: async (c) => {
              if (previewed !== pick.value) { await preview(); return; }
              c();
              const r = await call('git:merge', dir(), pick.value);
              if (!r.ok && !r.conflicts.length) alertModal('Merge failed', r.err);
              tab = 'changes';
              await refresh();
            },
          },
        ],
      });
    }

    // Refresh whenever files change on disk; a light poll covers terminal-driven commits.
    const poll = setInterval(() => { if (body.offsetWidth && !op) refresh(); }, 4000);
    refresh();
    return () => clearInterval(poll);
  },
};
