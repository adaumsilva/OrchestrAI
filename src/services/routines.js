// Routines: scheduled prompts or commands for terminals. The scheduler lives in the main process so routines keep firing
// while the window is hidden in the tray. A due routine is sent to the renderer ('routines:fire'), which types it into the
// target terminal and reports the outcome back ('routines:result'). Runs that came due while the app was closed or asleep
// are never replayed: they are recorded as "missed" and the routine moves on to its next slot.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const schedule = require('./schedule');

const MISS_GRACE_MS = 2 * 60 * 1000;
const HISTORY_MAX = 200;
const file = () => path.join(app.getPath('userData'), 'routines.json');

let db = { routines: [], history: [] };
let timer = null;
let getWin = () => null;
const inflight = new Map(); // runId -> { routineId, timer }

const uid = () => crypto.randomBytes(4).toString('hex');

function load() {
  try { db = { routines: [], history: [], ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { db = { routines: [], history: [] }; }
}
function persist() {
  try { fs.writeFileSync(file(), JSON.stringify(db)); } catch {}
  try { getWin()?.webContents.send('routines:changed'); } catch {}
}
function record(r, outcome, snippet = '') {
  db.history.unshift({ id: uid(), routineId: r.id, name: r.name, at: Date.now(), outcome, snippet: String(snippet).slice(0, 200) });
  db.history.length = Math.min(db.history.length, HISTORY_MAX);
}

// Move a routine to its next slot after `from`; one-shot routines switch themselves off.
function advance(r, from) {
  r.nextRun = schedule.nextRun(r.schedule, from);
  if (r.nextRun == null) r.enabled = false;
}

function fire(r, manual) {
  const win = getWin();
  const runId = uid();
  r.lastRun = Date.now();
  if (!win || win.isDestroyed()) { record(r, 'failed', 'The window is not available'); return; }
  inflight.set(runId, { routineId: r.id, timer: setTimeout(() => { inflight.delete(runId); record(r, 'failed', 'No answer from the window'); persist(); }, 30000) });
  win.webContents.send('routines:fire', { runId, manual: !!manual, routine: r });
}

function tick(now = Date.now()) {
  let changed = false;
  for (const r of db.routines) {
    if (!r.enabled || r.nextRun == null || r.nextRun > now) continue;
    changed = true;
    if (now - r.nextRun > MISS_GRACE_MS) { record(r, 'missed', `Was due ${new Date(r.nextRun).toLocaleString()}`); advance(r, now); }
    else { advance(r, now); fire(r, false); }
  }
  if (changed) persist();
  return changed;
}

function upsert(input) {
  const err = schedule.validate(input.schedule);
  if (err) return { ok: false, error: err };
  if (!String(input.name || '').trim()) return { ok: false, error: 'Give the routine a name' };
  if (!input.target || (!input.target.terminalId && !input.target.newTerminal)) return { ok: false, error: 'Choose a target terminal' };
  const now = Date.now();
  let r = db.routines.find((x) => x.id === input.id);
  const isNew = !r;
  if (isNew) r = { id: uid(), created: now };
  const wantEnabled = input.enabled !== false;
  const next = {
    name: String(input.name).trim(), text: String(input.text || ''), target: input.target, enabled: wantEnabled,
    schedule: input.schedule.kind === 'every' ? { ...input.schedule, anchor: input.schedule.anchor ?? now } : input.schedule,
  };
  if (wantEnabled && schedule.nextRun(next.schedule, now) == null) return { ok: false, error: 'That time is already in the past' };
  Object.assign(r, next);
  if (isNew) db.routines.push(r);
  advance(r, now);
  persist();
  return { ok: true, routine: r };
}

function register(ipcMain, winGetter) {
  getWin = winGetter;
  load();
  // Catch-up on start: anything overdue is "missed", never replayed.
  const now = Date.now();
  for (const r of db.routines) {
    if (r.enabled && r.nextRun != null && r.nextRun <= now) { record(r, 'missed', `Was due ${new Date(r.nextRun).toLocaleString()}`); advance(r, now); }
  }
  persist();
  timer = setInterval(tick, 10000);

  ipcMain.handle('routines:list', () => ({ routines: db.routines, history: db.history }));
  ipcMain.handle('routines:save', (_e, input) => upsert(input || {}));
  ipcMain.handle('routines:remove', (_e, id) => { db.routines = db.routines.filter((r) => r.id !== id); persist(); return true; });
  ipcMain.handle('routines:toggle', (_e, id, enabled) => {
    const r = db.routines.find((x) => x.id === id);
    if (!r) return { ok: false, error: 'No such routine' };
    r.enabled = !!enabled;
    if (r.enabled) {
      advance(r, Date.now());
      if (r.nextRun == null) { persist(); return { ok: false, error: 'No upcoming run for this schedule' }; }
    }
    persist();
    return { ok: true };
  });
  ipcMain.handle('routines:runNow', (_e, id) => {
    const r = db.routines.find((x) => x.id === id);
    if (!r) return { ok: false, error: 'No such routine' };
    fire(r, true);
    persist();
    return { ok: true };
  });
  ipcMain.handle('routines:result', (_e, { runId, outcome, snippet }) => {
    const run = inflight.get(runId);
    if (!run) return false;
    clearTimeout(run.timer);
    inflight.delete(runId);
    const r = db.routines.find((x) => x.id === run.routineId);
    record(r || { id: run.routineId, name: '(deleted)' }, outcome === 'ok' ? 'ok' : 'failed', snippet);
    persist();
    return true;
  });
  ipcMain.handle('routines:clearHistory', () => { db.history = []; persist(); return true; });
}

function stop() { clearInterval(timer); }

module.exports = { register, stop, tick, _db: () => db };
