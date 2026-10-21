// First-run data folder choice, the feedback button (GitHub issues) and the occasional "star the repo" nudge.

const REPO_URL = 'https://github.com/adaumsilva/OrchestrAI';
const STAR_AFTER_DAYS = 7, STAR_SNOOZE_DAYS = 14, STAR_DELAY_MS = 25000;
const DAY = 86400000;

// ---------- first run: where to keep the data ----------
// Resolves when the user keeps the default folder (or dismisses the dialog). Choosing another folder moves
// the data there and restarts the app, so that case never resolves.
async function firstRunSetup() {
  let info;
  try { info = await call('workspace:firstRun'); } catch { return; }
  if (!info?.firstRun) return;
  await new Promise((resolve) => {
    const input = h('input', { placeholder: info.dir, value: '' });
    const err = h('div', { class: 'err' });
    const root = document.getElementById('modal-root');
    const done = () => { obs.disconnect(); call('workspace:setupDone').catch(() => {}); resolve(); };
    const obs = new MutationObserver(() => { if (!root.firstChild) done(); }); // backdrop click = keep the default
    modal({
      title: 'Welcome to OrchestrAI',
      content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:460px' },
        h('div', {}, 'Where should OrchestrAI keep your workspaces and settings?'),
        h('div', { class: 'muted' }, 'You can pick a synced or backed-up folder, for example in Documents or Dropbox. Leave it empty to use the default location. You can move it later from Storage.'),
        h('div', { class: 'row' }, input, h('button', { onclick: async () => { const d = await call('workspace:pickFolder', 'Folder for OrchestrAI data'); if (d) input.value = d; } }, 'Browse')),
        err),
      actions: [
        { label: 'Use default', onClick: (c) => { c(); } },
        {
          label: 'Use this folder', primary: true, onClick: async () => {
            const dir = input.value.trim();
            if (!dir) { err.textContent = 'Choose a folder, or press Use default.'; return; }
            obs.disconnect();
            const r = await call('storage:move', { dir });
            if (!r.ok) { err.textContent = r.error; obs.observe(root, { childList: true }); return; }
            await call('workspace:setupDone');
            // The app restarts in the new folder; keep the dialog until it does.
            modal({ title: 'Setting up', content: h('div', {}, 'Restarting in the new folder…'), actions: [] });
          },
        },
      ],
    });
    obs.observe(root, { childList: true });
  });
}

// ---------- feedback ----------
const FEEDBACK_TYPES = [
  { id: 'bug', label: 'Bug report', gh: 'bug', hint: 'What happened, and what did you expect?' },
  { id: 'feature', label: 'Feature request', gh: 'enhancement', hint: 'What would you like to do that you cannot do now?' },
  { id: 'question', label: 'Question / other', gh: 'question', hint: 'What would you like to know or tell us?' },
];

async function feedbackDialog(preset) {
  let version = '';
  try { version = (await call('app:flags')).version; } catch {}
  const type = h('select', {}, FEEDBACK_TYPES.map((t) => h('option', { value: t.id }, t.label)));
  type.value = preset || 'bug';
  const title = h('input', { placeholder: 'Short summary' });
  const body = h('textarea', { rows: 7, style: 'width:100%;resize:vertical' });
  const env = h('input', { type: 'checkbox', checked: true });
  const sync = () => { body.placeholder = FEEDBACK_TYPES.find((t) => t.id === type.value).hint; };
  type.onchange = sync; sync();
  const envText = () => `\n\n---\nOrchestrAI ${version || '?'} · ${navigator.platform} · ${navigator.language}`;
  modal({
    title: 'Send feedback',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:480px' },
      h('div', { class: 'muted' }, 'This opens a prefilled GitHub issue in your browser. You review it and press Submit there; you need a GitHub account.'),
      h('label', {}, 'Type', type), h('label', {}, 'Title', title), h('label', {}, 'Details', body),
      h('label', { class: 'row' }, env, ' Include app version and system (no files, paths or terminal content)')),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Open on GitHub', primary: true, onClick: (c) => {
          if (!title.value.trim()) { title.focus(); return; }
          const t = FEEDBACK_TYPES.find((x) => x.id === type.value);
          const text = (body.value.trim() + (env.checked ? envText() : '')).slice(0, 6000); // keep the URL within browser limits
          const q = new URLSearchParams({ title: title.value.trim(), body: text, labels: t.gh });
          c();
          call('app:openExternal', `${REPO_URL}/issues/new?${q}`);
        },
      },
    ],
  });
}

document.getElementById('feedback-btn')?.addEventListener('click', () => feedbackDialog());
registerCommand({ id: 'send-feedback', label: 'Send feedback / report a bug…', run: () => feedbackDialog('bug') });
registerCommand({ id: 'request-feature', label: 'Request a feature…', run: () => feedbackDialog('feature') });

// ---------- star prompt ----------
// Kept in state.settings.engagement so it is saved with the workspace: { first, snoozeUntil, never }.
function engagement() {
  const s = (state.settings.engagement = state.settings.engagement || {});
  if (!s.first) { s.first = Date.now(); save(); }
  return s;
}

function maybeAskForStar() {
  if (!state?.settings || window.orchestraiNoStarPrompt) return;
  const e = engagement();
  const now = Date.now();
  if (e.never || now - e.first < STAR_AFTER_DAYS * DAY || now < (e.snoozeUntil || 0)) return;
  const close = () => card.remove();
  const card = h('div', { id: 'star-card', class: 'toast-card', style: 'position:fixed;right:16px;bottom:16px;z-index:9000;max-width:320px;padding:14px;border-radius:10px;background:var(--panel,#2c2c2e);border:1px solid var(--border,#444);box-shadow:0 6px 24px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:8px' },
    h('strong', {}, 'Enjoying OrchestrAI?'),
    h('div', { class: 'muted' }, 'If it is useful to you, a star on GitHub helps other people find it.'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'primary', onclick() { e.never = true; save(); close(); call('app:openExternal', REPO_URL); } }, '★ Star on GitHub'),
      h('button', { onclick() { e.snoozeUntil = Date.now() + STAR_SNOOZE_DAYS * DAY; save(); close(); } }, 'Later'),
      h('button', { onclick() { e.never = true; save(); close(); } }, 'No thanks')));
  document.body.append(card);
}
setTimeout(maybeAskForStar, STAR_DELAY_MS);
