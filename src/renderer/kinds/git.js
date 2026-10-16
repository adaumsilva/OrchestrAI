// Source control panel for the floor's directory.
NodeKinds.git = {
  label: 'Git', w: 560, h: 460,
  mount({ node, body, cwd }) {
    const dir = () => cwd();
    let st = null, sel = null, tab = 'changes';

    const branchSel = h('select', {});
    const info = h('span', { class: 'muted' });
    const list = h('div', { class: 'scroll', style: 'flex:none;max-height:38%' });
    const diffEl = h('div', { class: 'scroll mono' });
    const msg = h('input', { placeholder: 'Commit message' });
    const commitBtn = h('button', { class: 'primary', onclick: doCommit }, 'Commit');
    const tabs = h('div', { class: 'row' });

    body.append(
      h('div', { class: 'row' }, branchSel,
        h('button', { title: 'New branch', onclick: newBranch }, '+'),
        h('button', { title: 'Refresh', onclick: refresh }, '⟳'), info),
      tabs, list, diffEl,
      h('div', { class: 'row' }, msg, commitBtn));

    const run = async (p) => {
      const r = await p;
      if (r && r.ok === false) alertModal('Git error', r.err || 'Command failed');
      await refresh();
    };

    function renderTabs() {
      tabs.replaceChildren(...['changes', 'history', 'stashes'].map((t) =>
        h('button', { class: tab === t ? 'active' : '', onclick: () => { tab = t; sel = null; refresh(); } }, t)));
    }

    async function refresh() {
      renderTabs();
      if (!dir()) { list.replaceChildren(h('div', { class: 'muted' }, 'This floor has no directory.')); return; }
      st = await call('git:state', dir());
      if (!st.isRepo) { list.replaceChildren(h('div', { class: 'muted' }, 'Not a git repository.')); branchSel.replaceChildren(); return; }
      const bs = await call('git:branches', dir());
      branchSel.replaceChildren(...bs.map((b) => h('option', { value: b.name, selected: b.current }, b.name)));
      branchSel.onchange = () => run(call('git:checkout', dir(), branchSel.value));
      info.textContent = [st.upstream ? `↑${st.ahead} ↓${st.behind}` : 'no upstream', `${st.changes.length} change${st.changes.length === 1 ? '' : 's'}`].join(' · ');
      commitBtn.disabled = !st.changes.some((c) => c.index !== ' ' && !c.untracked);

      if (tab === 'changes') {
        list.replaceChildren(...st.changes.map(changeRow));
        if (!st.changes.length) list.append(h('div', { class: 'muted' }, 'Working tree clean.'));
        if (sel && st.changes.find((c) => c.file === sel.file)) showDiff(sel); else diffEl.replaceChildren();
      } else if (tab === 'history') {
        const log = await call('git:log', dir(), 40);
        list.replaceChildren(...log.map((c) => h('div', { class: 'commit-row' }, h('span', { class: 'h' }, c.hash), h('span', {}, c.subject), h('span', { class: 'muted', style: 'margin-left:auto' }, c.when))));
        diffEl.replaceChildren();
      } else {
        const stashes = await call('git:stashes', dir());
        list.replaceChildren(
          h('div', { class: 'row' },
            h('button', { onclick: () => run(call('git:stashPush', dir(), '')) }, 'Stash changes'),
            h('button', { disabled: !stashes.length, onclick: () => run(call('git:stashPop', dir())) }, 'Pop latest')),
          ...stashes.map((s) => h('div', { class: 'commit-row mono' }, s)));
        diffEl.replaceChildren();
      }
    }

    function changeRow(c) {
      const staged = c.index !== ' ' && !c.untracked;
      const unstaged = c.worktree !== ' ' || c.untracked;
      const row = h('div', { class: 'change' + (sel?.file === c.file ? ' sel' : '') },
        h('input', { type: 'checkbox', checked: staged, title: staged ? 'Unstage' : 'Stage', onclick: (e) => { e.stopPropagation(); run(call(staged ? 'git:unstage' : 'git:stage', dir(), [c.file])); } }),
        h('span', { class: 'st' }, c.untracked ? 'U' : `${c.index}${c.worktree}`.trim()),
        h('span', {}, c.file),
        h('button', {
          style: 'margin-left:auto', title: 'Discard changes',
          onclick: async (e) => {
            e.stopPropagation();
            if (await confirmModal('Discard changes', `Discard changes to ${c.file}? This cannot be undone.`, 'Discard')) run(call('git:discardFile', dir(), { file: c.file, untracked: c.untracked }));
          },
        }, '↺'));
      row.addEventListener('click', () => { sel = { file: c.file, staged: staged && !unstaged, untracked: c.untracked }; refresh(); });
      return row;
    }

    async function showDiff(s) {
      const text = await call('git:diff', dir(), s);
      diffEl.replaceChildren(...String(text || '(no diff)').split('\n').map((l) =>
        h('div', { class: l.startsWith('+') && !l.startsWith('+++') ? 'diff-add' : l.startsWith('-') && !l.startsWith('---') ? 'diff-del' : l.startsWith('@@') ? 'diff-hunk' : '' }, l || ' ')));
    }

    async function doCommit() {
      if (!msg.value.trim()) return alertModal('Commit', 'Enter a commit message.');
      const r = await call('git:commit', dir(), msg.value.trim());
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

    // Refresh whenever files change on disk; a light poll covers terminal-driven commits.
    const poll = setInterval(() => { if (body.offsetWidth) refresh(); }, 4000);
    refresh();
    return () => clearInterval(poll);
  },
};
