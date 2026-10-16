// Chat face of a terminal: the agent's own transcript (Claude Code session files) shown as a conversation, with thread
// switching, search, paging and a message box that types into the same live process. Nothing here owns the process, so
// toggling between faces never interrupts it.
function createChatFace({ node, cwd, sendText, interrupt, save }) {
  const PAGE = 60;
  let threads = [], threadId = node.data.thread || '', msgs = [], start = 0, mtime = 0, query = '', focusIdx = -1, visible = false;
  const subs = new Set();

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withMarks = (text, q) => (q ? text.split(new RegExp(`(${esc(q)})`, 'ig')).map((p, i) => (i % 2 ? h('mark', {}, p) : p)) : [text]);

  const threadSel = h('select', { title: 'Conversation thread' });
  const searchIn = h('input', { class: 'chat-search', placeholder: 'Search threads', title: 'Search every thread of this project' });
  const list = h('div', { class: 'msgs' });
  const results = h('div', { class: 'msgs chat-results hidden' });
  const input = h('textarea', { rows: 2, placeholder: 'Message the agent (Enter sends, Shift+Enter newline)', style: 'resize:none' });
  const attached = [];
  const chips = h('div', { class: 'prompter-chips' });
  const renderChips = () => chips.replaceChildren(...attached.map((p, i) => h('span', { class: 'chip', title: p }, p.split(/[\\/]/).pop(), h('button', { onclick: () => { attached.splice(i, 1); renderChips(); } }, '×'))));
  const stop = h('button', { title: 'Interrupt the agent (Ctrl+C)', onclick: interrupt }, '■');
  const clear = h('button', { title: 'Send /clear to start a fresh conversation', onclick: async () => { if (await confirmModal('Clear conversation', 'Send /clear to the agent? Its context is reset; the saved transcript stays.', 'Send /clear')) sendText('/clear'); } }, 'Clear');
  const attach = h('button', { title: 'Attach files (their paths are added to the message)', onclick: async () => { attached.push(...(await call('files:pickFiles'))); renderChips(); } }, '📎');
  const sendBtn = h('button', { class: 'primary', onclick: () => send() }, 'Send');
  const el = h('div', { class: 'terminal-chat hidden' },
    h('div', { class: 'row' }, threadSel, searchIn, stop, clear),
    list, results, chips,
    h('div', { class: 'row' }, input, attach, sendBtn));

  function send() {
    let text = input.value.trim();
    if (!text) return;
    if (attached.length) text += `\n\nAttachments:\n${attached.map((p) => `- ${p}`).join('\n')}`;
    sendText(text);
    input.value = '';
    attached.length = 0;
    renderChips();
    setTimeout(() => visible && !query && load(), 1500);
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  function render(keepScroll) {
    const prev = list.scrollHeight - list.scrollTop;
    const nodes = msgs.map((m, i) => {
      const idx = start + i;
      const d = h('div', { class: `msg ${m.role === 'user' ? 'user' : m.role === 'tool' ? 'tool' : 'agent'}${idx === focusIdx ? ' focus' : ''}` }, ...withMarks(m.text, query));
      if (idx === focusIdx) setTimeout(() => d.scrollIntoView({ block: 'center' }), 0);
      return d;
    });
    if (start > 0) nodes.unshift(h('button', { class: 'chat-older', onclick: loadOlder }, `Load older (${start} more)`));
    if (!msgs.length) nodes.push(h('div', { class: 'empty' }, threads.length ? 'No messages in this thread yet.' : 'No conversation found for this folder. Start an agent (Claude Code) in this terminal and it will appear here.'));
    list.replaceChildren(...nodes);
    if (focusIdx < 0) list.scrollTop = keepScroll ? list.scrollHeight - prev : list.scrollHeight;
  }
  async function load(before) {
    if (!threadId) { msgs = []; return render(); }
    const r = await call('chat:messages', { cwd: cwd(), id: threadId, before, limit: PAGE });
    if (r.error) { msgs = []; return render(); }
    start = r.start; mtime = r.mtime; msgs = r.messages;
    render();
  }
  async function loadOlder() {
    const r = await call('chat:messages', { cwd: cwd(), id: threadId, before: start, limit: PAGE });
    if (r.error) return;
    start = r.start;
    msgs = [...r.messages, ...msgs];
    render(true);
  }
  async function refreshThreads() {
    threads = (await call('chat:threads', cwd())) || [];
    if (threadId && !threads.some((t) => t.id === threadId)) threadId = '';
    if (!threadId) threadId = threads[0]?.id || '';
    threadSel.replaceChildren(...threads.map((t) => h('option', { value: t.id, selected: t.id === threadId }, `${new Date(t.mtime).toLocaleString()} — ${t.title}`)));
  }
  threadSel.addEventListener('change', () => { threadId = threadSel.value; node.data.thread = threadId; focusIdx = -1; save(); load(); });

  // ---------- search across threads ----------
  let searchTimer = null;
  searchIn.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      query = searchIn.value.trim();
      if (!query) { results.classList.add('hidden'); list.classList.remove('hidden'); focusIdx = -1; return render(); }
      const hits = await call('chat:search', { cwd: cwd(), query });
      list.classList.add('hidden');
      results.classList.remove('hidden');
      results.replaceChildren(...(hits.length ? hits.map((hit) => h('div', {
        class: 'chat-hit',
        async onclick() {
          threadId = hit.id; node.data.thread = threadId; focusIdx = hit.idx;
          results.classList.add('hidden'); list.classList.remove('hidden');
          await refreshThreads();
          await load(hit.idx + PAGE / 2);
        },
      }, h('span', { class: 'muted' }, `${hit.role === 'user' ? 'You' : 'Agent'} · ${(threads.find((t) => t.id === hit.id)?.title || '').slice(0, 30)}`), h('div', {}, ...withMarks(hit.snippet, query))))
        : [h('div', { class: 'empty' }, 'No matches.')]));
    }, 250);
  });

  // ---------- live updates and the unread mark ----------
  const poll = setInterval(async () => {
    if (!threadId) { if (visible) { await refreshThreads(); load(); } return; }
    const st = await call('chat:stat', { cwd: cwd(), id: threadId });
    if (!st || st.mtime === mtime) return;
    if (visible && !query) await load();
    else if (!visible && mtime) subs.forEach((f) => f(true));
    mtime = st.mtime;
  }, 2500);

  refreshThreads().then(() => load());
  return {
    el,
    onUnread: (f) => subs.add(f),
    show(v) {
      visible = v;
      el.classList.toggle('hidden', !v);
      if (v) { subs.forEach((f) => f(false)); focusIdx = -1; refreshThreads().then(() => load()); input.focus(); }
    },
    destroy() { clearInterval(poll); },
  };
}
