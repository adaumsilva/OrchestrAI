// Storage dialog: where the data lives, how big each part is, backups, moving the folder, clearing portal data, deleting everything.

const storageBytes = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');

async function storageDialog() {
  const [info, backups] = await Promise.all([call('storage:info'), call('data:backups')]);
  const max = Math.max(1, ...info.rows.map((r) => r.bytes));
  const rows = info.rows.map((r) => h('div', { class: 'usage-row' },
    h('span', { class: 'usage-label' }, r.label),
    h('span', { class: 'usage-bar' }, h('span', { style: `width:${Math.max(r.bytes ? 2 : 0, Math.round((r.bytes / max) * 100))}%` })),
    h('span', { class: 'usage-size mono' }, storageBytes(r.bytes))));
  const backupRows = backups.length ? backups.map((b) => h('div', { class: 'change' },
    h('span', {}, new Date(b.mtime).toLocaleString()), h('span', { class: 'muted', style: 'margin-left:auto' }, storageBytes(b.size)),
    h('button', {
      title: 'Delete this backup', onclick: async () => {
        if (!(await confirmModal('Delete backup', `Delete the backup from ${new Date(b.mtime).toLocaleString()}?`, 'Delete'))) { storageDialog(); return; }
        await call('data:deleteBackup', b.name);
        storageDialog();
      },
    }, '🗑'))) : [h('div', { class: 'muted' }, 'No backups.')];
  modal({
    title: 'Storage',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:520px;max-height:68vh;overflow:auto' },
      h('div', {}, h('div', { class: 'muted' }, info.custom ? 'Data folder (moved from the default)' : 'Data folder'), h('div', { class: 'mono ellipsis', title: info.path }, info.path)),
      h('div', { class: 'row' },
        h('button', { onclick: () => call('storage:reveal') }, 'Show in file manager'),
        h('button', { onclick: () => { closeModal(); moveStorageDialog(info); } }, 'Move…'),
        info.custom ? h('button', { onclick: () => { closeModal(); moveStorage(info.defaultPath); } }, 'Back to default') : null),
      h('div', { class: 'muted' }, `Usage · ${storageBytes(info.total)} in total`),
      h('div', { class: 'usage-list' }, rows),
      h('div', { class: 'muted' }, 'Backups'),
      h('div', { class: 'scroll bordered', style: 'max-height:130px' }, backupRows),
      h('div', { class: 'muted' }, 'Clean up'),
      h('div', { class: 'row' },
        h('button', {
          title: 'Sign out of every site in every portal', onclick: async () => {
            if (!(await confirmModal('Clear portal data', 'Sign out of all sites and delete cookies and site data of every portal?', 'Clear'))) { storageDialog(); return; }
            await call('storage:clearPortal');
            storageDialog();
          },
        }, 'Clear portal data'),
        h('button', { class: 'danger', onclick: () => { closeModal(); deleteAllDialog(); } }, 'Delete all data…'))),
    actions: [{ label: 'Close', primary: true, onClick: (c) => c() }],
  });
}

function moveStorageDialog(info) {
  const input = h('input', { placeholder: 'An empty folder, for example D:\\OrchestrAI-data' });
  modal({
    title: 'Move data folder',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:460px' },
      h('div', { class: 'muted' }, 'Everything is copied to the new folder and OrchestrAI restarts there. The old folder is kept so you can check the result; delete it yourself afterwards.'),
      h('div', { class: 'row' }, input, h('button', { onclick: async () => { const d = await call('files:pickDirectory'); if (d) input.value = d; } }, 'Browse'))),
    actions: [{ label: 'Cancel', onClick: (c) => { c(); storageDialog(); } }, { label: 'Move and restart', primary: true, onClick: (c) => { if (input.value.trim()) { c(); moveStorage(input.value.trim()); } } }],
  });
}

async function moveStorage(dir) {
  await call('workspace:save', state); // make sure the copy includes the latest state
  const r = await call('storage:move', { dir });
  if (!r.ok) { alertModal('Could not move the data', r.error); return; }
  modal({
    title: 'Moved',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, 'Restarting in the new location. The old folder is still at:', h('div', { class: 'mono' }, r.from),
      r.signInsMayBeLost ? h('div', { class: 'err' }, 'Some portal sign-in files were in use and could not be copied; you may need to sign in to a few sites again.') : null),
    actions: [],
  });
}

function deleteAllDialog() {
  const input = h('input', { placeholder: 'Type DELETE' });
  modal({
    title: 'Delete all data',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:440px' },
      h('div', { class: 'err' }, 'This permanently deletes your workspaces, backups, routines, templates, accounts and their stored keys, floor worktrees (including uncommitted work in them), note images and all portal sign-ins. Your own project folders are not touched.'),
      h('div', { class: 'muted' }, 'OrchestrAI restarts with an empty workspace.'), input),
    actions: [{ label: 'Cancel', onClick: (c) => { c(); storageDialog(); } }, {
      label: 'Delete everything', primary: true, onClick: async (c) => {
        if (input.value !== 'DELETE') { input.focus(); return; }
        const r = await call('storage:deleteAll', { confirm: 'DELETE' });
        if (!r.ok) { alertModal('Could not delete', r.error); return; }
        c();
      },
    }],
  });
}

registerCommand({ id: 'storage', label: 'Storage: location, usage, backups…', run: () => storageDialog() });
