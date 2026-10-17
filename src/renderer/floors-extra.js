// Floor management beyond create/rename/land: duplicate, status, dry-run landing, hook run history, progress.

const FLOOR_STATES = ['working', 'waiting', 'blocked', 'done'];

// ---------- progress ----------
// Shows a non-dismissable "working" dialog while an async step runs; failures come back as a message, not a hang.
async function withProgress(title, label, fn) {
  const box = modal({ title, content: h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { class: 'progress-label' }, label)), actions: [] });
  document.getElementById('modal-root').onmousedown = null;
  try { return await fn((text) => { const el = box.querySelector('.progress-label'); if (el) el.textContent = text; }); }
  finally { closeModal(); }
}

// ---------- status ----------
function setFloorStatus(f, text, state) {
  text = String(text || '').trim().slice(0, 140);
  if (state && !FLOOR_STATES.includes(state)) throw new Error(`State must be one of: ${FLOOR_STATES.join(', ')}.`);
  f.status = text ? { text, state: state || 'working', at: Date.now() } : null;
  renderTabs();
  save();
}

function floorStatusBadge(f) {
  if (!f.status) return null;
  return h('span', { class: 'floor-status ' + f.status.state, title: `${f.status.text}\n${new Date(f.status.at).toLocaleString()}`, onclick: (e) => { e.stopPropagation(); floorStatusDialog(f); } },
    f.status.text.length > 22 ? f.status.text.slice(0, 21) + '…' : f.status.text);
}

function floorStatusDialog(f) {
  const text = h('input', { value: f.status?.text || '', placeholder: 'What is happening on this floor?' });
  const st = h('select', {}, FLOOR_STATES.map((s) => h('option', { value: s, selected: s === (f.status?.state || 'working') }, s)));
  modal({
    title: `Status of ${f.name}`,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('label', {}, 'Text', text), h('label', {}, 'State', st),
      h('div', { class: 'muted' }, 'Agents can set this with “orchestrai floor-status”.')),
    actions: [
      { label: 'Clear', onClick: (c) => { setFloorStatus(f, ''); c(); } },
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save', primary: true, onClick: (c) => { setFloorStatus(f, text.value, st.value); c(); } },
    ],
  });
}

// ---------- duplicate ----------
// Copies the layout (nodes, ropes, groups, settings) with fresh ids. No process is carried over: terminals start new and
// scrollback is keyed by node id, so the copy begins empty.
async function duplicateFloor(f, { worktree = false } = {}) {
  const copy = cloneFloors([f])[0];
  copy.name = `${f.name} copy`;
  copy.status = null;
  copy.view = { ...f.view };
  if (worktree && f.repo) {
    const root = await call('app:worktreeRoot');
    const r = await withProgress('Duplicate floor', 'Creating a worktree…', () => call('git:worktreeAdd', f.repo, { name: copy.name, root }));
    if (!r.ok) { alertModal('Could not create worktree', r.err); return null; }
    copy.repo = r.repo; copy.branch = r.branch; copy.dir = r.dir;
  } else if (f.repo) {
    // Sharing a worktree between floors would make landing ambiguous, so the copy is an ordinary floor on that folder.
    copy.repo = null; copy.branch = null;
  }
  const at = state.floors.indexOf(f);
  state.floors.splice(at + 1, 0, copy);
  mountFloor(copy);
  switchFloor(copy.id);
  save();
  return copy;
}

function duplicateFloorDialog(f) {
  if (!f.repo) { duplicateFloor(f); return; }
  modal({
    title: `Duplicate ${f.name}`,
    content: h('div', { class: 'muted' }, 'This floor is an isolated worktree. The copy can get its own worktree and branch, or share the folder as an ordinary floor.'),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Same folder', onClick: (c) => { c(); duplicateFloor(f); } },
      { label: 'New worktree', primary: true, onClick: (c) => { c(); duplicateFloor(f, { worktree: true }); } },
    ],
  });
}

// ---------- dry-run landing ----------
async function testLanding(f) {
  const r = await withProgress('Test landing', 'Merging in a temporary worktree…', () => call('git:landDryRun', { repo: f.repo, branch: f.branch }));
  const body = !r.ok ? h('div', { class: 'err' }, r.err)
    : r.clean ? h('div', {}, `Clean merge. ${r.changed.length} file(s) would change.`, r.changed.length ? h('div', { class: 'mono muted scroll', style: 'max-height:160px' }, r.changed.join('\n')) : null,
      h('div', { class: 'muted' }, 'Only committed work is tested; the base checkout was not touched.'))
      : h('div', {}, h('div', { class: 'err' }, `${r.conflicts.length} conflicting file(s):`), h('div', { class: 'mono scroll', style: 'max-height:160px' }, r.conflicts.join('\n') || r.message),
        h('div', { class: 'muted' }, 'The base checkout was not touched.'));
  modal({ title: `Test landing ${f.name}`, content: body, actions: [{ label: 'OK', primary: true, onClick: (c) => c() }] });
  return r;
}

// ---------- hook run history ----------
function recordHookRun(f, name, command, res) {
  f.hookRuns ||= [];
  f.hookRuns.unshift({ name, command, code: res.code, timedOut: !!res.timedOut, output: res.output, at: Date.now() });
  f.hookRuns.length = Math.min(f.hookRuns.length, 20);
  save();
}

async function runHookRecorded(f, name, command) {
  const res = await call('app:runHook', { cwd: f.dir, command });
  recordHookRun(f, name, command, res);
  return res;
}

function hookHistoryEl(f) {
  const runs = f.hookRuns || [];
  const out = h('pre', { class: 'mono bordered scroll', style: 'max-height:140px;display:none;margin:0' });
  return h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
    h('div', { class: 'muted' }, 'Run history'),
    runs.length ? runs.map((r) => h('div', {
      class: 'change hook-run', onclick: () => { out.style.display = ''; out.textContent = (r.timedOut ? '[timed out]\n' : '') + (r.output.trim() || '(no output)') + `\n\nexit code ${r.code}`; },
    }, h('span', { class: 'st' + (r.code === 0 ? '' : ' err') }, r.code === 0 ? '✓' : '✗'), h('span', {}, `${r.name}: ${r.command}`),
      h('span', { class: 'muted', style: 'margin-left:auto' }, new Date(r.at).toLocaleTimeString()))) : h('div', { class: 'muted' }, 'No runs yet.'),
    out);
}
