// Accounts: pick which subscription or API key an agent CLI runs on, per terminal. Secrets never reach this process; the
// list only says whether a key is set.

let accountsCache = { accounts: [], defaults: {}, providers: {}, secure: true };
const refreshAccounts = async () => { try { accountsCache = await call('accounts:list'); } catch {} return accountsCache; };
// Terminals wait for this before spawning so a default account is honoured on the very first launch.
const accountsReady = refreshAccounts();

// Which provider's CLI a command starts, when it is one we know.
function accountProviderFor(command) {
  const exe = String(command || '').trim().split(/\s+/)[0].split(/[\\/]/).pop().replace(/\.(cmd|exe|ps1)$/i, '').toLowerCase();
  return Object.entries(accountsCache.providers).find(([, p]) => p.cli && p.cli === exe)?.[0] || null;
}

// The account a terminal should start on: its explicit choice, else the provider's default, else none.
function effectiveAccountId(node) {
  const chosen = node.data.accountId;
  if (chosen === 'none') return undefined;
  if (chosen) return accountsCache.accounts.some((a) => a.id === chosen) ? chosen : undefined;
  const kind = accountProviderFor(node.data.command);
  return (kind && accountsCache.defaults[kind]) || undefined;
}

async function accountsDialog() {
  const c = await refreshAccounts();
  const rows = c.accounts.map((a) => {
    const prov = c.providers[a.provider] || {};
    const isDefault = c.defaults[a.provider] === a.id;
    const users = allFloors().flatMap((f) => f.nodes).filter((n) => n.kind === 'terminal' && n.data.accountId === a.id).length;
    const secretVars = a.vars.filter((v) => v.secret);
    return h('div', { class: 'account-row' },
      h('div', { class: 'routine-main' },
        h('div', {}, h('b', {}, a.name), '  ', h('span', { class: 'muted' }, prov.label || a.provider), isDefault ? h('span', { class: 'pr-badge pass', style: 'margin-left:6px' }, 'default') : null),
        h('div', { class: 'muted' }, [
          secretVars.length ? (secretVars.every((v) => v.set) ? 'key stored in the keychain' : 'key missing') : 'no key',
          a.configDir ? 'own config folder' : '', users ? `${users} terminal${users === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' · '))),
      h('div', { class: 'row' },
        prov.signIn ? h('button', { title: 'Open a terminal on this account and sign in', onclick: () => { closeModal(); addNode('terminal', { title: `${a.name} sign-in`, data: { command: prov.signIn, accountId: a.id } }); } }, 'Sign in') : null,
        prov.cli ? h('button', { onclick: async () => { await call('accounts:setDefault', a.provider, isDefault ? null : a.id); closeModal(); accountsDialog(); } }, isDefault ? 'Unset default' : 'Make default') : null,
        h('button', { onclick: () => { closeModal(); accountEditor(a); } }, 'Edit'),
        h('button', {
          onclick: async () => {
            if (!(await confirmModal('Sign out', `Forget the stored key and login files of "${a.name}"? Terminals on it must sign in again.`, 'Sign out'))) return;
            await call('accounts:signOut', a.id); closeModal(); accountsDialog();
          },
        }, 'Sign out'),
        h('button', {
          class: 'danger', onclick: async () => {
            if (!(await confirmModal('Delete account', `Delete "${a.name}"${users ? ` (used by ${users} terminal${users === 1 ? '' : 's'}, which fall back to your environment)` : ''}?`, 'Delete'))) return;
            await call('accounts:remove', a.id);
            for (const f of allFloors()) for (const n of f.nodes) if (n.data?.accountId === a.id) n.data.accountId = '';
            save(); closeModal(); accountsDialog();
          },
        }, 'Delete')));
  });
  modal({
    title: 'Accounts',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:560px' },
      h('div', { class: 'muted' }, 'Run the same agent CLI on different subscriptions or API keys at the same time. Each account has its own config folder and environment; API keys are encrypted with your operating system keychain and never written to the workspace file.'),
      c.secure ? null : h('div', { class: 'err' }, 'The operating system keychain is not available, so API keys cannot be stored. Accounts that sign in through the CLI still work.'),
      rows.length ? rows : h('div', { class: 'muted' }, 'No accounts yet.'),
      h('div', {}, h('button', { class: 'primary', onclick: () => { closeModal(); accountEditor(null); } }, '+ Add account'))),
    actions: [{ label: 'Close', onClick: (x) => x() }],
  });
}

function accountEditor(existing) {
  const c = accountsCache;
  const d = { provider: existing?.provider || 'claude', name: existing?.name || '', apiKey: '', baseUrl: '', extra: [] };
  const prov = () => c.providers[d.provider];
  if (existing) {
    const p = c.providers[existing.provider];
    d.baseUrl = existing.vars.find((v) => !v.secret && v.name === p.urlVar)?.value || '';
    d.extra = existing.vars.filter((v) => v.name !== p.keyVar && v.name !== p.urlVar).map((v) => ({ name: v.name, secret: v.secret, value: v.secret ? undefined : v.value, set: v.set }));
  }
  const hadKey = existing?.vars.find((v) => v.secret && v.name === prov().keyVar)?.set;
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:480px' });
  const render = () => {
    const p = prov();
    const key = h('input', { type: 'password', placeholder: hadKey ? 'Stored — leave empty to keep it' : 'Optional: use an API key instead of signing in', value: d.apiKey, autocomplete: 'off', oninput: (e) => { d.apiKey = e.target.value; } });
    const extraRows = d.extra.map((v, i) => h('div', { class: 'row' },
      h('input', { placeholder: 'NAME', value: v.name, style: 'flex:1', oninput: (e) => { v.name = e.target.value.trim(); } }),
      h('input', { type: v.secret ? 'password' : 'text', placeholder: v.secret && v.set ? 'Stored — leave empty to keep' : 'value', value: v.value || '', style: 'flex:2', autocomplete: 'off', oninput: (e) => { v.value = e.target.value; } }),
      h('label', { class: 'check', title: 'Store encrypted in the keychain' }, h('input', { type: 'checkbox', checked: !!v.secret, onchange: (e) => { v.secret = e.target.checked; render(); } }), 'secret'),
      h('button', { onclick: () => { d.extra.splice(i, 1); render(); } }, '×')));
    body.replaceChildren(
      h('label', {}, 'Provider', h('select', { disabled: !!existing, onchange: (e) => { d.provider = e.target.value; render(); } }, Object.entries(c.providers).map(([k, v]) => h('option', { value: k, selected: k === d.provider }, v.label)))),
      h('label', {}, 'Name', h('input', { value: d.name, placeholder: 'e.g. Work, Personal', oninput: (e) => { d.name = e.target.value; } })),
      p.keyVar ? h('label', {}, `API key (${p.keyVar})`, key) : null,
      p.urlVar ? h('label', {}, `Custom endpoint (${p.urlVar})`, h('input', { value: d.baseUrl, placeholder: 'Optional, e.g. a proxy or gateway URL', oninput: (e) => { d.baseUrl = e.target.value.trim(); } })) : null,
      p.dirVar ? h('div', { class: 'muted' }, `Isolated config folder (${p.dirVar}) is created for this account; sign in through the CLI to fill it.`) : null,
      h('div', { class: 'muted' }, 'Other environment variables'),
      ...extraRows,
      h('div', {}, h('button', { onclick: () => { d.extra.push({ name: '', secret: false, value: '' }); render(); } }, '+ Variable')));
  };
  render();
  modal({
    title: existing ? `Edit ${existing.name}` : 'New account', content: body,
    actions: [
      { label: 'Cancel', onClick: (x) => { x(); accountsDialog(); } },
      {
        label: 'Save', primary: true, onClick: async (x) => {
          const p = prov();
          const vars = [];
          if (p.keyVar && (d.apiKey || hadKey)) vars.push({ name: p.keyVar, secret: true, value: d.apiKey || undefined });
          if (p.urlVar && d.baseUrl) vars.push({ name: p.urlVar, secret: false, value: d.baseUrl });
          for (const v of d.extra) if (v.name) vars.push({ name: v.name, secret: !!v.secret, value: v.secret ? (v.value || undefined) : (v.value || '') });
          const r = await call('accounts:save', { id: existing?.id, provider: d.provider, name: d.name, vars });
          if (!r.ok) return alertModal('Could not save the account', r.error);
          x(); await refreshAccounts(); accountsDialog();
        },
      },
    ],
  });
}

registerCommand?.({ id: 'accounts', label: 'Manage accounts…', run: () => accountsDialog() });
