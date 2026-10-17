// Interface fault handling, first-run tour and update checks.

// ---------- fault banner ----------
// An uncaught error in the interface does not stop the terminals (they run in the main process), so say so and offer a reload.
let lastFault = 0;
function reportFault(message, where) {
  if (/ResizeObserver loop/i.test(message || '')) return; // harmless browser notice
  call('app:rendererError', String(message || 'error').slice(0, 400), where || '').catch?.(() => {});
  if (Date.now() - lastFault < 60000) return;
  lastFault = Date.now();
  const bar = h('div', { class: 'fault-bar', role: 'alert' },
    h('span', {}, 'Something went wrong in the interface. Your terminals are still running.'),
    h('button', { onclick: () => location.reload() }, 'Reload'),
    h('button', { onclick: async () => { const r = await call('app:saveDiagnostics'); if (r?.path) alertModal('Report saved', r.path); } }, 'Save report…'),
    h('button', { title: 'Dismiss', onclick: () => bar.remove() }, '×'));
  document.querySelector('.fault-bar')?.remove();
  document.body.append(bar);
}
addEventListener('error', (e) => reportFault(e.message, `${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => reportFault('unhandled rejection: ' + (e.reason?.message || e.reason), ''));

// ---------- first-run tour ----------
const TOUR_STEPS = [
  { title: 'Welcome to OrchestrAI', body: 'A canvas for your terminals and AI agents. Add terminals, notes, files, browsers and more with the + menu, drag them where you want, and scroll to zoom. Everything is saved automatically.' },
  { title: 'Connect and organize', body: 'Select a node and press C to connect it to another with a rope: connected terminals can message each other. Floors are separate canvases, and a floor can be an isolated git worktree you merge back when the work is done.' },
  { title: 'Direct your agents', body: 'Turn on Maestro in a terminal\'s settings so it can start and steer other agents with the orchestrai command. Ctrl+K opens the command palette, and Settings can install a skill so agents learn the commands.' },
];

function startTour() {
  let step = 0;
  const done = () => { state.settings.onboarded = true; save(); overlay.remove(); };
  const overlay = h('div', { class: 'tour-overlay' });
  const render = () => {
    const s = TOUR_STEPS[step];
    overlay.replaceChildren(h('div', { class: 'tour-card' },
      h('div', { class: 'tour-dots' }, TOUR_STEPS.map((_x, i) => h('span', { class: i === step ? 'on' : '' }))),
      h('h2', {}, s.title),
      h('p', {}, s.body),
      h('div', { class: 'row' },
        h('button', { onclick: done }, 'Skip'),
        h('span', { style: 'flex:1' }),
        step > 0 ? h('button', { onclick: () => { step--; render(); } }, 'Back') : null,
        step < TOUR_STEPS.length - 1
          ? h('button', { class: 'primary', onclick: () => { step++; render(); } }, 'Next')
          : h('button', { class: 'primary', onclick: done }, 'Get started'))));
  };
  document.querySelector('.tour-overlay')?.remove();
  render();
  document.body.append(overlay);
  return overlay;
}

// A profile that already has content is not new, so it never sees the tour on its own.
function isFreshWorkspace(st = state) {
  return st.workspaces.length === 1 && st.workspaces[0].floors.length === 1 && st.workspaces[0].floors[0].nodes.length <= 1;
}

async function maybeStartTour(flags) {
  flags = flags || await call('app:flags');
  if (flags.noOnboarding || state.settings.onboarded) return;
  if (!isFreshWorkspace()) { state.settings.onboarded = true; save(); return; }
  startTour();
}

registerCommand({ id: 'tour', label: 'Welcome tour', run: () => startTour() });

// ---------- updates ----------
let updateInfo = { status: 'idle', current: '' };
// The dialog is rebuilt whenever the status changes, so its buttons always match.
api.on('updates:status', (s) => { updateInfo = s; if (document.querySelector('#modal-root [data-updates]')) updatesDialog(false); });

const UPDATE_TEXT = {
  idle: 'Not checked yet.', checking: 'Checking for updates…', none: 'You are up to date.', available: 'A new version is available.', downloading: 'Downloading…', ready: 'The update is ready to install.',
  error: 'The update check failed.', dev: 'Updates are only available in installed builds. This copy runs from source.',
};

async function updatesDialog(refetch = true) {
  if (refetch) updateInfo = await call('updates:status');
  const u = updateInfo;
  const auto = h('input', { type: 'checkbox', checked: state.settings.autoUpdate !== false, onchange: (e) => { state.settings.autoUpdate = e.target.checked; save(); call('updates:setAuto', e.target.checked); } });
  const body = h('div', { 'data-updates': '1', style: 'display:flex;flex-direction:column;gap:10px;min-width:440px' },
    h('div', {}, `Current version ${u.current || ''}`),
    h('div', { class: u.status === 'error' ? 'err' : '' }, UPDATE_TEXT[u.status] || '', u.status === 'available' || u.status === 'ready' ? ` Version ${u.version}.` : '', u.status === 'downloading' ? ` ${u.percent}%` : '', u.status === 'error' && u.error ? h('div', { class: 'mono' }, u.error) : null),
    u.notes ? h('div', { class: 'release-notes scroll bordered' }, u.notes) : null,
    h('label', { class: 'check' }, auto, 'Check for updates automatically (never installs without asking)'));
  modal({
    title: 'Updates', content: body,
    actions: [
      { label: 'Close', onClick: (c) => c() },
      { label: 'Check now', onClick: () => { call('updates:check'); } },
      ...(u.status === 'available' ? [{ label: 'Download', primary: true, onClick: () => { call('updates:download'); } }] : []),
      ...(u.status === 'ready' ? [{ label: 'Install and restart', primary: true, onClick: () => { call('updates:install'); } }] : []),
    ],
  });
}
registerCommand({ id: 'updates', label: 'Check for updates…', run: () => updatesDialog() });

(async () => {
  // Wait for the boot code to finish loading the settings.
  for (let i = 0; i < 100 && !(typeof state !== 'undefined' && state.settings && state.workspaces && state.workspaces.length && rt.size); i++) await new Promise((r) => setTimeout(r, 100));
  try { call('updates:setAuto', state.settings.autoUpdate !== false); } catch {}
  maybeStartTour();
})();
