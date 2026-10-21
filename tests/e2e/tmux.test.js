// "Keep running after quit": which terminals get a tmux target, and how a launch changes (or explains why it cannot).
module.exports = async (t) => {
  const target = (data, id = 'node-1') => t.js(`tmuxTarget({ id: ${JSON.stringify(id)}, data: ${JSON.stringify(data)} })`);

  t.check('a terminal that did not ask for it has no target', (await target({})) === null);
  const local = await target({ persist: true });
  t.check('a default terminal persists locally', local && local.kind === 'local' && local.socket === 'orchestrai' && local.session === 'orchestrai-node-1', local);
  const wsl = await target({ persist: true, runsOn: { kind: 'wsl', distro: 'Ubuntu', user: 'dev' } });
  t.check('WSL keeps the distribution and user', wsl && wsl.kind === 'wsl' && wsl.distro === 'Ubuntu' && wsl.user === 'dev', wsl);
  const ssh = await target({ persist: true, runsOn: { kind: 'ssh', host: 'box.example', user: 'me', port: '2200' } });
  t.check('SSH keeps host, user and port', ssh && ssh.kind === 'ssh' && ssh.host === 'box.example' && ssh.user === 'me' && ssh.port === '2200', ssh);
  t.check('Docker terminals cannot persist', (await target({ persist: true, runsOn: { kind: 'docker', container: 'c' } })) === null);
  t.check('sandbox terminals cannot persist', (await target({ persist: true, runsOn: { kind: 'sandbox', sandbox: 's' } })) === null);

  const odd = await target({ persist: true }, 'we ird/id!' + 'x'.repeat(80));
  t.check('the session name is made safe and short', odd && /^[\w.-]{1,64}$/.test(odd.session) && odd.session.startsWith('orchestrai-weirdid'), odd);

  await t.js(`state.settings.terminal.tmuxSocket = 'my sock/1'; 0`);
  t.check('the socket name is sanitised', (await target({ persist: true })).socket === 'mysock1');
  await t.js(`state.settings.terminal.persistSessions = false; 0`);
  t.check('turning persistence off in Settings disables every target', (await target({ persist: true })) === null);
  await t.js(`state.settings.terminal.persistSessions = true; state.settings.terminal.tmuxSocket = 'orchestrai'; 0`);

  // ---- the service validates again, so a forged target never runs ----
  const forged = await t.js(`call('app:tmuxStatus', { kind: 'local', socket: 'x', session: 'a; calc' })`);
  t.check('a forged target is refused by the service', forged.available === false && /Invalid/.test(forged.error), forged);
  t.check('and cannot be killed', (await t.js(`call('app:tmuxKill', { kind: 'ssh', socket: 'x', session: 's', host: 'h;calc' })`)) === false);

  // ---- launching ----
  const node = { id: 'launch-1', data: { persist: true } };
  const shell = { id: 'powershell', label: 'PowerShell', group: 'Shells', command: 'powershell.exe', args: [] };
  const plain = await t.js(`persistLaunch(${JSON.stringify(node)}, { profile: ${JSON.stringify({ ...shell, group: 'Docker' })}, typed: '' })`);
  t.check('a Docker profile runs normally with an explanation', !plain.tmux && /works with shells, WSL and SSH/.test(plain.notice), plain);
  const off = await t.js(`persistLaunch({ id: 'x', data: {} }, { profile: ${JSON.stringify(shell)}, typed: 'ls' })`);
  t.check('a terminal without the option is launched unchanged', off.typed === 'ls' && !off.tmux && !off.notice, off);

  const st = await t.js(`call('app:tmuxStatus', ${JSON.stringify(local)})`);
  const launched = await t.js(`persistLaunch(${JSON.stringify(node)}, { profile: ${JSON.stringify(shell)}, typed: 'echo hi' })`);
  if (st.available) {
    t.check('with tmux available the shell runs inside a tmux session', launched.profile.command === 'tmux' && launched.profile.args.includes('new-session') && launched.profile.args.includes('-A') && launched.profile.args.includes('orchestrai-launch-1'), launched.profile);
    t.check('the shell command is passed to tmux', launched.profile.args.includes('powershell.exe'), launched.profile.args);
    t.check('a fresh session types the command, an existing one does not', launched.reattached ? launched.typed === '' : launched.typed === 'echo hi', launched);
  } else {
    t.check('without tmux it starts normally and says why', !launched.tmux && /unavailable/.test(launched.notice || '') && launched.profile.command === 'powershell.exe', launched);
  }

  // A distribution that does not exist can never have tmux: the same fallback applies.
  const badWsl = await t.js(`persistLaunch({ id: 'w', data: { persist: true, runsOn: { kind: 'wsl', distro: 'No-Such-Distro' } } }, { profile: { id: 'wsl:No-Such-Distro', group: 'WSL', command: 'wsl.exe', args: ['-d', 'No-Such-Distro'] }, typed: '' })`);
  t.check('a missing WSL distribution falls back with a notice', !badWsl.tmux && /unavailable/.test(badWsl.notice || ''), badWsl);

  // ---- the settings sheet offers the option only where tmux can be used ----
  const floor = await t.js(`activeFloor().id`);
  await t.js(`terminalDialog({ mode: 'new', floor: activeFloor() }); 0`);
  await t.sleep(800);
  const hasRow = () => t.js(`document.querySelector('.sheet')?.textContent.includes('Keep running after quit')`);
  t.check('the sheet offers it for the default environment', await hasRow());
  await t.js(`(() => { const s = [...document.querySelectorAll('.sheet select')].find((x) => [...x.options].some((o) => o.value === 'docker')); s.value = 'docker'; s.dispatchEvent(new Event('change')); return 0; })()`);
  await t.sleep(300);
  t.check('and hides it for Docker', !(await hasRow()));
  await t.js(`closeModal(); 0`);
  void floor;
};
