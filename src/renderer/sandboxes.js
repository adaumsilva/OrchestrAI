// Docker Sandboxes in the terminal sheet: pick or create a sandbox, test the connection with a copyable diagnostic, and show
// policy denials. OrchestrAI never deletes a sandbox; several terminals may share one.

const SANDBOX_AGENTS = ['claude', 'codex', 'gemini', 'copilot', 'shell'];

// A line of sandbox or proxy output that says a policy refused something.
const DENIAL_RE = /(?:blocked|denied|forbidden|refused|not allowed)[^\n]{0,80}(?:polic|allow-?list|network rule|proxy)|polic[^\n]{0,60}(?:denied|blocked|violation)/i;

// Returns { line, fix } when text contains a policy denial. `fix` is a "docker sandbox ..." command the output itself suggested.
function findSandboxDenial(text) {
  const lines = String(text || '').split(/\r?\n/);
  const at = lines.findIndex((l) => DENIAL_RE.test(l));
  if (at < 0) return null;
  const near = lines.slice(Math.max(0, at - 1), at + 5);
  const fixLine = near.find((l) => /\bdocker\s+sandbox\s+\S+/.test(l));
  const fix = fixLine ? fixLine.replace(/^.*?(docker\s+sandbox\s+.*)$/, '$1').replace(/[`'"]+\s*$/, '').trim() : '';
  return { line: lines[at].trim().slice(0, 300), fix };
}

// Sandboxes whose workspace is this folder come first.
function sortSandboxes(list, dir) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const mine = (s) => dir && norm(s.workspace) === norm(dir);
  return [...list].sort((a, b) => (mine(b) ? 1 : 0) - (mine(a) ? 1 : 0) || a.name.localeCompare(b.name));
}

function diagnosticDialog(res, title) {
  const denial = res.steps.map((s) => findSandboxDenial(s.stdout + '\n' + s.stderr)).find(Boolean);
  const box = h('textarea', { readonly: true, rows: 14, style: 'width:100%;font-family:var(--mono);font-size:11px' });
  box.value = res.diagnostic;
  modal({
    title,
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:520px' },
      h('div', { class: res.ok ? '' : 'err' }, res.ok ? 'The sandbox answered.' : `Failed at: ${res.steps.find((s) => !s.ok)?.label || 'unknown step'}`),
      denial ? h('div', { class: 'err' }, `Policy denial: ${denial.line}`, denial.fix ? h('div', { class: 'mono' }, `Suggested fix: ${denial.fix}`) : h('div', { class: 'muted' }, 'The output did not suggest a command; check the sandbox network policy.')) : null,
      box),
    actions: [
      { label: 'Close', onClick: (c) => c() },
      { label: 'Copy diagnostic', primary: true, onClick: () => { navigator.clipboard.writeText(res.diagnostic); } },
    ],
  });
}

async function testSandbox(name) {
  const res = await call('sandbox:test', name);
  diagnosticDialog(res, `Test connection${name ? `: ${name}` : ''}`);
  return res;
}

// Create flow: agent + host workspace folder + optional name. Resolves with the new sandbox's name, or null.
function createSandboxDialog(defaultDir) {
  return new Promise((resolve) => {
    const agent = h('select', {}, SANDBOX_AGENTS.map((a) => h('option', { value: a }, a)));
    const ws = h('input', { value: defaultDir || '', placeholder: 'Host folder the sandbox works on' });
    const name = h('input', { placeholder: 'Optional name' });
    const msg = h('div', { class: 'err' });
    modal({
      title: 'New Docker Sandbox',
      content: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:440px' },
        h('label', {}, 'Agent', agent),
        h('label', {}, 'Workspace', h('div', { class: 'row' }, ws, h('button', { onclick: async () => { const d = await call('files:pickDirectory'); if (d) ws.value = d; } }, 'Browse'))),
        h('label', {}, 'Name', name),
        h('div', { class: 'muted' }, 'OrchestrAI never deletes a sandbox; remove it yourself with "docker sandbox rm" when you no longer need it.'), msg),
      actions: [
        { label: 'Cancel', onClick: (c) => { c(); resolve(null); } },
        {
          label: 'Create', primary: true, onClick: async (c) => {
            msg.textContent = 'Creating… this can take a while the first time.';
            const r = await call('sandbox:create', { agent: agent.value, workspace: ws.value, name: name.value });
            if (!r.ok) { msg.textContent = r.error; return; }
            c();
            const list = await call('sandbox:list');
            const made = name.value.trim() || (list.sandboxes || []).find((s) => s.workspace && s.workspace.replace(/\\/g, '/').toLowerCase() === ws.value.replace(/\\/g, '/').toLowerCase())?.name;
            resolve(made || null);
          },
        },
      ],
    });
  });
}
