// Agent usage: a panel with consumption and limits per provider, plus a warning on terminals whose agent is near a limit.
const USAGE_WARN_PERCENT = 80;
let usageData = [];

const fmtTokens = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
const fmtWhen = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const sumTokens = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;

function usageCard(p) {
  const head = h('div', { class: 'usage-head' }, h('b', {}, p.name), p.plan ? h('span', { class: 'muted' }, ` · ${p.plan} plan`) : null,
    h('span', { class: 'muted', style: 'margin-left:auto' }, p.source === 'custom' ? 'custom definition' : ''));
  if (p.error) return h('div', { class: 'usage-card' }, head, h('div', { class: 'usage-err' }, p.error));
  const rows = (p.windows || []).map((w) => {
    const pct = w.percent;
    const bar = pct == null ? null : h('div', { class: 'usage-bar' + (pct >= USAGE_WARN_PERCENT ? ' warn' : '') }, h('div', { style: `width:${Math.min(100, pct)}%` }));
    return h('div', { class: 'usage-row' },
      h('div', { class: 'usage-line' }, h('span', {}, w.label), h('span', { class: 'muted' },
        pct != null ? `${pct}% used${w.resetsAt ? ` · resets ${fmtWhen(w.resetsAt)}` : ''}` : `${fmtTokens(sumTokens(w.tokens))} tokens`)),
      bar,
      h('div', { class: 'muted usage-detail' }, `in ${fmtTokens(w.tokens.input)} · out ${fmtTokens(w.tokens.output)} · cache read ${fmtTokens(w.tokens.cacheRead)} · cache write ${fmtTokens(w.tokens.cacheWrite)}`));
  });
  return h('div', { class: 'usage-card' }, head, ...rows,
    p.limitReached ? h('div', { class: 'usage-err' }, `Limit reached: ${p.limitReached}`) : null,
    p.note ? h('div', { class: 'muted usage-detail' }, p.note) : null,
    h('div', { class: 'muted usage-detail' }, `Updated ${new Date(p.updatedAt).toLocaleTimeString()}${p.lastActivity ? ` · last activity ${new Date(p.lastActivity).toLocaleString()}` : ''}`));
}

// Terminals running an agent that is near a limit get an amber border and a tooltip.
function applyUsageWarnings() {
  const near = usageData.filter((p) => (p.windows || []).some((w) => w.percent >= USAGE_WARN_PERCENT));
  const btn = document.getElementById('usage-btn');
  btn?.classList.toggle('warn', near.length > 0);
  if (btn) btn.title = near.length ? `Near a limit: ${near.map((p) => p.name).join(', ')}` : 'Agent usage';
  for (const f of state.floors) {
    const R = rt.get(f.id);
    for (const n of f.nodes) {
      if (n.kind !== 'terminal') continue;
      const el = R?.live.get(n.id)?.el;
      if (!el) continue;
      const cmd = (n.data.command || '').trim().split(/\s+/)[0].split(/[\\/]/).pop().replace(/\.(cmd|exe)$/i, '');
      const hit = near.find((p) => p.command && p.command === cmd);
      el.classList.toggle('near-limit', !!hit);
      if (hit) el.title = `${hit.name} is near its usage limit`; else if (el.title.endsWith('near its usage limit')) el.removeAttribute('title');
    }
  }
}

async function refreshUsage() {
  try { usageData = await call('usage:query'); } catch { usageData = []; }
  applyUsageWarnings();
  return usageData;
}

async function usageDialog() {
  const body = h('div', { class: 'usage' }, h('div', { class: 'muted' }, 'Reading usage…'));
  const load = async () => {
    const data = await refreshUsage();
    body.replaceChildren(...(data.length ? data.map(usageCard) : [h('div', { class: 'usage-err' }, 'No provider definitions found. Use “Edit definitions” to add one.')]));
  };
  modal({
    title: 'Agent usage',
    content: h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, body,
      h('div', { class: 'muted usage-detail' }, 'Consumption is summed from the session logs each CLI writes locally; nothing is sent anywhere. Percentages appear where the log carries limits (Codex) or the definition sets one.')),
    actions: [
      { label: 'Edit definitions', onClick: () => call('usage:openDefinitions') },
      { label: 'Refresh', onClick: () => load() },
      { label: 'Close', primary: true, onClick: (c) => c() },
    ],
  });
  load();
}

document.getElementById('usage-btn').onclick = usageDialog;
setTimeout(refreshUsage, 5000);
setInterval(refreshUsage, 5 * 60 * 1000);
