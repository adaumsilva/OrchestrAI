const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const read = (f) => { try { return fs.readFileSync(path.join(t.dataDir, f), 'utf8'); } catch { return ''; } };

  let list = await call('accounts:list');
  t.check('the OS keychain is available for secrets', list.secure === true, list.secure);
  t.check('claude, codex and custom providers are offered', ['claude', 'codex', 'custom'].every((k) => list.providers[k]));

  // ---- create two accounts of the same CLI ----
  const a = await call('accounts:save', { provider: 'claude', name: 'Work', vars: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: 'sk-ant-AAAA1111' }, { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://gw.example/a' }] });
  const b = await call('accounts:save', { provider: 'claude', name: 'Personal', vars: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: 'sk-ant-BBBB2222' }] });
  t.check('two accounts are created', a.ok && b.ok && a.id !== b.id, { a, b });

  list = await call('accounts:list');
  const pubA = list.accounts.find((x) => x.id === a.id);
  t.check('the list says a key is set but never returns it', pubA.vars.some((v) => v.secret && v.set && v.value === undefined) && !JSON.stringify(list).includes('AAAA1111') && !JSON.stringify(list).includes('BBBB2222'));
  t.check('each account gets its own config folder', pubA.configDir && list.accounts.find((x) => x.id === b.id).configDir !== pubA.configDir);

  // ---- keys only in the keychain-protected store ----
  const files = ['accounts.json', 'account-secrets.json', 'workspace.json'].map(read);
  t.check('no file contains the plaintext keys', files.every((f) => !f.includes('AAAA1111') && !f.includes('BBBB2222')));
  const enc = JSON.parse(read('account-secrets.json'));
  t.check('secrets are stored encrypted, one per account', Object.keys(enc).length === 2 && typeof enc[a.id].ANTHROPIC_API_KEY === 'string' && enc[a.id].ANTHROPIC_API_KEY.length > 20);

  // ---- validation ----
  t.check('a duplicate name for the same provider is refused', (await call('accounts:save', { provider: 'claude', name: 'work', vars: [] })).ok === false);
  t.check('dangerous variables are refused', (await call('accounts:save', { provider: 'custom', name: 'Bad', vars: [{ name: 'PATH', secret: false, value: 'x' }] })).ok === false);
  t.check('invalid variable names are refused', (await call('accounts:save', { provider: 'custom', name: 'Bad2', vars: [{ name: '1X', secret: false, value: 'x' }] })).ok === false);

  // ---- editing keeps or clears a secret ----
  await call('accounts:save', { id: a.id, provider: 'claude', name: 'Work', vars: [{ name: 'ANTHROPIC_API_KEY', secret: true }, { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://gw.example/a2' }] });
  list = await call('accounts:list');
  t.check('leaving the key empty keeps the stored one', list.accounts.find((x) => x.id === a.id).vars.find((v) => v.secret).set === true);
  t.check('a plain variable is updated', list.accounts.find((x) => x.id === a.id).vars.find((v) => v.name === 'ANTHROPIC_BASE_URL').value === 'https://gw.example/a2');

  // ---- two terminals on different accounts at the same time ----
  await t.js(`refreshAccounts().then(() => 0)`); // the dialogs do this; we created the accounts behind the UI's back
  const win = process.platform === 'win32';
  // short lines: the terminal wraps at ~80 columns, and the config folder's name is the account id
  const show = win ? 'echo ("CFG=" + (Split-Path -Leaf $env:CLAUDE_CONFIG_DIR) + " KEY=" + $env:ANTHROPIC_API_KEY + " URL=" + $env:ANTHROPIC_BASE_URL)' : 'echo "CFG=$(basename "$CLAUDE_CONFIG_DIR") KEY=$ANTHROPIC_API_KEY URL=$ANTHROPIC_BASE_URL"';
  const ids = await t.js(`(() => {
    const f = activeFloor();
    const mk = (title, accountId, x) => addNode('terminal', { title, x, y: 40, data: { accountId } }, f).id;
    return { A: mk('on-work', ${JSON.stringify(a.id)}, 40), B: mk('on-personal', ${JSON.stringify(b.id)}, 700), N: mk('plain', 'none', 1360) };
  })()`);
  await t.sleep(4500);
  const screenOf = async (id) => {
    await t.js(`rt.get(state.active).live.get('${id}').api.send(${JSON.stringify(show)}); 0`);
    await t.sleep(1800);
    return t.js(`rt.get(state.active).live.get('${id}').api.readScreen()`);
  };
  const sa = await screenOf(ids.A), sb = await screenOf(ids.B), sn = await screenOf(ids.N);
  const line = (s) => (s.split('\n').filter((l) => /^CFG=/.test(l.trim())).pop() || '').trim();
  t.check('terminal on "Work" sees its own key, endpoint and config folder', line(sa).includes('KEY=sk-ant-AAAA1111') && line(sa).includes('CFG=' + a.id) && line(sa).includes('URL=https://gw.example/a2'), line(sa));
  t.check('terminal on "Personal" sees a different key and folder at the same time', line(sb).includes('KEY=sk-ant-BBBB2222') && !line(sb).includes('AAAA') && line(sb).includes('CFG=' + b.id), line(sb));
  t.check('a terminal set to "None" gets neither', line(sn).includes('KEY= ') || line(sn).endsWith('KEY=') || !line(sn).includes('sk-ant'), line(sn));

  // ---- defaults ----
  await call('accounts:setDefault', 'claude', b.id);
  await call('accounts:list'); await t.js(`refreshAccounts().then(() => 0)`);
  const eff = await t.js(`({
    cmd: effectiveAccountId({ data: { command: 'claude --resume' } }),
    explicit: effectiveAccountId({ data: { command: 'claude', accountId: ${JSON.stringify(a.id)} } }),
    none: effectiveAccountId({ data: { command: 'claude', accountId: 'none' } }),
    other: effectiveAccountId({ data: { command: 'npm test' } }),
    missing: effectiveAccountId({ data: { command: 'claude', accountId: 'gone' } }),
  })`);
  t.check('a claude command uses the default account', eff.cmd === b.id, eff);
  t.check('an explicit choice wins over the default', eff.explicit === a.id);
  t.check('"None" and unrelated commands use no account', eff.none === undefined && eff.other === undefined);
  t.check('a deleted account falls back to no account', eff.missing === undefined);
  t.check('a default of another provider is refused', (await call('accounts:setDefault', 'codex', b.id)).ok === false);

  // ---- UI ----
  await t.js(`accountsDialog(); 0`);
  await t.sleep(500);
  const ui = await t.js(`document.querySelector('#modal-root').innerText`);
  t.check('accounts dialog lists both accounts with key status and the default', /Work/.test(ui) && /Personal/.test(ui) && /key stored in the keychain/.test(ui) && /default/.test(ui), ui);
  await t.js(`closeModal(); terminalDialog({ mode: 'new', floor: activeFloor() }); 0`);
  await t.sleep(500);
  const opts = await t.js(`[...document.querySelectorAll('#modal-root select option')].map((o) => o.textContent)`);
  t.check('the terminal sheet offers an account picker', opts.some((o) => /Work/.test(o)) && opts.some((o) => /None \(my environment\)/.test(o)), opts);
  await t.js(`closeModal(); 0`);

  // ---- sign out and delete ----
  fs.mkdirSync(pubA.configDir, { recursive: true });
  fs.writeFileSync(path.join(pubA.configDir, 'login.json'), '{}');
  await call('accounts:signOut', a.id);
  list = await call('accounts:list');
  t.check('sign out clears the key and the CLI login files but keeps the account', list.accounts.find((x) => x.id === a.id).vars.find((v) => v.secret).set === false && !fs.existsSync(path.join(pubA.configDir, 'login.json')));
  await call('accounts:remove', b.id);
  list = await call('accounts:list');
  t.check('delete removes the account, its folder and its default', !list.accounts.some((x) => x.id === b.id) && !list.defaults.claude && !JSON.parse(read('account-secrets.json'))[b.id]);
};
