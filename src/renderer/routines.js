// Routines UI: list, create/edit, run now, history. The scheduler itself runs in the main process (services/routines.js);
// this file types a due routine into its target terminal and reports the outcome.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeSchedule(s) {
  switch (s?.kind) {
    case 'once': return 'Once, ' + new Date(s.at).toLocaleString();
    case 'every': return s.minutes % 60 === 0 ? `Every ${s.minutes / 60} h` : `Every ${s.minutes} min`;
    case 'daily': return `Daily at ${s.time}`;
    case 'weekly': return `${s.days.map((d) => DAY_NAMES[d]).join(' ')} at ${s.time}`;
  }
  return '';
}

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

// Type the routine's text into its target (or a freshly created terminal) and report back.
async function runRoutine(routine) {
  const t = routine.target || {};
  let entry, label;
  if (t.terminalId) {
    const hit = allTerminals().find((x) => x.node.id === t.terminalId);
    if (!hit) return { outcome: 'failed', snippet: 'Target terminal no longer exists' };
    entry = hit.entry; label = hit.node.title;
  } else {
    const f = activeFloor();
    const node = addNode('terminal', { title: t.newTerminal?.name || routine.name, data: { command: t.newTerminal?.command || '', monitor: true } }, f);
    // Give the shell (and the agent it starts) time to come up before typing into it.
    await new Promise((r) => setTimeout(r, 2500));
    entry = rt.get(f.id)?.live.get(node.id); label = node.title;
  }
  if (!entry) return { outcome: 'failed', snippet: 'Target terminal is not running' };
  if (routine.text) await entry.api.send(routine.text);
  return { outcome: 'ok', snippet: `${routine.text ? 'Sent to' : 'Started'} ${label}: ${routine.text.slice(0, 100)}` };
}

api.on('routines:fire', async ({ runId, routine }) => {
  let res;
  try { res = await runRoutine(routine); } catch (e) { res = { outcome: 'failed', snippet: String(e.message || e) }; }
  call('routines:result', { runId, ...res });
});

// ---------- dialog ----------
function routineDialog(existing, done) {
  const r = existing || { name: '', text: '', target: { terminalId: allTerminals().find((t) => t.floor.id === state.active)?.node.id || '' }, schedule: { kind: 'daily', time: '09:00' }, enabled: true };
  const name = h('input', { value: r.name, placeholder: 'e.g. Morning triage' });
  const targets = allTerminals();
  const targetSel = h('select', {}, ...targets.map((t) => h('option', { value: t.node.id }, `${t.floor.name} / ${t.node.title}`)), h('option', { value: '__new' }, 'A new terminal…'));
  targetSel.value = r.target.newTerminal ? '__new' : (r.target.terminalId || (targets[0]?.node.id ?? '__new'));
  const newName = h('input', { value: r.target.newTerminal?.name || '', placeholder: 'Terminal name' });
  const newCmd = h('input', { value: r.target.newTerminal?.command || '', placeholder: 'Command, e.g. claude' });
  const newBox = h('div', { class: 'row' }, newName, newCmd);
  const text = h('textarea', { rows: 4, placeholder: 'Prompt or command to type into the terminal (Enter is pressed afterwards)' });
  text.value = r.text;
  const kindSel = h('select', {}, ...[['once', 'Once'], ['every', 'Every N minutes'], ['daily', 'Daily'], ['weekly', 'Weekly']].map(([v, l]) => h('option', { value: v }, l)));
  kindSel.value = r.schedule.kind;
  const s = r.schedule;
  const onceIn = h('input', { type: 'datetime-local', value: toLocalInput(s.kind === 'once' ? s.at : Date.now() + 3600000) });
  const everyIn = h('input', { type: 'number', min: 1, value: s.kind === 'every' ? s.minutes : 60, style: 'width:90px' });
  const timeIn = h('input', { type: 'time', value: s.time || '09:00' });
  const days = DAY_NAMES.map((d, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.kind === 'weekly' ? s.days.includes(i) : i >= 1 && i <= 5, 'data-day': i }), d));
  const sched = h('div', { class: 'row' });
  const err = h('div', { class: 'err' });
  const sync = () => {
    newBox.style.display = targetSel.value === '__new' ? '' : 'none';
    const k = kindSel.value;
    sched.replaceChildren(k === 'once' ? onceIn : null, k === 'every' ? h('span', {}, 'every ', everyIn, ' minutes') : null,
      k === 'daily' || k === 'weekly' ? timeIn : null, k === 'weekly' ? h('div', { class: 'row' }, ...days) : null);
  };
  targetSel.onchange = kindSel.onchange = sync;
  sync();
  modal({
    title: existing ? 'Edit routine' : 'New routine',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('label', {}, 'Name', name), h('label', {}, 'Runs in', targetSel), newBox, h('label', {}, 'Text', text), h('label', {}, 'Schedule', kindSel), sched, err),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Save', primary: true, onClick: async (c) => {
          const k = kindSel.value;
          const schedule = k === 'once' ? { kind: 'once', at: new Date(onceIn.value).getTime() }
            : k === 'every' ? { kind: 'every', minutes: Number(everyIn.value) }
              : k === 'daily' ? { kind: 'daily', time: timeIn.value }
                : { kind: 'weekly', time: timeIn.value, days: days.map((l, i) => (l.querySelector('input').checked ? i : -1)).filter((i) => i >= 0) };
          const target = targetSel.value === '__new' ? { newTerminal: { name: newName.value.trim(), command: newCmd.value.trim() } } : { terminalId: targetSel.value };
          const res = await call('routines:save', { id: existing?.id, name: name.value, text: text.value, target, schedule, enabled: existing ? existing.enabled : true });
          if (!res.ok) { err.textContent = res.error; return; }
          c();
          done?.();
        },
      },
    ],
  });
}

// ---------- panel ----------
async function routinesDialog() {
  const { routines, history } = await call('routines:list');
  const termName = (r) => (r.target.newTerminal ? `new terminal${r.target.newTerminal.command ? ' (' + r.target.newTerminal.command + ')' : ''}`
    : (allTerminals().find((t) => t.node.id === r.target.terminalId)?.node.title || 'missing terminal'));
  const reopen = () => { closeModal(); routinesDialog(); };
  const list = routines.length ? routines.map((r) => h('div', { class: 'routine-row' + (r.enabled ? '' : ' off'), 'data-id': r.id },
    h('input', { type: 'checkbox', checked: r.enabled, title: 'Enabled', style: 'flex:none', onchange: async (e) => { const res = await call('routines:toggle', r.id, e.target.checked); if (!res.ok) alertModal('Routine', res.error); reopen(); } }),
    h('div', { class: 'routine-main' },
      h('div', {}, h('b', {}, r.name), h('span', { class: 'muted' }, ` → ${termName(r)}`)),
      h('div', { class: 'muted' }, `${describeSchedule(r.schedule)} · ${r.enabled ? 'next ' + fmtDate(r.nextRun) : 'off'} · last ${fmtDate(r.lastRun)}`),
      r.text ? h('div', { class: 'mono routine-text' }, r.text) : null),
    h('button', { onclick: () => call('routines:runNow', r.id).then(() => setTimeout(reopen, 600)) }, 'Run now'),
    h('button', { onclick: () => { closeModal(); routineDialog(r, routinesDialog); } }, 'Edit'),
    h('button', { class: 'danger', onclick: async () => { if (await confirmModal('Delete routine', `Delete "${r.name}"?`, 'Delete')) { await call('routines:remove', r.id); } reopen(); } }, '✕')))
    : [h('div', { class: 'muted', style: 'padding:6px' }, 'No routines yet. A routine types a prompt or command into a terminal on a schedule.')];
  const hist = history.length ? history.slice(0, 50).map((x) => h('div', { class: 'routine-hist ' + x.outcome },
    h('span', { class: 'rh-out' }, x.outcome), h('span', {}, fmtDate(x.at)), h('b', {}, x.name), h('span', { class: 'muted rh-snip' }, x.snippet)))
    : [h('div', { class: 'muted', style: 'padding:6px' }, 'No runs yet.')];
  modal({
    title: 'Routines',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:560px' },
      h('div', { class: 'scroll bordered', style: 'max-height:240px' }, list),
      h('div', { class: 'row' }, h('strong', {}, 'History'), h('button', { style: 'margin-left:auto', onclick: async () => { await call('routines:clearHistory'); reopen(); } }, 'Clear')),
      h('div', { class: 'scroll bordered', style: 'max-height:180px' }, hist),
      h('div', { class: 'muted' }, 'Routines fire while the app runs, even when the window is hidden in the tray. Runs missed while the app was closed are not replayed.')),
    actions: [{ label: 'New routine…', onClick: () => { closeModal(); routineDialog(null, routinesDialog); } }, { label: 'Close', primary: true, onClick: (c) => c() }],
  });
}

document.getElementById('routines-btn').onclick = routinesDialog;
registerCommand({ id: 'routines', label: 'Routines…', run: routinesDialog });
