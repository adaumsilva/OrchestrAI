// Prompter: @ completion, long pastes collapsing into a chip, attachments and delivery to the chosen targets.
module.exports = async (t) => {
  const ids = await t.js(`(() => {
    const f = activeFloor();
    return { a: addNode('terminal', { title: 'Alpha Agent', data: {} }, f).id, b: addNode('terminal', { title: 'Beta', data: {} }, f).id, floor: f.id };
  })()`);
  await t.sleep(2000);
  // Capture what each terminal would receive instead of typing into a shell.
  await t.js(`(() => { window.__got = {}; for (const id of ['${ids.a}', '${ids.b}']) { const api = rt.get('${ids.floor}').live.get(id).api; api.send = (text) => { (window.__got[id] ||= []).push(text); }; } return 0; })()`);
  const dlg = (code) => t.js(`(() => { const p = window.__p; return ${code}; })()`);
  const open = (args = '') => t.js(`(() => { window.__p = prompterDialog({ floor: activeFloor()${args} }); return 0; })()`);
  const close = () => t.js(`(() => { closeModal(); return 0; })()`);

  // ---- targets ----
  await open(`, targets: ['${ids.a}']`);
  t.check('the dialog opens with the given target ticked', await t.js(`[...document.querySelectorAll('.prompter-targets input')].filter((i) => i.checked).map((i) => i.dataset.id).join()`) === ids.a);

  // ---- @ completion ----
  await dlg(`(() => { p.ta.value = 'ask @Alp'; p.ta.selectionStart = p.ta.selectionEnd = p.ta.value.length; p.ta.dispatchEvent(new Event('input')); return 0; })()`);
  await t.sleep(300);
  const items = await t.js(`[...document.querySelectorAll('.prompter-complete .item .lbl')].map((e) => e.textContent)`);
  t.check('@ lists matching terminals', items.includes('Alpha Agent') && !items.includes('Beta'), items);
  await dlg(`(() => { p.ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 0; })()`);
  t.check('Enter inserts the mention with a dash for spaces', (await dlg('p.ta.value')) === 'ask @Alpha-Agent ', await dlg('p.ta.value'));
  await dlg(`(() => { p.ta.value = 'see @flo'; p.ta.selectionStart = p.ta.selectionEnd = p.ta.value.length; p.ta.dispatchEvent(new Event('input')); return 0; })()`);
  await t.sleep(300);
  t.check('@ also lists floors', (await t.js(`[...document.querySelectorAll('.prompter-complete .item')].map((e) => e.textContent).join('|')`)).includes('floor'));
  await dlg(`(() => { p.ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 0; })()`);
  t.check('Escape closes the list without inserting', await t.js(`document.querySelector('.prompter-complete').classList.contains('hidden')`) && (await dlg('p.ta.value')) === 'see @flo');

  // ---- long paste collapses and expands on send ----
  const long = Array.from({ length: 10 }, (_, i) => 'line ' + (i + 1)).join(String.fromCharCode(10));
  await dlg(`(() => { p.ta.value = 'Review:'; p.ta.selectionStart = p.ta.selectionEnd = p.ta.value.length; const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(long)}); p.ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return 0; })()`);
  const boxText = await dlg('p.ta.value');
  t.check('a long paste becomes a chip token', /\[Pasted text #1 \(10 lines\)\]/.test(boxText) && !boxText.includes('line 7'), boxText);
  t.check('compose expands the token to the full text', (await dlg('p.compose()')).includes('line 10'));

  // ---- delivery: multi-line goes as one bracketed paste ----
  await dlg(`(() => { p.send(); return 0; })()`);
  await t.sleep(300);
  const got = await t.js(`window.__got`);
  const sent = (got[ids.a] || [])[0] || '';
  t.check('the ticked terminal receives the prompt as a bracketed paste', sent.startsWith(String.fromCharCode(27) + '[200~') && sent.endsWith(String.fromCharCode(27) + '[201~') && sent.includes('line 10'), sent.slice(0, 60));
  t.check('an unticked terminal receives nothing', !(got[ids.b] || []).length, got);
  t.check('sending closes the dialog', !(await t.js(`!!document.querySelector('.prompter')`)));

  // ---- single line is typed plainly; nothing to send does nothing ----
  await open(`, targets: ['${ids.b}']`);
  await dlg(`(() => { p.send(); return 0; })()`);
  t.check('an empty prompt is not delivered', !(await t.js(`window.__got['${ids.b}']`)) && await t.js(`!!document.querySelector('.prompter')`));
  await dlg(`(() => { p.ta.value = 'hi there'; p.send(); return 0; })()`);
  await t.sleep(200);
  t.check('a single line is sent as is', (await t.js(`window.__got['${ids.b}']`))?.[0] === 'hi there');

  // ---- no target ticked ----
  await open(`, targets: []`);
  await dlg(`(() => { document.querySelectorAll('.prompter-targets input').forEach((i) => { i.checked = false; }); p.ta.value = 'x'; p.send(); return 0; })()`);
  await t.sleep(200);
  t.check('with no target ticked it explains instead of sending', /No target/.test(await t.js(`document.getElementById('modal-root').textContent`)));
  await close();

  // ---- keyboard shortcut ----
  await t.js(`(() => { document.activeElement?.blur?.(); return 0; })()`);
  await t.key('p');
  await t.sleep(300);
  t.check('P opens the prompter', await t.js(`!!document.querySelector('.prompter')`));
  await close();
};
