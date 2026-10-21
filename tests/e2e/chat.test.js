// Chat node: each message runs the command with the prompt on stdin and streams stdout back into the conversation.
const fs = require('fs'), os = require('os'), path = require('path');

module.exports = async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-chat-'));
  const echo = path.join(dir, 'echo.js').split(path.sep).join('/');
  const fail = path.join(dir, 'fail.js').split(path.sep).join('/');
  const slow = path.join(dir, 'slow.js').split(path.sep).join('/');
  fs.writeFileSync(echo, "let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => console.log('ECHO:' + s.trim()));");
  fs.writeFileSync(fail, "process.stdin.resume(); process.stdin.on('end', () => process.exit(3));");
  fs.writeFileSync(slow, "process.stdin.resume(); console.log('started'); setInterval(() => {}, 1000);");

  const id = await t.js(`addNode('chat', { title: 'Talk', data: { command: 'node "${echo}"' } }, activeFloor()).id`);
  const live = (code) => t.js(`(() => { const e = rt.get(state.active).live.get('${id}'); return ${code}; })()`);
  const texts = () => live(`[...e.el.querySelectorAll('.msgs .msg')].map((m) => m.className + '|' + m.textContent)`);
  const waitFor = async (pred, ms = 15000) => { for (let i = 0; i < ms / 200; i++) { if (await pred()) return true; await t.sleep(200); } return false; };
  const setCommand = (c) => live(`(() => { const i = e.el.querySelector('input'); i.value = ${JSON.stringify(c)}; i.dispatchEvent(new Event('change')); return 0; })()`);

  // ---- a message gets an answer ----
  await live(`e.api.send('hello agent')`);
  t.check('the answer streams in', await waitFor(async () => (await texts()).some((m) => m.startsWith('msg agent|ECHO:hello agent'))), await texts());
  t.check('the user message is shown', (await texts()).some((m) => m === 'msg user|hello agent'));
  t.check('the button returns to Send when done', await waitFor(async () => (await live(`e.el.querySelector('button.primary')?.textContent`)) === 'Send'));

  // ---- typing and Enter ----
  await live(`(() => { const ta = e.el.querySelector('textarea'); ta.value = 'via textarea'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 0; })()`);
  t.check('Enter in the box sends', await waitFor(async () => (await texts()).some((m) => m.includes('ECHO:via textarea'))), await texts());
  await live(`(() => { const ta = e.el.querySelector('textarea'); ta.value = 'kept'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); return 0; })()`);
  await t.sleep(400);
  t.check('Shift+Enter does not send', !(await texts()).some((m) => m.includes('ECHO:kept')) && (await live(`e.el.querySelector('textarea').value`)) === 'kept');
  await live(`(() => { e.el.querySelector('textarea').value = ''; return 0; })()`);

  // ---- the conversation is saved with the workspace ----
  const saved = await t.readSaved((w) => JSON.stringify(w).includes('via textarea'));
  const node = saved.workspaces[0].floors.flatMap((f) => f.nodes).find((n) => n.id === id);
  t.check('messages are persisted', node && node.data.messages.length >= 4 && node.data.messages.some((m) => m.role === 'agent' && m.text.includes('ECHO:hello agent')), node && node.data);

  // ---- the command can be changed and is saved ----
  await setCommand(`node "${fail}"`);
  t.check('the command change is stored', (await live(`state.floors.flatMap((f) => f.nodes).find((n) => n.id === '${id}').data.command`)).includes('fail.js'));
  await live(`e.api.send('boom')`);
  t.check('a failing command shows its exit code', await waitFor(async () => (await texts()).some((m) => m.includes('(exited with code 3)'))), await texts());

  // ---- a missing command reports an error instead of hanging ----
  await setCommand('definitely-not-a-real-command-xyz');
  await live(`e.api.send('anything')`);
  t.check('an unknown command ends the turn', await waitFor(async () => (await live(`e.el.querySelector('button.primary')?.textContent`)) === 'Send'));

  // ---- Stop interrupts a running turn ----
  await setCommand(`node "${slow}"`);
  await live(`e.api.send('long task')`);
  t.check('while running the button says Stop', await waitFor(async () => (await live(`[...e.el.querySelectorAll('button')].some((b) => b.textContent === 'Stop')`))));
  await live(`[...e.el.querySelectorAll('button')].find((b) => b.textContent === 'Stop').click()`);
  t.check('Stop ends the turn', await waitFor(async () => (await live(`[...e.el.querySelectorAll('button')].some((b) => b.textContent === 'Send')`))), await texts());

  // ---- clear ----
  await live(`[...e.el.querySelectorAll('.head button, button')].find((b) => b.title === 'Clear conversation').click()`);
  await t.sleep(300);
  t.check('Clear empties the conversation', (await texts()).length === 0 && (await live(`state.floors.flatMap((f) => f.nodes).find((n) => n.id === '${id}').data.messages.length`)) === 0);

  fs.rmSync(dir, { recursive: true, force: true });
};
