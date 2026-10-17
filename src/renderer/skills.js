// Agent skills: install the orchestrai skill into Claude Code / Codex config so agents know the CLI without a typed primer.

let skillStatus = {};
const refreshSkillStatus = async () => { try { skillStatus = await call('skills:status'); } catch {} return skillStatus; };
refreshSkillStatus();

// Which skill target (if any) covers the agent a terminal command starts.
function skillTargetFor(command) {
  const exe = String(command || '').trim().split(/\s+/)[0].split(/[\\/]/).pop().replace(/\.(cmd|exe|ps1)$/i, '').toLowerCase();
  return exe === 'claude' ? 'claude' : exe === 'codex' ? 'codex' : null;
}
// True when the agent already knows the CLI from an installed skill, so the typed primer is unnecessary.
const skillCovers = (command) => { const t = skillTargetFor(command); return !!(t && skillStatus[t]?.installed && skillStatus[t]?.upToDate); };

async function skillsDialog() {
  const st = await refreshSkillStatus();
  const msg = h('div', { class: 'muted' });
  const rows = Object.entries(st).map(([id, s]) => h('div', { class: 'skill-row' },
    h('div', { class: 'routine-main' },
      h('div', {}, h('b', {}, s.label), '  ', h('span', { class: s.installed ? (s.upToDate ? 'skill-ok' : 'skill-old') : 'muted' }, s.installed ? (s.upToDate ? 'Installed' : 'Installed (outdated)') : 'Not installed')),
      h('div', { class: 'muted mono' }, s.file)),
    h('button', {
      class: s.installed && s.upToDate ? '' : 'primary',
      onclick: async () => {
        const r = await call('skills:install', id);
        if (!r.ok) return alertModal('Install failed', r.error);
        closeModal(); skillsDialog().then(() => {});
        if (r.backedUp) setTimeout(() => alertModal('Backed up', `An existing file was saved as\n${r.backedUp}`), 50);
      },
    }, s.installed ? 'Reinstall' : 'Install'),
    s.installed ? h('button', {
      class: 'danger', onclick: async () => {
        const r = await call('skills:uninstall', id);
        if (!r.ok) return alertModal('Uninstall failed', r.error);
        closeModal(); skillsDialog();
      },
    }, 'Uninstall') : null));
  modal({
    title: 'Agent skills',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:520px' },
      h('div', {}, 'Installs a short guide for the orchestrai command so agents use it without being told. Existing files are backed up before anything is changed.'),
      ...rows, msg,
      h('div', { class: 'muted' }, 'Where a skill is installed and current, Maestro terminals running that agent skip the typed primer. Terminals on WSL, SSH or Docker do not get the CLI yet.')),
    actions: [{ label: 'Close', primary: true, onClick: (c) => c() }],
  });
}

registerCommand({ id: 'skills', label: 'Agent skills…', run: skillsDialog });
