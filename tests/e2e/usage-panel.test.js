// Agent usage: the panel, the near-limit warning on the toolbar button and on terminals running that agent.
module.exports = async (t) => {
  const id = await t.js(`addNode('terminal', { title: 'Claude box', data: { command: 'claude --model x' } }, activeFloor()).id`);
  const other = await t.js(`addNode('terminal', { title: 'Plain', data: { command: 'node' } }, activeFloor()).id`);
  await t.sleep(1500);
  const el = (n) => `rt.get(state.active).live.get('${n}').el`;
  const win = (label, percent, tokens = { input: 1200, output: 3400000, cacheRead: 0, cacheWrite: 50 }) => ({ label, percent, resetsAt: Date.now() + 3600000, tokens });

  // ---- the service answers ----
  const real = await t.js(`call('usage:query')`);
  t.check('usage:query returns a list', Array.isArray(real), real);

  // ---- formatting ----
  t.check('token counts are abbreviated', JSON.stringify(await t.js(`[fmtTokens(999), fmtTokens(1500), fmtTokens(2500000), fmtTokens(3.2e9)]`)) === '["999","1.5k","2.5M","3.20B"]');

  // ---- warnings ----
  await t.js(`usageData = [{ name: 'Claude Code', command: 'claude', windows: [${JSON.stringify(win('5h', 85))}] }, { name: 'Codex', command: 'codex', windows: [${JSON.stringify(win('week', 20))}] }]; applyUsageWarnings(); 0`);
  t.check('the button warns when an agent is near its limit', await t.js(`document.getElementById('usage-btn').classList.contains('warn') && document.getElementById('usage-btn').title.includes('Claude Code')`));
  t.check('the title lists only agents near a limit', !(await t.js(`document.getElementById('usage-btn').title.includes('Codex')`)));
  t.check('a terminal running that agent is flagged', await t.js(`${el(id)}.classList.contains('near-limit') && ${el(id)}.title.includes('near its usage limit')`));
  t.check('other terminals are not', !(await t.js(`${el(other)}.classList.contains('near-limit')`)));

  await t.js(`usageData = [{ name: 'Claude Code', command: 'claude', windows: [${JSON.stringify(win('5h', 40))}] }]; applyUsageWarnings(); 0`);
  t.check('the warning clears when usage drops', !(await t.js(`document.getElementById('usage-btn').classList.contains('warn') || ${el(id)}.classList.contains('near-limit')`)));
  t.check('the tooltip returns to normal', (await t.js(`document.getElementById('usage-btn').title`)) === 'Agent usage');

  // ---- cards ----
  const card = await t.js(`(() => {
    const c = usageCard({ name: 'Claude Code', plan: 'max', source: 'custom', updatedAt: Date.now(), windows: [${JSON.stringify(win('5h', 85))}, ${JSON.stringify(win('tokens only', null))}], limitReached: '5h' });
    return { text: c.textContent, warn: !!c.querySelector('.usage-bar.warn'), bars: c.querySelectorAll('.usage-bar').length, width: c.querySelector('.usage-bar > div').style.width };
  })()`);
  t.check('a card shows name, plan and percentage', /Claude Code/.test(card.text) && /max plan/.test(card.text) && /85% used/.test(card.text), card.text);
  t.check('the bar turns amber at the threshold and has the right width', card.warn && card.width === '85%', card);
  t.check('a window without a percentage shows tokens, not a bar', card.bars === 1 && /3\.4M tokens/.test(card.text), card.text);
  t.check('a reached limit is called out', /Limit reached: 5h/.test(card.text));
  t.check('a custom definition is labelled', /custom definition/.test(card.text));
  const err = await t.js(`usageCard({ name: 'Codex', error: 'no logs found' }).textContent`);
  t.check('an error card shows the message', /Codex/.test(err) && /no logs found/.test(err));

  // ---- dialog ----
  await t.js(`document.getElementById('usage-btn').click(); 0`);
  await t.sleep(1000);
  const dlg = await t.js(`document.getElementById('modal-root').textContent`);
  t.check('the button opens the usage dialog', /Agent usage/.test(dlg) && /nothing is sent anywhere/.test(dlg), dlg.slice(0, 200));
  t.check('it offers Refresh and Edit definitions', /Refresh/.test(dlg) && /Edit definitions/.test(dlg));
  await t.js(`[...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Close').click(); 0`);
  t.check('Close dismisses it', !(await t.js(`document.getElementById('modal-root').textContent.includes('Agent usage')`)));
};
