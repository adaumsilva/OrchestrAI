// Remote control dialog: turn the phone/tablet web app on, choose where it listens, pair devices with a one-time code, revoke them.
// The server and its rules are in services/remote.js; see docs/REMOTE.md for the threat model.

const REMOTE_MODES = [
  ['local', 'This computer only (for an SSH or Tailscale tunnel you set up yourself)'],
  ['tailscale', 'My Tailscale network (encrypted by Tailscale)'],
  ['lan', 'My local network (NOT encrypted)'],
];

let remoteTimer = null;

async function remoteDialog() {
  const body = h('div', { 'data-remote': '1', style: 'display:flex;flex-direction:column;gap:10px;min-width:520px;max-height:70vh;overflow:auto' });
  const modalEl = modal({ title: 'Remote control', content: body, actions: [{ label: 'Close', primary: true, onClick: (c) => { clearInterval(remoteTimer); c(); } }] });
  const render = async () => {
    if (!document.body.contains(body)) { clearInterval(remoteTimer); return; }
    const s = await call('remote:status');
    const mode = h('select', { disabled: false, onchange: async (e) => { await call('remote:configure', { mode: e.target.value }); render(); } },
      REMOTE_MODES.map(([v, l]) => h('option', { value: v, selected: s.mode === v }, l)));
    const port = h('input', { type: 'number', min: 0, max: 65535, value: s.port, style: 'width:90px', title: '0 picks a free port', onchange: async (e) => { const r = await call('remote:configure', { port: Number(e.target.value) || 0 }); if (!r.ok) alertModal('Remote control', r.error); render(); } });
    const lanRisk = s.mode === 'lan' ? h('label', { class: 'check err' }, h('input', { type: 'checkbox', checked: s.acceptLanRisk, onchange: async (e) => { await call('remote:configure', { acceptLanRisk: e.target.checked }); render(); } }),
      'I understand that anyone on this network can read what the phone sees (including terminal output) and take over a paired session.') : null;
    body.replaceChildren(...[
      h('div', { class: 'muted' }, 'Watch your terminals from a phone or tablet, answer prompts and get alerts when an agent needs you. It is off by default, there is no cloud service involved, and a device has to be paired with a code shown here.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.enabled, onchange: async (e) => { const r = await call('remote:configure', { enabled: e.target.checked }); if (!r.ok && r.error) alertModal('Remote control', r.error); render(); } }), 'Allow remote control'),
      h('label', { class: 'row' }, h('span', { class: 'muted', style: 'min-width:60px' }, 'Reachable on'), mode),
      lanRisk,
      h('label', { class: 'row' }, h('span', { class: 'muted', style: 'min-width:60px' }, 'Port'), port),
      s.mode === 'tailscale' && !s.tailscale ? h('div', { class: 'err' }, 'No Tailscale address was found. Start Tailscale on this computer.') : null,
      s.error ? h('div', { class: 'err' }, s.error) : null,
      s.listening ? h('div', {}, h('div', { class: 'muted' }, 'Open this address on the device:'), ...s.urls.map((u) => h('div', { class: 'row' }, h('span', { class: 'mono' }, u), h('button', { onclick: () => call('app:copy', u) }, 'Copy')))) : null,
      s.listening ? pairingBlock(s, render) : null,
      h('div', { class: 'muted' }, s.devices.length ? 'Paired devices' : 'No devices are paired.'),
      ...s.devices.map((d) => h('div', { class: 'change' },
        h('span', { class: 'dot', style: `background:${d.connected ? 'var(--success)' : 'var(--fg-subtle)'}`, title: d.connected ? 'Connected now' : 'Not connected' }),
        h('span', {}, d.name), h('span', { class: 'muted', style: 'margin-left:auto' }, `last seen ${new Date(d.lastSeen).toLocaleString()}`),
        h('button', { onclick: async () => { if (await confirmModal('Revoke device', `Disconnect “${d.name}” and make it pair again before it can connect?`, 'Revoke')) { await call('remote:revoke', d.id); } remoteDialog(); } }, 'Revoke'))),
      s.devices.length > 1 ? h('div', {}, h('button', { class: 'danger', onclick: async () => { if (await confirmModal('Revoke all', 'Disconnect every paired device?', 'Revoke all')) await call('remote:revokeAll'); remoteDialog(); } }, 'Revoke all')) : null,
    ].filter(Boolean));
  };

  function pairingBlock(s, rerender) {
    if (s.pairing && s.pairing.locked) return h('div', {}, h('div', { class: 'err' }, 'Too many wrong codes. Pairing is locked.'), h('button', { onclick: async () => { await call('remote:startPairing'); rerender(); } }, 'Start a new pairing'));
    if (s.pairing) {
      const left = Math.max(0, Math.round((s.pairing.expiresAt - Date.now()) / 1000));
      return h('div', { class: 'pair-box' },
        h('div', { class: 'muted' }, 'Type this code on the device (single use, expires in ' + left + ' s):'),
        h('div', { class: 'pair-code mono' }, s.pairing.code),
        h('button', { onclick: async () => { await call('remote:cancelPairing'); rerender(); } }, 'Cancel'));
    }
    return h('div', {}, h('button', { class: 'primary', onclick: async () => { await call('remote:startPairing'); rerender(); } }, 'Pair a device'));
  }

  await render();
  clearInterval(remoteTimer);
  remoteTimer = setInterval(render, 1500);
  return modalEl;
}

api.on('remote:changed', () => { if (document.querySelector('#modal-root [data-remote]')) remoteDialog(); });
registerCommand({ id: 'remote', label: 'Remote control (phone or tablet)…', run: () => remoteDialog() });
