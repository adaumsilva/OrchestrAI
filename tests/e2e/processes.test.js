module.exports = async (t) => {
  const id = await t.js(`activeFloor().nodes.find((n) => n.kind === 'terminal').id`);
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 400; i++) { if (await fn()) return true; await t.sleep(400); } return false; };

  await t.sleep(1500);
  // a long-running child in the terminal
  await call('pty:send', id, 'node -e "setInterval(()=>{},1000)"\r');
  const tree = async () => (await call('pty:processes', id)).list || [];
  t.check('the process tree shows the shell and the child', await waitFor(async () => (await tree()).some((p) => /^node/i.test(p.name))), await tree());
  const root = (await call('pty:processes', id)).root;
  t.check('the root is the shell, at depth 0', (await tree())[0].pid === root && (await tree())[0].depth === 0);

  // the popover opens from the header button and lists the real processes
  await t.js(`[...rt.get(state.active).live.get('${id}').el.querySelectorAll('button')].find((b) => /Processes:/.test(b.title)).click(); 0`);
  t.check('popover opens', await waitFor(() => t.js(`!!document.querySelector('.proc-pop .proc-row')`)));
  const rows = await t.js(`[...document.querySelectorAll('.proc-pop .proc-row')].map((r) => ({ name: r.querySelector('.proc-name').textContent, stop: !!r.querySelector('button'), shell: !!r.querySelector('.proc-shell') }))`);
  t.check('shell row has no Stop button', rows[0].shell && !rows[0].stop, rows);
  t.check('child row has a Stop button', rows.some((r) => /^node/i.test(r.name) && r.stop), rows);

  // pids that do not belong to this terminal, and the shell itself, are refused
  t.check('a foreign pid is refused', (await call('pty:killPid', id, process.pid, true)) === false);
  t.check('the shell pid is refused', (await call('pty:killPid', id, root, true)) === false);

  // Stop (real click) ends only that child; the shell stays
  await t.js(`[...document.querySelectorAll('.proc-pop .proc-row')].find((r) => /^node/i.test(r.querySelector('.proc-name').textContent) && r.querySelector('button')).querySelector('button').click(); 0`);
  t.check('the child is gone after Stop', await waitFor(async () => !(await tree()).some((p) => /^node/i.test(p.name))), await tree());
  t.check('the shell is still there', (await tree()).length >= 1 && (await tree())[0].pid === root);
  t.check('the popover updates', await waitFor(() => t.js(`![...document.querySelectorAll('.proc-pop .proc-name')].some((n) => /^node/i.test(n.textContent))`)));

  // Esc closes it
  await t.key('Escape');
  t.check('Esc closes the popover', !(await t.js(`!!document.querySelector('.proc-pop')`)));
};
