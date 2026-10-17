// Terminal settings, shell profiles and scrollback persistence.
// Loaded after renderer.js; the boot code calls normalizeSettings() once state is loaded.

const TERMINAL_DEFAULTS = {
  fontFamily: "'Cascadia Mono', Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.15,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  theme: 'system', // 'system' follows the light/dark pair below; also a built-in name or 'custom:<id>'
  themeLight: 'light',
  themeDark: 'dark',
  copyOnSelect: false,
  windowsKeys: true, // Ctrl+C copies when text is selected, Ctrl+V pastes
  restoreScrollback: true,
  persistSessions: true, // allow terminals to keep running in tmux after the app quits
  tmuxSocket: 'orchestrai', // tmux -L socket name shared by all persistent terminals
  profileId: '', // '' = platform default shell
  customProfiles: [], // [{ id, label, command, args }]
};

// Quick-start presets shown when creating a terminal (up to MAX_ACTIVE_PRESETS are active), and starter roles.
const MAX_ACTIVE_PRESETS = 5;
const DEFAULT_PRESETS = [
  { id: 'preset-claude', name: 'Claude Code', command: 'claude', icon: '✻', active: true },
  { id: 'preset-codex', name: 'Codex', command: 'codex', icon: '◍', active: true },
  { id: 'preset-antigravity', name: 'Antigravity', command: 'agy', icon: '✦', active: true },
  { id: 'preset-opencode', name: 'OpenCode', command: 'opencode', icon: '▯', active: true },
  { id: 'preset-shell', name: 'Shell', command: '', icon: '❯_', active: true },
];
const DEFAULT_ROLES = [
  { id: 'role-implementer', name: 'Implementer', instructions: 'Implement the task you are given with the smallest correct change. Read the surrounding code first and follow its conventions. Run the relevant tests before reporting back, and say plainly what you changed and what you did not verify.' },
  { id: 'role-reviewer', name: 'Code Reviewer', instructions: 'Review the changes you are pointed at for correctness bugs, missing error handling, security issues and unclear code. Do not edit files. Report findings ordered by severity, each with the file, the line and a concrete failing scenario.' },
  { id: 'role-tester', name: 'Tester', instructions: 'Write and run tests for the behaviour you are asked about, including edge cases and failure paths. Report which tests fail and why. Do not change production code unless asked.' },
  { id: 'role-researcher', name: 'Researcher', instructions: 'Investigate the question you are given by reading code and documentation. Do not modify files. Answer with what you found, where you found it, and what remains unknown.' },
];

function normalizeSettings() {
  state.settings = state.settings || {};
  state.settings.terminal = { ...TERMINAL_DEFAULTS, ...(state.settings.terminal || {}) };
  if (!Array.isArray(state.settings.terminal.customProfiles)) state.settings.terminal.customProfiles = [];
  state.settings.customThemes = Array.isArray(state.settings.customThemes) ? state.settings.customThemes : []; // [{ id, name, colors }]
  state.settings.presets = Array.isArray(state.settings.presets) ? state.settings.presets : DEFAULT_PRESETS.map((p) => ({ ...p }));
  state.settings.roles = Array.isArray(state.settings.roles) ? state.settings.roles : DEFAULT_ROLES.map((r) => ({ ...r }));
  state.scrollback = state.scrollback || {};
  state.settings.shortcuts = state.settings.shortcuts && typeof state.settings.shortcuts === 'object' ? state.settings.shortcuts : {};
}

const terminalSettings = () => state.settings?.terminal || TERMINAL_DEFAULTS;

function applyTerminalSettings() {
  for (const f of allFloors()) rt.get(f.id)?.live.forEach((e) => e.api.applySettings?.());
}

// Split a command line into arguments, honouring single and double quotes.
function splitCommandLine(text) {
  const out = [];
  for (const m of String(text).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const joinCommandLine = (command, args = []) => [command, ...args].map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ');

// ---------- scrollback persistence ----------
function persistScrollbacks({ sync = false } = {}) {
  const alive = new Set();
  for (const f of allFloors()) {
    rt.get(f.id)?.live.forEach((e, id) => {
      if (!e.api.snapshot) return;
      alive.add(id);
      try { state.scrollback[id] = e.api.snapshot(); } catch {}
    });
    f.nodes.forEach((n) => alive.add(n.id));
  }
  for (const id of Object.keys(state.scrollback)) if (!alive.has(id)) delete state.scrollback[id];
  if (sync) api.saveSync(state); else call('workspace:save', state);
}
setInterval(() => { if (document.querySelector('.xterm')) persistScrollbacks(); }, 20000);
addEventListener('beforeunload', () => { try { persistScrollbacks({ sync: true }); } catch {} });

// ---------- profiles ----------
async function loadProfiles(fresh) {
  const r = await call('app:shells', !!fresh);
  const custom = terminalSettings().customProfiles.map((p) => ({ ...p, group: 'Custom' }));
  return { detected: r.profiles, custom, fallback: r.default };
}

// Which profile a terminal node starts: its own choice, else the global default, else the platform shell.
async function resolveProfile(node) {
  if (node.data.profile) return node.data.profile;
  const id = wsOfNode(node.id)?.profileId || terminalSettings().profileId;
  if (id) {
    const { detected, custom } = await loadProfiles();
    const hit = [...custom, ...detected].find((p) => p.id === id);
    if (hit) return hit;
  }
  return null;
}

const roleById = (id) => state.settings.roles.find((r) => r.id === id) || null;
const rolePrompt = (role) => `You have been assigned the role "${role.name}" for this session.\n\n${role.instructions}`;
const MAESTRO_PRIMER = `You are the Maestro of this OrchestrAI canvas: a conductor that can direct other terminals. Use the \`orchestrai\` command in your shell:
  orchestrai list                        - see every terminal (id, name, floor, status, role)
  orchestrai new --name N --command C [--role R] [--cwd DIR]  - start a new agent terminal connected to you
  orchestrai send <terminal> <text>      - type a message into a terminal
  orchestrai read <terminal> [--lines N] - read what a terminal currently shows
  orchestrai close <terminal>            - close a terminal
  orchestrai roles                       - list available roles
Delegate work to other agents, check on them with read, and report back to the user when they finish.`;

// ---------- persistent sessions (tmux) ----------
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Where a persistent terminal's tmux session lives, or null when the terminal does not keep running after quit
// (not requested, disabled in Settings, or running somewhere tmux cannot be used, such as Docker or a custom profile).
function tmuxTarget(node) {
  const d = node.data, s = terminalSettings();
  if (!d.persist || s.persistSessions === false) return null;
  const runs = d.runsOn || { kind: d.profile ? 'legacy' : 'default' };
  const base = {
    socket: (s.tmuxSocket || 'orchestrai').replace(/[^\w.-]/g, '') || 'orchestrai',
    session: `orchestrai-${String(node.id).replace(/[^\w-]/g, '')}`.slice(0, 64),
  };
  switch (runs.kind) {
    case 'default': case 'local': return { ...base, kind: 'local' };
    case 'wsl': return { ...base, kind: 'wsl', distro: runs.distro, user: runs.user || '' };
    case 'ssh': return { ...base, kind: 'ssh', host: runs.host, user: runs.user || '', port: runs.port || '' };
    default: return null;
  }
}

// The arguments that attach to the terminal's tmux session, creating it on first use.
const tmuxAttachArgs = (t, shellArgv = [], dir = '') =>
  ['-L', t.socket, 'new-session', '-A', '-s', t.session, ...(dir ? ['-c', dir] : []), ...shellArgv];

// Turns a plain launch into one that runs inside tmux. Returns the launch unchanged, plus a notice, when tmux cannot be used.
async function persistLaunch(node, launch, cwdOverride) {
  const t = tmuxTarget(node);
  if (!t) return launch;
  const p = launch.profile;
  if (t.kind === 'local' && (p?.group === 'WSL' || p?.group === 'Docker' || p?.group === 'SSH')) return { ...launch, notice: 'Keep running after quit works with shells, WSL and SSH; this profile runs normally.' };
  const st = await call('app:tmuxStatus', t);
  const where = t.kind === 'wsl' ? `WSL ${t.distro}` : t.kind === 'ssh' ? t.host : 'this computer';
  if (!st.available) return { ...launch, notice: `Keep running after quit is unavailable: ${st.error || 'tmux not found'} (${where}). Install tmux there, or turn the option off. Starting without it.` };
  const reattach = { tmux: t, reattached: st.exists };
  if (t.kind === 'wsl') {
    return { ...launch, ...reattach, typed: st.exists ? '' : launch.typed, profile: { ...p, args: [...p.args, '--exec', 'tmux', ...tmuxAttachArgs(t)] } };
  }
  if (t.kind === 'ssh') {
    const inner = launch.sshCommand || '';
    const remote = ['tmux', ...tmuxAttachArgs(t, inner ? [inner] : [], cwdOverride)].map(shq).join(' ');
    const args = [...(launch.sshPre || []), '-t', launch.sshTarget, remote];
    return { ...launch, ...reattach, profile: { ...p, args } };
  }
  const shell = p ? [p.command, ...(p.args || [])] : [];
  return { ...launch, ...reattach, typed: st.exists ? '' : launch.typed, profile: { id: `tmux:${p?.id || 'default'}`, label: p?.label || 'Shell', group: 'tmux', command: 'tmux', args: tmuxAttachArgs(t, shell) } };
}

// Turns a terminal node's "Runs on" choice into a concrete launch: the profile to spawn, and the text to type
// into the shell once it is ready (the Command field). Remote kinds (ssh, docker) carry the command in their args.
async function resolveLaunch(node) {
  const d = node.data;
  const runs = d.runsOn || { kind: d.profile ? 'legacy' : 'default' };
  const command = (d.command || '').trim();
  const cwdOverride = (d.cwd || '').trim();
  const { detected, fallback } = await loadProfiles();
  switch (runs.kind) {
    case 'local': {
      const hit = runs.shellId && detected.find((p) => p.id === runs.shellId);
      return persistLaunch(node, { profile: hit || fallback, typed: command, remote: false }, cwdOverride);
    }
    case 'wsl': {
      const args = ['-d', runs.distro, ...(runs.user ? ['-u', runs.user] : [])];
      return persistLaunch(node, { profile: { id: `wsl:${runs.distro}`, label: `WSL: ${runs.distro}`, group: 'WSL', command: 'wsl.exe', args, cdFlag: true }, typed: command, remote: false }, cwdOverride);
    }
    case 'ssh': {
      const target = (runs.user ? `${runs.user}@` : '') + runs.host;
      const remoteCmd = cwdOverride ? `cd "${cwdOverride}" && ${command || 'exec "$SHELL" -l'}` : command;
      const pre = runs.port ? ['-p', String(runs.port)] : [];
      const args = [...pre, ...(remoteCmd ? ['-t'] : []), target, ...(remoteCmd ? [remoteCmd] : [])];
      return persistLaunch(node, { profile: { id: `ssh:${target}`, label: `SSH: ${target}`, group: 'SSH', command: 'ssh', args }, typed: '', remote: true, sshPre: pre, sshTarget: target, sshCommand: command }, cwdOverride);
    }
    case 'docker': {
      const inner = command || 'command -v bash >/dev/null 2>&1 && exec bash || exec sh';
      const args = ['exec', '-it', ...(runs.user ? ['-u', runs.user] : []), ...(cwdOverride ? ['-w', cwdOverride] : []), runs.container, 'sh', '-c', inner];
      return { profile: { id: `docker:${runs.container}`, label: `Docker: ${runs.container}`, group: 'Docker', command: 'docker', args }, typed: '', remote: true };
    }
    case 'sandbox': {
      const { cmd, pre } = await call('sandbox:cli');
      const inner = command || 'command -v bash >/dev/null 2>&1 && exec bash || exec sh';
      const args = [...pre, 'sandbox', 'exec', '-it', ...(runs.user ? ['-u', runs.user] : []), ...(cwdOverride ? ['-w', cwdOverride] : []), runs.sandbox, 'sh', '-c', inner];
      return { profile: { id: `sandbox:${runs.sandbox}`, label: `Sandbox: ${runs.sandbox}`, group: 'Docker', command: cmd, args }, typed: '', remote: true };
    }
    default:
      return persistLaunch(node, { profile: await resolveProfile(node), typed: command, remote: false }, cwdOverride);
  }
}

async function profileDialog(node, onApply) {
  const { detected, custom, fallback } = await loadProfiles(true);
  const current = node.data.profile?.id || terminalSettings().profileId || fallback.id;
  let chosen = node.data.profile || null;
  const customCmd = h('input', { placeholder: 'e.g. ssh user@host   or   python -i', value: node.data.profile?.group === 'Ad hoc' ? joinCommandLine(node.data.profile.command, node.data.profile.args) : '' });
  const startDir = h('input', { placeholder: 'Default: the floor’s directory', value: node.data.cwd || '' });
  const rows = new Map();
  const mark = () => rows.forEach((el, id) => el.classList.toggle('sel', (chosen?.id || current) === id));
  const item = (p) => {
    const el = h('div', { class: 'tree-item', onclick: () => { chosen = p; customCmd.value = ''; mark(); } }, h('span', {}, p.label), h('span', { class: 'git-badge muted' }, p.command));
    rows.set(p.id, el);
    return el;
  };
  const groups = new Map();
  [fallback, ...detected.filter((p) => p.id !== fallback.id), ...custom].forEach((p) => {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  });
  const list = h('div', { class: 'scroll bordered', style: 'max-height:240px' },
    [...groups].flatMap(([g, ps]) => [h('div', { class: 'muted', style: 'padding:4px 6px 0;font-size:11px;text-transform:uppercase' }, g), ...ps.map(item)]));
  mark();
  modal({
    title: 'Terminal profile',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      list,
      h('label', {}, 'Or run a custom command', customCmd),
      h('label', {}, 'Start directory', startDir),
      h('div', { class: 'muted' }, 'Applying restarts this terminal. Add reusable profiles (SSH hosts, REPLs) in Settings.')),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Apply and restart', primary: true, onClick: (c) => {
          if (customCmd.value.trim()) {
            const parts = splitCommandLine(customCmd.value);
            chosen = { id: `adhoc:${parts.join(' ')}`, label: parts[0], group: 'Ad hoc', command: parts[0], args: parts.slice(1) };
          }
          node.data.profile = chosen && chosen.id !== fallback.id ? chosen : null;
          node.data.cwd = startDir.value.trim() || '';
          save();
          c();
          onApply();
        },
      },
    ],
  });
}

// ---------- settings dialog ----------
async function settingsDialog() {
  const s = { ...terminalSettings(), customProfiles: terminalSettings().customProfiles.map((p) => ({ ...p })) };
  const { detected, fallback } = await loadProfiles();
  const num = (key, min, max, step = 1) => h('input', { type: 'number', min, max, step, value: s[key], style: 'width:90px', onchange: (e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) s[key] = Math.min(max, Math.max(min, v)); } });
  const check = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s[key], onchange: (e) => { s[key] = e.target.checked; } }), label);
  const select = (key, options) => h('select', { onchange: (e) => { s[key] = e.target.value; } }, options.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)));
  const font = fontPicker({ value: s.fontFamily, placeholder: TERMINAL_DEFAULTS.fontFamily, onChange: (v) => { s.fontFamily = v || TERMINAL_DEFAULTS.fontFamily; } }).root;

  // Custom themes are edited on a copy and written back on Save.
  const themes = customThemes().map((t) => ({ ...t, colors: { ...t.colors } }));
  const themeSelects = [];
  const themeSelect = (key, extra = []) => {
    const el = h('select', { onchange: (e) => { s[key] = e.target.value; } });
    el.fill = () => el.replaceChildren(...[...extra, ...BUILTIN_THEMES, ...themes.map((t) => [`custom:${t.id}`, t.name || 'Custom theme'])].map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)));
    themeSelects.push(el);
    el.fill();
    return el;
  };
  const themeRows = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const themeError = h('div', { class: 'err hidden' });
  const themesToSave = () => themes.map(({ open, ...rest }) => rest);
  const renderThemes = () => {
    themeRows.replaceChildren(...themes.map((t, i) => {
      const shown = { ...paletteFromColors(t.colors), selection: hex6(t.colors.selection) || '#0a84ff' };
      const swatch = (k) => h('label', { class: 'theme-color', title: THEME_LABELS[k] || k },
        h('input', { type: 'color', value: hex6(t.colors[k]) || hex6(shown[k]) || '#000000', oninput: (e) => { t.colors[k] = e.target.value; } }),
        h('span', {}, THEME_LABELS[k] || k));
      const remove = () => {
        themes.splice(i, 1);
        const fallback = { theme: 'system', themeLight: 'light', themeDark: 'dark' };
        for (const key of Object.keys(fallback)) if (s[key] === `custom:${t.id}`) s[key] = fallback[key];
        renderThemes();
      };
      return h('details', { class: 'theme-card', open: t.open, ontoggle: (e) => { t.open = e.target.open; } },
        h('summary', {}, t.name || 'Custom theme'),
        h('div', { class: 'row', style: 'margin:6px 0' },
          h('input', { value: t.name, placeholder: 'Theme name', onchange: (e) => { t.name = e.target.value.trim(); renderThemes(); } }),
          h('button', { class: 'danger', title: 'Delete theme', onclick: remove }, '✕')),
        h('div', { class: 'theme-grid' }, THEME_KEYS.map(swatch)));
    }));
    if (!themes.length) themeRows.append(h('div', { class: 'muted' }, 'None yet. Add one, or import a theme from JSON.'));
    themeSelects.forEach((x) => x.fill());
  };
  const newTheme = () => { themes.push({ id: `t-${uid()}`, name: 'My theme', colors: { ...TERMINAL_PALETTES.dark, selection: '#0a84ff' }, open: true }); renderThemes(); };
  const importTheme = () => {
    const box = h('textarea', { rows: 8, placeholder: 'Paste an xterm.js / VS Code style JSON theme or a Windows Terminal color scheme', style: 'width:100%' });
    modal({
      title: 'Import theme',
      content: h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, box, themeError),
      actions: [
        { label: 'Cancel', onClick: () => settingsDialog() },
        {
          label: 'Import', primary: true, onClick: () => {
            try {
              const t = parseThemeText(box.value);
              themes.push({ id: `t-${uid()}`, name: t.name || 'Imported theme', colors: t.colors });
              state.settings.customThemes = themesToSave();
              save();
              settingsDialog();
            } catch (err) { themeError.textContent = err.message; themeError.classList.remove('hidden'); }
          },
        },
      ],
    });
  };
  renderThemes();

  const profileSelect = h('select', { onchange: (e) => { s.profileId = e.target.value; } });
  const refreshProfiles = () => {
    profileSelect.replaceChildren(
      h('option', { value: '' }, `Platform default (${fallback.label})`),
      ...[...s.customProfiles.filter((p) => p.command).map((p) => ({ ...p, group: 'Custom' })), ...detected].map((p) => h('option', { value: p.id, selected: s.profileId === p.id }, `${p.group}: ${p.label}`)));
  };

  const customRows = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const renderCustom = () => {
    customRows.replaceChildren(...s.customProfiles.map((p, i) => h('div', { class: 'row' },
      h('input', { placeholder: 'Label', value: p.label, style: 'flex:0 0 130px', oninput: (e) => { p.label = e.target.value; } }),
      h('input', { placeholder: 'Command, e.g. ssh me@server', value: joinCommandLine(p.command || '', p.args || []).trim(), oninput: (e) => { const parts = splitCommandLine(e.target.value); p.command = parts[0] || ''; p.args = parts.slice(1); }, onchange: refreshProfiles }),
      h('button', { title: 'Remove', class: 'danger', onclick: () => { s.customProfiles.splice(i, 1); renderCustom(); refreshProfiles(); } }, '✕'))));
    if (!s.customProfiles.length) customRows.append(h('div', { class: 'muted' }, 'None yet. Example: label "Prod", command ssh me@prod.example.com'));
  };
  const addCustom = h('button', { onclick: () => { s.customProfiles.push({ id: `custom:${uid()}`, label: 'New profile', command: '', args: [] }); renderCustom(); refreshProfiles(); } }, '+ Add profile');
  renderCustom();
  refreshProfiles();

  // Quick-start presets (shown when creating a terminal). At most MAX_ACTIVE_PRESETS can be active.
  const presets = state.settings.presets.map((p) => ({ ...p }));
  const presetRows = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const presetNote = h('div', { class: 'muted' });
  const renderPresets = () => {
    const activeCount = presets.filter((p) => p.active).length;
    presetNote.textContent = `Up to ${MAX_ACTIVE_PRESETS} active presets appear when creating a terminal (${activeCount} active).`;
    presetRows.replaceChildren(...presets.map((p, i) => h('div', { class: 'row' },
      h('input', { type: 'checkbox', checked: p.active, title: 'Show when creating a terminal', style: 'flex:none', onchange: (e) => { if (e.target.checked && presets.filter((x) => x.active).length >= MAX_ACTIVE_PRESETS) { e.target.checked = false; return; } p.active = e.target.checked; renderPresets(); } }),
      h('input', { value: p.icon, maxlength: 4, title: 'Icon', style: 'flex:0 0 44px;text-align:center', oninput: (e) => { p.icon = e.target.value; } }),
      h('input', { value: p.name, placeholder: 'Name', style: 'flex:0 0 120px', oninput: (e) => { p.name = e.target.value; } }),
      h('input', { value: p.command, placeholder: 'Command (empty = shell)', class: 'mono-input', oninput: (e) => { p.command = e.target.value; } }),
      h('button', { class: 'danger', title: 'Remove', onclick: () => { presets.splice(i, 1); renderPresets(); } }, '\u2715'))));
  };
  renderPresets();

  const field = (label, control) => h('label', { style: 'display:grid;grid-template-columns:150px 1fr;align-items:center;gap:8px' }, h('span', { class: 'muted' }, label), control);
  modal({
    title: 'Terminal settings',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      field('Font family', font),
      field('Font size', num('fontSize', 8, 32)),
      field('Line height', num('lineHeight', 1, 2, 0.05)),
      field('Cursor', select('cursorStyle', [['block', 'Block'], ['underline', 'Underline'], ['bar', 'Bar']])),
      field('Theme', themeSelect('theme', [['system', 'Follow system']])),
      field('Light theme', themeSelect('themeLight')),
      field('Dark theme', themeSelect('themeDark')),
      h('div', { class: 'muted' }, '“Follow system” switches between the light and dark theme above with your OS appearance.'),
      field('Scrollback (lines)', num('scrollback', 500, 100000, 500)),
      field('Default profile', profileSelect),
      field('Connection style', h('select', { onchange: (e) => setRopeRouting(e.target.value) }, h('option', { value: 'cable', selected: ropeRouting() === 'cable' }, 'Hanging cables'), h('option', { value: 'circuit', selected: ropeRouting() === 'circuit' }, 'Circuit traces (right angles)'))),
      check('cursorBlink', 'Blinking cursor'),
      check('copyOnSelect', 'Copy text as soon as it is selected'),
      check('windowsKeys', 'Ctrl+C copies when text is selected, Ctrl+V pastes (Ctrl+Shift+C/V always work)'),
      check('restoreScrollback', 'Restore each terminal’s recent output after restarting the app'),
      check('persistSessions', 'Allow terminals to keep running after the app quits (uses tmux)'),
      field('tmux socket name', h('input', { value: s.tmuxSocket, placeholder: 'orchestrai', onchange: (e) => { s.tmuxSocket = e.target.value.replace(/[^\w.-]/g, '') || 'orchestrai'; e.target.value = s.tmuxSocket; } })),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Custom themes'),
      themeRows,
      h('div', { class: 'row' }, h('button', { onclick: newTheme }, '+ Add theme'), h('button', { onclick: importTheme }, 'Import…')),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Quick start presets'),
      presetNote, presetRows,
      h('div', {}, h('button', { onclick: () => { presets.push({ id: `preset-${uid()}`, name: 'New preset', command: '', icon: '○', active: presets.filter((p) => p.active).length < MAX_ACTIVE_PRESETS }); renderPresets(); } }, '+ Add preset')),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Keyboard'),
      h('div', {}, h('button', { onclick: () => { closeModal(); shortcutsDialog(); } }, 'Customize shortcuts…')),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Accounts'),
      h('div', {}, h('button', { onclick: () => { closeModal(); accountsDialog(); } }, 'Manage accounts…')),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Agent skills'),
      h('div', {}, h('button', { onclick: () => { closeModal(); skillsDialog(); } }, 'Manage agent skills…')),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Custom profiles'),
      customRows, h('div', {}, addCustom)),
    actions: [
      { label: 'Reset', onClick: (c) => { state.settings.terminal = { ...TERMINAL_DEFAULTS, customProfiles: [] }; save(); applyTerminalSettings(); c(); } },
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Save', primary: true, onClick: (c) => {
          s.customProfiles = s.customProfiles.filter((p) => p.command);
          state.settings.terminal = s;
          state.settings.customThemes = themesToSave();
          state.settings.presets = presets.filter((p) => p.name.trim());
          save();
          applyTerminalSettings();
          c();
        },
      },
    ],
  });
}

document.getElementById('settings-btn').onclick = settingsDialog;
