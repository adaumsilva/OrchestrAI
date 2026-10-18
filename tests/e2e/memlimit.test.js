module.exports = async (t) => {
  const id = await t.js(`activeFloor().nodes.find((n) => n.kind === 'terminal').id`);
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const screen = async () => (await t.js(`rt.get(state.active).live.get('${id}').api.readScreen()`)).split(String.fromCharCode(10)).join(''); // wrapped lines joined
  const waitFor = async (fn, ms = 40000) => { for (let i = 0; i < ms / 500; i++) { if (await fn()) return true; await t.sleep(500); } return false; };

  // the setting reaches the main process through save()
  await t.js(`state.settings.terminal.memLimitMB = 350; save(); 1`);
  await t.sleep(400);
  t.check('limit is active in the main process', (await call('pty:setMemLimits', { global: 350, perId: {} })).active === true);

  // a child that really holds ~600 MB (Buffer.alloc with a fill touches every page)
  await t.sleep(1500);
  await call('pty:send', id, 'node -e "const b=Buffer.alloc(600*1024*1024,1);setInterval(()=>{b[0]++},1000)"\r');
  const stopped = await waitFor(async () => /Memory limit .* exceeded/.test(await screen()));
  const text = await screen();
  t.check('runaway child is stopped with a notice', stopped, text.slice(-400));
  t.check('notice names the process', /Stopped: node/i.test(text), text.slice(-400));
  t.check('node flagged for attention', await t.js(`rt.get(state.active).live.get('${id}').el.classList.contains('attention')`));

  // the shell survived: it still answers (typed echo + printed output = two more occurrences)
  await call('pty:send', id, 'echo shell-alive-ok\r');
  t.check('the shell keeps running', await waitFor(async () => (await screen()).split('shell-alive-ok').length >= 3), (await screen()).slice(-300));

  // per-terminal override wins over the global setting, and switching off stops sampling
  await t.js(`state.settings.terminal.memLimitMB = 0; activeFloor().nodes.find((n) => n.id === '${id}').data.memLimitMB = 123; save(); 1`);
  await t.sleep(300);
  t.check('override applies', (await call('pty:setMemLimits', { global: 0, perId: { [id]: 123 } })).active === true);
  t.check('no limits turns enforcement off', (await call('pty:setMemLimits', { global: 0, perId: {} })).active === false);
};
