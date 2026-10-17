const fs = require('fs'), path = require('path');
const { app } = require('electron');

module.exports = async (t) => {
  const win = t.win;
  const call = (ch, ...a) => t.js(`window.orchestrai.call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`); // works on the recovery page too
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitFor = async (fn, ms = 15000) => { for (let i = 0; i < ms / 200; i++) { try { if (await fn()) return true; } catch {} await t.sleep(200); } return false; };

  // ---- things that must never reach a report ----
  process.env.ORCH_FAKE_SECRET = 'sk-ant-api03-ENVSECRET1234567890abcd';
  await t.js(`(() => {
    const f = activeFloor();
    addNode('note', { title: 'Private note', x: 60, y: 60, data: { text: 'TOP SECRET CONTENTS of a note' } }, f);
    addNode('terminal', { title: 'Keyed', x: 700, y: 60, data: { command: 'claude --api-key sk-test-COMMANDKEY123456789' } }, f);
    console.error('request failed with token sk-ant-api03-LOGLEAK1234567890abcd for user');
    return 0;
  })()`);

  // ---- a shell that must survive the crash: it remembers a variable ----
  const term = await t.js(`activeFloor().nodes.find((n) => n.kind === 'terminal' && n.title !== 'Keyed').id`);
  const isWin = process.platform === 'win32';
  await t.sleep(2500);
  await t.js(`rt.get(state.active).live.get('${term}').api.send(${JSON.stringify(isWin ? '$global:marker = "alive-" + (6*7)' : 'marker=alive-$((6*7))')}); 0`);
  await t.sleep(800);
  const before = await call('app:ptyCount');
  t.check('terminals are running before the crash', before >= 2, before);

  // ---- crash the interface ----
  win.webContents.forcefullyCrashRenderer();
  const recovered = await waitFor(() => /recovery\.html/.test(win.webContents.getURL()));
  t.check('a renderer crash shows the recovery screen', recovered, win.webContents.getURL());
  await t.sleep(800);
  const page = await t.js(`({ title: document.getElementById('title').textContent, reason: document.getElementById('reason').textContent, terminals: document.getElementById('terminals').textContent, buttons: [...document.querySelectorAll('button')].map((b) => b.textContent) })`);
  t.check('it explains what happened and that terminals are still running', /stopped/i.test(page.title) && /crashed|killed|stopped/i.test(page.reason) && /still running/.test(page.terminals), page);
  t.check('it offers Reload and a diagnostic report', page.buttons.includes('Reload') && /diagnostic/i.test(page.buttons.join()), page.buttons);
  t.check('the terminal processes are still alive', (await call('app:ptyCount')) === before);

  // ---- diagnostic report ----
  const out = path.join(t.dataDir, 'diag.json');
  const r = await call('app:saveDiagnostics', { path: out });
  t.check('the report is written', r.path === out && fs.existsSync(out), r);
  const raw = fs.readFileSync(out, 'utf8');
  const rep = JSON.parse(raw);
  t.check('it holds versions, system info and counts', rep.versions.electron && rep.system.platform && rep.app.version === app.getVersion() && rep.workspace.terminals >= 2 && rep.workspace.nodes.note >= 1 && rep.runningTerminals === before, { versions: rep.versions, ws: rep.workspace });
  t.check('it carries recent warnings, redacted', rep.recentLog.some((l) => /renderer gone/.test(l.message)) && rep.recentLog.some((l) => /request failed with token \[redacted\]/.test(l.message)), rep.recentLog.slice(-3));
  const leaks = ['ENVSECRET', 'LOGLEAK', 'COMMANDKEY', 'TOP SECRET', 'Private note', 'Keyed', '--api-key', 'sk-ant', 'sk-test'].filter((x) => raw.includes(x));
  t.check('it contains no tokens, commands, titles or note text', leaks.length === 0, leaks);
  t.check('it lists no environment variables', !/ORCH_FAKE_SECRET|\bPATH\b|USERPROFILE/.test(raw));

  // ---- reload and reconnect ----
  await t.js(`window.orchestrai.call('app:reloadApp'); 0`);
  const back = await waitFor(() => /index\.html/.test(win.webContents.getURL()) && win.webContents.executeJavaScript('typeof state !== "undefined" && rt.size > 0'), 20000);
  t.check('Reload brings the interface back', back, win.webContents.getURL());
  await t.sleep(3500);
  await t.js(`rt.get(state.active).live.get('${term}').api.send(${JSON.stringify(isWin ? 'echo ("AFTER:" + $global:marker)' : 'echo "AFTER:$marker"')}); 0`);
  await t.sleep(1500);
  const screen = await t.js(`rt.get(state.active).live.get('${term}').api.readScreen()`);
  t.check('the same shell process answers after the reload (its variable survived)', /AFTER:alive-42/.test(screen), screen.slice(-300));

  // ---- fault banner ----
  await t.js(`setTimeout(() => { throw new Error('boom in the interface'); }, 10); 0`);
  await t.sleep(600);
  t.check('an uncaught interface error shows a banner that offers reload and a report', await t.js(`!!document.querySelector('.fault-bar') && /terminals are still running/.test(document.querySelector('.fault-bar').innerText) && [...document.querySelectorAll('.fault-bar button')].some((b) => b.textContent === 'Reload')`));
  const diag = await call('app:diagnostics');
  t.check('the error reached the report log', diag.recentLog.some((l) => /boom in the interface/.test(l.message)));
  await t.js(`document.querySelector('.fault-bar')?.remove(); 0`);
  await t.js(`setTimeout(() => { throw new Error('ResizeObserver loop completed with undelivered notifications.'); }, 10); 0`);

  // ---- first-run tour ----
  t.check('a profile with one floor and at most one node counts as fresh; the tour is suppressed in tests', await t.js(`isFreshWorkspace({ workspaces: [{ floors: [{ nodes: [{}] }] }] }) && !isFreshWorkspace({ workspaces: [{ floors: [{ nodes: [{}, {}] }] }] }) && !isFreshWorkspace({ workspaces: [{ floors: [{ nodes: [] }, { nodes: [] }] }] })`) && (await call('app:flags')).noOnboarding === true);
  await t.js(`state.settings.onboarded = false; startTour(); 0`);
  await t.sleep(300);
  const step = async () => t.js(`({ title: document.querySelector('.tour-card h2')?.textContent, on: [...document.querySelectorAll('.tour-dots span')].findIndex((s) => s.classList.contains('on')), buttons: [...document.querySelectorAll('.tour-card button')].map((b) => b.textContent) })`);
  const click = (label) => t.js(`[...document.querySelectorAll('.tour-card button')].find((b) => b.textContent === ${JSON.stringify(label)}).click(); 0`);
  let s1 = await step();
  t.check('the tour has three steps starting with a welcome', s1.on === 0 && /Welcome/.test(s1.title) && s1.buttons.join() === 'Skip,Next', s1);
  await click('Next'); const s2 = await step();
  await click('Next'); const s3 = await step();
  t.check('it walks through connecting and directing agents', /Connect/.test(s2.title) && /Direct/.test(s3.title) && s3.buttons.includes('Get started') && s3.buttons.includes('Back'), { s2, s3 });
  await click('Back');
  t.check('Back goes to the previous step', (await step()).on === 1);
  await click('Next'); await click('Get started');
  t.check('finishing closes the tour and remembers it', await t.js(`!document.querySelector('.tour-overlay') && state.settings.onboarded === true`));
  await t.js(`state.settings.onboarded = false; startTour(); 0`);
  await t.sleep(200);
  await click('Skip');
  t.check('Skip also closes it for good', await t.js(`!document.querySelector('.tour-overlay') && state.settings.onboarded === true`));
  await t.js(`state.settings.onboarded = false; addNode('note', { x: 10, y: 10 }, activeFloor()); addNode('note', { x: 10, y: 400 }, activeFloor()); maybeStartTour({ noOnboarding: false }); 0`);
  await t.sleep(400);
  t.check('a profile that already has content never gets the tour on its own', await t.js(`!document.querySelector('.tour-overlay') && state.settings.onboarded === true && isFreshWorkspace() === false`));

  // ---- updates ----
  const dev = await call('updates:check');
  t.check('from source, updates say so instead of pretending', dev.status === 'dev', dev);
  process.env.ORCH_UPDATER_MODULE = path.join(__dirname, 'fake-updater.js');
  const fake = require('./fake-updater.js');
  await call('updates:check');
  t.check('a check reports the available version with plain-text notes', await waitFor(async () => (await call('updates:status')).status === 'available'));
  const st = await call('updates:status');
  t.check('release notes are stripped of markup and scripts', st.version === '9.9.9' && /New stuff & fixes/.test(st.notes) && !/[<>]|alert\(1\)/.test(st.notes) && /One/.test(st.notes), st.notes);
  t.check('auto-download is turned off', fake.autoDownload === false && fake.autoInstallOnAppQuit === false);
  t.check('nothing is downloaded until asked', !fake.calls.includes('download'));
  await t.js(`updatesDialog(); 0`);
  await t.sleep(500);
  const ud = await t.js(`document.querySelector('#modal-root').innerText`);
  t.check('the dialog shows the version, notes and a Download button', /9\.9\.9/.test(ud) && /Two/.test(ud) && /Download/.test(ud), ud);
  await t.js(`[...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Download').click(); 0`);
  t.check('download progresses to ready', await waitFor(async () => (await call('updates:status')).status === 'ready'));
  await t.sleep(400);
  t.check('the dialog now offers Install and restart', await t.js(`[...document.querySelectorAll('#modal-root button')].some((b) => b.textContent === 'Install and restart')`));
  t.check('installing is refused unless an update is ready, and works when it is', (await call('updates:install')) === true);
  await t.sleep(500);
  t.check('quitAndInstall was invoked', global.__fakeInstalled === true);
  await t.js(`closeModal(); 0`);
  // background check
  fake.calls.length = 0;
  process.env.ORCH_UPDATE_DELAY_MS = '150';
  await call('updates:setAuto', true);
  t.check('the automatic check runs on its own and still never downloads', await waitFor(() => fake.calls.includes('check'), 5000) && !fake.calls.includes('download'));
  await call('updates:setAuto', false);
  delete process.env.ORCH_UPDATER_MODULE;
};
