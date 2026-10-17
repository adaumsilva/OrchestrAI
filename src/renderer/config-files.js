// Config files sheet: CLAUDE.md and AGENTS.md of a floor's directory, with sync.
const CONFIG_NAMES = ['CLAUDE.md', 'AGENTS.md'];
const SYNC_TEXT = { inSync: 'In sync', different: 'Different', onlyOne: 'Only one exists', none: 'Neither exists' };

async function configDialog(f = activeFloor()) {
  if (!f.dir) return alertModal('Config files', 'This floor has no working directory. Set one in the floor options first.');
  const st = await call('config:status', f.dir);
  if (st.error) return alertModal('Config files', st.error);
  const seen = Object.fromEntries(CONFIG_NAMES.map((n) => [n, st.files[n].exists ? st.files[n].mtime : null]));
  const reopen = () => { closeModal(); configDialog(f); };

  const card = (name) => {
    const s = st.files[name];
    return h('div', { class: 'cfg-card' },
      h('div', { class: 'routine-main' },
        h('b', {}, name),
        h('div', { class: 'muted' }, s.exists ? `${s.chars.toLocaleString()} characters · modified ${new Date(s.mtime).toLocaleString()}` : 'Does not exist')),
      s.exists ? h('button', { onclick: () => { closeModal(); editConfig(f, name); } }, 'Edit') : h('button', { class: 'primary', onclick: () => createConfig(f, name, reopen) }, 'Create'),
      s.exists ? h('button', { class: 'danger', onclick: async () => {
        if (!(await confirmModal('Delete', `Move ${name} to the trash?`, 'Move to trash'))) return reopen();
        const r = await call('config:trash', f.dir, name);
        if (!r.ok) alertModal('Could not delete', r.error); else reopen();
      } }, 'Delete') : null);
  };

  const body = [card('CLAUDE.md'), card('AGENTS.md'), h('div', { class: 'cfg-sync ' + st.sync }, h('span', { class: 'cfg-dot' }), SYNC_TEXT[st.sync])];
  const actions = [{ label: 'Close', primary: true, onClick: (c) => c() }];
  if (st.sync === 'different' || st.sync === 'onlyOne') {
    actions.unshift({
      label: 'Sync…', onClick: () => {
        closeModal();
        const onlyFrom = st.sync === 'onlyOne' ? CONFIG_NAMES.find((n) => st.files[n].exists) : null;
        const choose = (from) => async (c) => {
          const r = await call('config:sync', f.dir, from, seen);
          if (!r.ok) { c(); return alertModal('Sync stopped', r.error); }
          c(); configDialog(f);
        };
        const optionBtns = (onlyFrom ? [onlyFrom] : CONFIG_NAMES).map((from) => {
          const to = CONFIG_NAMES.find((n) => n !== from);
          return { label: onlyFrom ? `Create ${to} from ${from}` : `Keep ${from}, overwrite ${to}`, primary: !!onlyFrom, onClick: choose(from) };
        });
        modal({
          title: 'Sync config files',
          content: h('div', {}, st.sync === 'different' ? 'The two files differ. Choose which version wins; the other file is replaced with its content.' : 'Only one file exists. The other will be created with the same content.'),
          actions: [{ label: 'Cancel', onClick: () => configDialog(f) }, ...optionBtns],
        });
      },
    });
  }
  modal({
    title: `Config files · ${f.name}`,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:520px' }, h('div', { class: 'muted mono' }, f.dir), ...body),
    actions,
  });
}

async function createConfig(f, name, done) {
  const other = CONFIG_NAMES.find((n) => n !== name);
  const o = await call('config:read', f.dir, other);
  const content = o.content != null && (await confirmModal('Create ' + name, `Start from the content of ${other}?`, 'Copy it')) ? o.content : '';
  const r = await call('config:write', f.dir, name, content, null);
  if (!r.ok) return alertModal('Could not create', r.error);
  done();
}

async function editConfig(f, name) {
  const r = await call('config:read', f.dir, name);
  if (r.error) return alertModal('Edit ' + name, r.error);
  let mtime = r.mtime;
  const ta = h('textarea', { rows: 22, spellcheck: 'false', style: 'width:100%;min-width:560px;font-family:var(--mono)' });
  ta.value = r.content;
  const msg = h('div', { class: 'err' });
  modal({
    title: name,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, ta, msg),
    actions: [
      { label: 'Back', onClick: () => configDialog(f) },
      { label: 'Reload', onClick: async () => { const n = await call('config:read', f.dir, name); if (n.error) { msg.textContent = n.error; return; } ta.value = n.content; mtime = n.mtime; msg.textContent = ''; } },
      {
        label: 'Save', primary: true, onClick: async () => {
          const w = await call('config:write', f.dir, name, ta.value, mtime);
          if (!w.ok) { msg.textContent = w.error; return; }
          configDialog(f);
        },
      },
    ],
  });
}

registerCommand({ id: 'config-files', label: 'Config files (CLAUDE.md / AGENTS.md)…', run: () => configDialog() });
