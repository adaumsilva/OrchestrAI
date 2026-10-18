// "New Terminal" / "Edit Terminal" sheet: Details, Appearance and Role tabs.
// New terminals open it from the Add menu; existing ones from the right-click menu.

const TERMINAL_COLORS = [['Blue', '#0a84ff'], ['Red', '#ff453a'], ['Green', '#30d158'], ['Orange', '#ff9f0a'], ['Purple', '#bf5af2'], ['Pink', '#ff375f'], ['Cyan', '#64d2ff'], ['Yellow', '#ffd60a']];
const ICON_CHOICES = ['\u273B', '\u25CD', '\u2726', '\u25AF', '\u276F_', '\u2699', '\u2605', '\u26A1', '\u{1F9EA}', '\u{1F9ED}', '\u{1F6E0}', '\u{1F50D}'];
const themeOptions = () => [['', 'Settings default'], ['system', 'Follow system'], ...themeChoices()];

const switchEl = (checked, onChange) => {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }));
};

const sheetField = (label, control, hint) => h('div', { class: 'sheet-field' }, h('div', { class: 'sheet-label' }, label), control, hint ? h('div', { class: 'sheet-hint' }, hint) : null);
const toggleRow = (label, hint, control) => h('div', { class: 'toggle-row' }, h('div', {}, h('div', { class: 'sheet-label' }, label), h('div', { class: 'sheet-hint' }, hint)), control);

async function terminalDialog({ mode, floor, node }) {
  const isNew = mode === 'new';
  const d = isNew ? {} : node.data;
  const { detected, fallback } = await loadProfiles();
  const wslDistros = detected.filter((p) => p.id.startsWith('wsl:')).map((p) => p.id.slice(4));
  const containers = detected.filter((p) => p.id.startsWith('docker:')).map((p) => p.id.slice(7));
  const shells = detected.filter((p) => p.group === 'Shells');

  const draft = {
    name: isNew ? '' : node.title,
    command: d.command || '',
    runsOn: JSON.parse(JSON.stringify(d.runsOn || { kind: 'default' })),
    cwd: d.cwd || (isNew || !d.cwd ? floor.dir || '' : ''),
    monitor: isNew ? true : !!d.monitor,
    maestro: !!d.maestro,
    persist: !!d.persist,
    memLimitMB: d.memLimitMB || 0,
    icon: d.icon || '',
    color: d.color || '',
    theme: d.theme || '',
    fontFamily: d.fontFamily || '',
    fontSize: d.fontSize || 0,
    roleId: d.roleId || '',
    accountId: d.accountId || '',
  };
  let tab = 'details';
  let roleEditor = null; // { id?, name, instructions } while creating or editing a role
  let roleSearch = '';
  let confirmDelete = '';
  let error = '';
  const body = h('div', { class: 'sheet-body' });
  const tabsEl = h('div', { class: 'seg' });

  // ---------- Details ----------
  function runsOnFields() {
    const r = draft.runsOn;
    const input = (key, placeholder, type = 'text') => h('input', { type, placeholder, value: r[key] || '', oninput: (e) => { r[key] = type === 'number' ? e.target.value.replace(/\D/g, '') : e.target.value; } });
    const select = (key, options, empty) => h('select', { onchange: (e) => { r[key] = e.target.value; } },
      h('option', { value: '' }, empty), options.map(([v, l]) => h('option', { value: v, selected: r[key] === v }, l)));
    switch (r.kind) {
      case 'local':
        return h('div', { class: 'sheet-sub' }, sheetField('Shell', select('shellId', shells.map((p) => [p.id, p.label]), `System default (${fallback.label})`)));
      case 'wsl':
        if (!wslDistros.length) return h('div', { class: 'sheet-hint err' }, 'No WSL distributions were found on this machine.');
        r.distro ||= wslDistros[0];
        return h('div', { class: 'sheet-sub' },
          sheetField('WSL distribution', h('select', { onchange: (e) => { r.distro = e.target.value; } }, wslDistros.map((n) => h('option', { value: n, selected: r.distro === n }, n)))),
          sheetField('WSL login user', input('user', 'Distro default')));
      case 'ssh':
        return h('div', { class: 'sheet-sub' },
          h('div', { class: 'sheet-grid' }, sheetField('Host', input('host', 'hostname or IP')), sheetField('Port', input('port', '22', 'text'))),
          sheetField('User', input('user', 'username'), 'Uses your SSH config and keys from ~/.ssh.'));
      case 'docker':
        return h('div', { class: 'sheet-sub' },
          sheetField('Container', containers.length
            ? h('select', { onchange: (e) => { r.container = e.target.value; } }, h('option', { value: '' }, 'Choose a running container'), containers.map((n) => h('option', { value: n, selected: r.container === n }, n)))
            : input('container', 'Container name or ID'), containers.length ? null : 'No running containers were found; type a name.'),
          sheetField('User', input('user', 'Image default')));
      case 'sandbox':
        return sandboxFields();
      default:
        return null;
    }
  }

  // Docker Sandbox: pick one of `docker sandbox ls`, create one, or test the connection.
  let sandboxInfo = null; // { ok, sandboxes, error } once loaded
  function loadSandboxes() {
    sandboxInfo = { loading: true };
    call('sandbox:list').then((res) => { sandboxInfo = res; if (draft.runsOn.kind === 'sandbox') render(); });
  }
  function sandboxFields() {
    const r = draft.runsOn;
    if (!sandboxInfo) loadSandboxes();
    const list = sandboxInfo?.sandboxes ? sortSandboxes(sandboxInfo.sandboxes, floor.dir) : [];
    const pick = sandboxInfo?.loading || !sandboxInfo ? h('div', { class: 'sheet-hint' }, 'Looking for sandboxes…')
      : sandboxInfo.ok === false ? h('div', { class: 'sheet-hint err' }, `Could not list sandboxes: ${sandboxInfo.error}`)
        : list.length ? h('select', { onchange: (e) => { r.sandbox = e.target.value; } },
          h('option', { value: '' }, 'Choose a sandbox'),
          list.map((s) => h('option', { value: s.name, selected: r.sandbox === s.name }, `${s.name}${s.agent ? ' · ' + s.agent : ''}${s.status ? ' · ' + s.status : ''}${s.workspace ? ' · ' + s.workspace : ''}`)))
          : h('div', { class: 'sheet-hint' }, 'No sandboxes exist yet. Create one for this project.');
    return h('div', { class: 'sheet-sub' },
      sheetField('Sandbox', pick, 'Several terminals can share one sandbox. OrchestrAI never deletes it.'),
      h('div', { class: 'row' },
        h('button', { class: 'sheet-btn', onclick: () => { sandboxInfo = null; render(); } }, 'Refresh'),
        h('button', { class: 'sheet-btn', onclick: async () => { const name = await createSandboxDialog(floor.dir); sandboxInfo = null; if (name) r.sandbox = name; render(); } }, 'Create new…'),
        h('button', { class: 'sheet-btn', onclick: () => testSandbox(r.sandbox || '') }, 'Test connection')));
  }

  // Which account the agent CLI runs on: the provider's default, one of its accounts, or the plain environment.
  function accountField() {
    const kind = accountProviderFor(draft.command);
    const mine = accountsCache.accounts.filter((a) => !kind || a.provider === kind || a.provider === 'custom');
    if (!accountsCache.accounts.length) return null;
    const def = kind && accountsCache.defaults[kind] ? accountsCache.accounts.find((a) => a.id === accountsCache.defaults[kind]) : null;
    const sel = h('select', { onchange: (e) => { draft.accountId = e.target.value; } },
      h('option', { value: '', selected: !draft.accountId }, def ? `Default (${def.name})` : 'Default (my environment)'),
      h('option', { value: 'none', selected: draft.accountId === 'none' }, 'None (my environment)'),
      mine.map((a) => h('option', { value: a.id, selected: draft.accountId === a.id }, `${a.name} · ${accountsCache.providers[a.provider]?.label || a.provider}`)));
    return sheetField('Account', sel, 'Takes effect the next time the terminal starts. Local terminals only.');
  }

  // "Keep running after quit" needs tmux, so it is offered for Local, WSL and SSH only.
  function persistRow() {
    const k = draft.runsOn.kind;
    if (!['default', 'local', 'wsl', 'ssh', 'legacy'].includes(k)) return null;
    if (terminalSettings().persistSessions === false) return h('div', { class: 'sheet-hint' }, 'Keep running after quit is turned off in Settings.');
    return toggleRow('Keep running after quit', k === 'ssh' ? 'Runs inside tmux on the remote host, so the session survives disconnects and app restarts. Needs tmux there.' : 'Runs inside tmux; the app reattaches to it on the next start. Needs tmux on the machine. Closing the terminal ends the session.', switchEl(draft.persist, (v) => { draft.persist = v; }));
  }

  function detailsTab() {
    const nameInput = h('input', { placeholder: 'Terminal name', value: draft.name, oninput: (e) => { draft.name = e.target.value; } });
    const commandInput = h('input', { class: 'mono-input', placeholder: 'e.g. claude, codex, or leave empty for shell', value: draft.command, oninput: (e) => { draft.command = e.target.value; } });
    const runs = h('select', { onchange: (e) => { draft.runsOn = { kind: e.target.value }; render(); } },
      [['default', 'Workspace Default'], ['local', 'Local'], ['wsl', 'WSL'], ['ssh', 'SSH'], ['docker', 'Docker container'], ['sandbox', 'Docker Sandbox']].map(([v, l]) => h('option', { value: v, selected: draft.runsOn.kind === v || (draft.runsOn.kind === 'legacy' && v === 'default') }, l)));
    const remote = ['ssh', 'docker', 'sandbox'].includes(draft.runsOn.kind);
    const cwdInput = h('input', { class: 'mono-input', placeholder: remote ? 'Path on the remote environment' : (floor.dir || 'e.g. C:\\projects\\app'), value: draft.cwd, oninput: (e) => { draft.cwd = e.target.value; } });
    const browse = h('button', { class: 'sheet-btn', disabled: remote, onclick: async () => { const dir = await call('files:pickDirectory'); if (dir) { draft.cwd = dir; cwdInput.value = dir; } } }, '\u{1F4C2} Browse\u2026');

    const maestroInfo = h('div', { class: 'sheet-hint maestro-info hidden' },
      'A Maestro terminal gets the ', h('b', {}, 'orchestrai'), ' command and can: recruit agents (new connected terminals), assign them roles, send them messages, read what they show, and close them. It works for local terminals; remote and WSL terminals do not receive it.');
    const infoBtn = h('button', { class: 'info-btn', title: 'About Maestro Mode', onclick: () => maestroInfo.classList.toggle('hidden') }, '\u24D8');

    const quick = isNew ? h('div', { class: 'quick' },
      h('div', { class: 'sheet-section' }, 'Quick start'),
      h('div', { class: 'quick-row' }, state.settings.presets.filter((p) => p.active).slice(0, MAX_ACTIVE_PRESETS).map((p) =>
        h('button', {
          class: 'quick-item' + (draft.command === p.command && draft.icon === p.icon ? ' on' : ''),
          onclick: () => { draft.command = p.command; draft.icon = p.icon; if (!draft.name || state.settings.presets.some((x) => x.name === draft.name)) draft.name = p.name; render(); },
        }, h('span', { class: 'quick-ico' }, p.icon), h('span', {}, p.name))))) : null;

    return h('div', {},
      quick,
      sheetField('Terminal Name', nameInput),
      sheetField('Command', commandInput),
      h('div', { class: 'sheet-field' }, h('div', { class: 'toggle-row' }, h('div', { class: 'sheet-label' }, 'Runs on'), runs), runsOnFields() || (draft.runsOn.kind === 'default' ? h('div', { class: 'sheet-hint' }, fallback.label + (terminalSettings().profileId ? ' (changed in Settings)' : '')) : null)),
      sheetField('Working Directory', h('div', { class: 'row' }, cwdInput, browse)),
      accountField(),
      toggleRow('Monitor Activity', 'Detect terminal output and notify you when work finishes.', switchEl(draft.monitor, (v) => { draft.monitor = v; })),
      persistRow(),
      sheetField('Memory limit (MB)', h('input', { type: 'number', min: 0, step: 256, value: draft.memLimitMB || '', placeholder: 'inherit from Settings', oninput: (e) => { draft.memLimitMB = Math.max(0, Number(e.target.value) || 0); } })),
      toggleRow(h('span', {}, 'Maestro ', infoBtn), 'Promotes this terminal to a conductor that can direct the rest of the canvas.', switchEl(draft.maestro, (v) => { draft.maestro = v; })),
      maestroInfo);
  }

  // ---------- Appearance ----------
  function appearanceTab() {
    const themeName = draft.theme || terminalSettings().theme;
    const palette = terminalTheme(themeName);
    const preview = h('div', { class: 'term-preview' }, 'PS C:\\project> echo "The quick brown fox"');
    const paint = () => {
      const p = terminalTheme(draft.theme || terminalSettings().theme);
      preview.style.background = p.background;
      preview.style.color = p.foreground;
      preview.style.fontFamily = draft.fontFamily || terminalSettings().fontFamily;
      preview.style.fontSize = (draft.fontSize || terminalSettings().fontSize) + 'px';
      preview.style.borderLeft = `4px solid ${draft.color || 'transparent'}`;
    };
    preview.style.background = palette.background;
    const iconInput = h('input', { maxlength: 4, style: 'width:70px;text-align:center', placeholder: 'None', value: draft.icon, oninput: (e) => { draft.icon = e.target.value.trim(); paintIcons(); } });
    const iconButtons = ICON_CHOICES.map((ic) => h('button', { class: 'icon-choice', onclick: () => { draft.icon = ic; iconInput.value = ic; paintIcons(); } }, ic));
    const paintIcons = () => iconButtons.forEach((b) => b.classList.toggle('on', b.textContent === draft.icon));
    const customColor = h('input', { type: 'color', value: draft.color || '#0a84ff', title: 'Custom color', onchange: (e) => { draft.color = e.target.value; paintSwatches(); paint(); } });
    const swatches = [
      h('button', { class: 'color-choice none', title: 'No color', onclick: () => { draft.color = ''; paintSwatches(); paint(); } }, '\u2205'),
      ...TERMINAL_COLORS.map(([n, c]) => h('button', { class: 'color-choice', title: n, 'data-color': c, style: `background:${c}`, onclick: () => { draft.color = c; paintSwatches(); paint(); } })),
    ];
    const paintSwatches = () => swatches.forEach((b) => b.classList.toggle('on', (b.dataset.color || '') === draft.color));
    const theme = h('select', { onchange: (e) => { draft.theme = e.target.value; paint(); } }, themeOptions().map(([v, l]) => h('option', { value: v, selected: draft.theme === v }, l)));
    const fp = fontPicker({ value: draft.fontFamily, placeholder: terminalSettings().fontFamily, onChange: (v) => { draft.fontFamily = v; paint(); } });
    const font = fp.root;
    const size = h('input', { type: 'number', min: 8, max: 32, placeholder: String(terminalSettings().fontSize), value: draft.fontSize || '', style: 'width:80px', oninput: (e) => { draft.fontSize = Math.min(32, Math.max(0, parseInt(e.target.value, 10) || 0)); paint(); } });
    const reset = h('button', { class: 'sheet-btn', onclick: () => { draft.fontFamily = ''; draft.fontSize = 0; fp.input.value = ''; size.value = ''; paint(); } }, 'Use default');
    paintIcons(); paintSwatches(); paint();
    return h('div', {},
      sheetField('Icon', h('div', { class: 'icon-row' }, iconInput, iconButtons)),
      sheetField('Color', h('div', { class: 'icon-row' }, swatches, customColor)),
      sheetField('Theme', theme),
      sheetField('Font', h('div', { class: 'row' }, font, size, reset), draft.fontFamily || draft.fontSize ? 'Overrides the Settings default.' : 'Inheriting from Settings.'),
      preview);
  }

  // ---------- Role ----------
  function roleTab() {
    if (roleEditor) {
      const name = h('input', { placeholder: 'Role Name', value: roleEditor.name, oninput: (e) => { roleEditor.name = e.target.value; } });
      const text = h('textarea', { rows: 9, placeholder: 'Instructions the agent should follow, e.g. "You review code for security problems..."', value: roleEditor.instructions, oninput: (e) => { roleEditor.instructions = e.target.value; } });
      text.value = roleEditor.instructions;
      return h('div', {},
        h('div', { class: 'sheet-section' }, roleEditor.id ? 'Edit Role' : 'New Role'),
        sheetField('Name', name), sheetField('Instructions', text),
        error ? h('div', { class: 'err' }, error) : null,
        h('div', { class: 'row', style: 'justify-content:flex-end' },
          h('button', { class: 'sheet-btn', onclick: () => { roleEditor = null; error = ''; render(); } }, 'Cancel'),
          h('button', {
            class: 'sheet-btn primary',
            onclick: () => {
              const nm = roleEditor.name.trim();
              if (!nm) { error = 'Give the role a name.'; return render(); }
              if (state.settings.roles.some((r) => r.name.toLowerCase() === nm.toLowerCase() && r.id !== roleEditor.id)) { error = 'A role with this name already exists.'; return render(); }
              if (roleEditor.id) Object.assign(roleById(roleEditor.id), { name: nm, instructions: roleEditor.instructions });
              else { const r = { id: `role-${uid()}`, name: nm, instructions: roleEditor.instructions }; state.settings.roles.push(r); draft.roleId = r.id; }
              save();
              roleEditor = null; error = '';
              render();
            },
          }, 'Save role')));
    }
    const q = roleSearch.toLowerCase();
    const roles = state.settings.roles.filter((r) => !q || r.name.toLowerCase().includes(q) || r.instructions.toLowerCase().includes(q));
    const inUse = (id) => allFloors().flatMap((f) => f.nodes).filter((n) => n.kind === 'terminal' && n.data.roleId === id).length;
    const search = h('input', { placeholder: 'Search roles\u2026', value: roleSearch, oninput: (e) => { roleSearch = e.target.value; renderRoleList(); } });
    const list = h('div', { class: 'role-list' });
    function renderRoleList() {
      const filtered = state.settings.roles.filter((r) => !roleSearch || r.name.toLowerCase().includes(roleSearch.toLowerCase()) || r.instructions.toLowerCase().includes(roleSearch.toLowerCase()));
      list.replaceChildren(...(filtered.length ? filtered.map((r) => {
        const used = inUse(r.id);
        return h('div', { class: 'role-row' + (draft.roleId === r.id ? ' on' : ''), onclick: () => { draft.roleId = draft.roleId === r.id ? '' : r.id; render(); } },
          h('div', { class: 'role-main' }, h('div', { class: 'role-name' }, r.name, used ? h('span', { class: 'role-used' }, `${used} in use`) : null), h('div', { class: 'role-sum' }, r.instructions.slice(0, 110))),
          confirmDelete === r.id
            ? h('div', { class: 'role-actions', onclick: (e) => e.stopPropagation() },
              h('button', { class: 'sheet-btn danger', onclick: () => { state.settings.roles = state.settings.roles.filter((x) => x.id !== r.id); if (draft.roleId === r.id) draft.roleId = ''; for (const f of allFloors()) for (const n of f.nodes) if (n.data?.roleId === r.id) n.data.roleId = ''; confirmDelete = ''; save(); render(); } }, used ? `Delete (unassigns ${used})` : 'Confirm delete'),
              h('button', { class: 'sheet-btn', onclick: () => { confirmDelete = ''; render(); } }, 'Keep'))
            : h('div', { class: 'role-actions', onclick: (e) => e.stopPropagation() },
              h('button', { title: 'Edit', onclick: () => { roleEditor = { id: r.id, name: r.name, instructions: r.instructions }; render(); } }, '\u270E'),
              h('button', { title: 'Delete', onclick: () => { confirmDelete = r.id; render(); } }, '\u{1F5D1}')));
      }) : [h('div', { class: 'sheet-hint', style: 'padding:10px' }, 'No roles match.')]));
    }
    renderRoleList();
    return h('div', {},
      h('div', { class: 'sheet-hint' }, 'Assign a role to define what this agent should focus on. The instructions are sent to the agent as its first message once it has started, so a command (such as claude) is needed.'),
      h('div', { class: 'row', style: 'margin:8px 0' }, search, h('button', { class: 'sheet-btn', onclick: () => { roleEditor = { name: '', instructions: '' }; render(); } }, '+ New role')),
      list,
      draft.roleId ? h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'sheet-hint' }, `Assigned: ${roleById(draft.roleId)?.name || '(missing)'}`), h('button', { class: 'sheet-btn', style: 'margin-left:auto', onclick: () => { draft.roleId = ''; render(); } }, 'Unassign role')) : null);
  }

  function render() {
    tabsEl.replaceChildren(...[['details', 'Details'], ['appearance', 'Appearance'], ['role', 'Role']].map(([id, label]) =>
      h('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; roleEditor = null; error = ''; render(); } }, label)));
    const content = tab === 'details' ? detailsTab() : tab === 'appearance' ? appearanceTab() : roleTab();
    body.replaceChildren(...[content, error && tab !== 'role' ? h('div', { class: 'err' }, error) : null].filter(Boolean));
  }

  // ---------- submit ----------
  async function submit() {
    const r = draft.runsOn;
    error = '';
    if (r.kind === 'ssh' && !r.host?.trim()) error = 'Enter the SSH host.';
    else if (r.kind === 'docker' && !r.container?.trim()) error = 'Choose or enter a container.';
    else if (r.kind === 'sandbox' && !r.sandbox?.trim()) error = 'Choose or create a sandbox.';
    else if (r.kind === 'wsl' && !r.distro) error = 'Choose a WSL distribution.';
    if (error) { tab = 'details'; render(); return; }

    const command = draft.command.trim();
    const title = draft.name.trim() || (command ? command.split(/\s+/)[0] : '') || 'Terminal';
    const data = {
      command,
      runsOn: r.kind === 'default' ? undefined : { ...r, host: r.host?.trim(), user: r.user?.trim(), container: r.container?.trim(), sandbox: r.sandbox?.trim() },
      cwd: draft.cwd.trim() === (floor.dir || '') ? '' : draft.cwd.trim(),
      monitor: draft.monitor, maestro: draft.maestro, persist: draft.persist, memLimitMB: draft.memLimitMB || undefined,
      icon: draft.icon, color: draft.color, theme: draft.theme, fontFamily: draft.fontFamily, fontSize: draft.fontSize || 0, roleId: draft.roleId, accountId: draft.accountId,
    };
    closeModal();
    if (isNew) {
      addNode('terminal', { title, data }, floor);
      return;
    }
    const launchKey = (x) => JSON.stringify([x.command || '', x.runsOn || null, x.cwd || '', !!x.maestro, x.roleId || '', !!x.persist, x.accountId || '']);
    const launchChanged = launchKey(node.data) !== launchKey(data);
    // Turning persistence off (or changing where it runs) leaves a tmux session behind; end it.
    const oldTarget = tmuxTarget(node);
    const legacyProfile = node.data.profile;
    node.data = { ...data, profile: r.kind === 'default' ? legacyProfile : undefined, runsOn: data.runsOn };
    node.title = title;
    const entry = rt.get(floor.id)?.live.get(node.id);
    entry?.el.querySelector('.title') && (entry.el.querySelector('.title').textContent = title);
    entry?.api.applyAppearance?.();
    save();
    if (launchChanged && entry?.api.restart && await confirmModal('Restart terminal?', 'The command, environment, directory or role changed. Restart this terminal to apply it?', 'Restart')) {
      if (oldTarget) await call('app:tmuxKill', oldTarget);
      entry.api.restart();
    }
  }

  const root = document.getElementById('modal-root');
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('button', { class: 'link', onclick: closeModal }, 'Cancel'),
      h('div', { class: 'sheet-title' }, isNew ? 'New Terminal' : 'Edit Terminal'),
      h('button', { class: 'link strong', onclick: submit }, isNew ? 'Create' : 'Save')),
    tabsEl, body);
  root.replaceChildren(sheet);
  root.onmousedown = (e) => { if (e.target === root) closeModal(); };
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && tab === 'details') { e.preventDefault(); submit(); } });
  render();
  sheet.querySelector('input')?.focus();
}
