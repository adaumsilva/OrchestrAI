// Chat with an agent CLI. Each message runs the command with the prompt on stdin
// and streams stdout back; the default targets Claude Code's print mode.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

NodeKinds.chat = {
  label: 'Chat', w: 440, h: 460,
  mount({ node, body, cwd, entry, save, addButton }) {
    node.data.command ||= 'claude -p --continue';
    node.data.messages ||= [];
    let busy = false, live = null;

    const cmd = h('input', { value: node.data.command, title: 'Command run for each message (prompt arrives on stdin)' });
    cmd.addEventListener('change', () => { node.data.command = cmd.value.trim(); save(); });
    const msgs = h('div', { class: 'msgs' });
    const input = h('textarea', { rows: 3, placeholder: 'Message (Enter to send, Shift+Enter for newline)', style: 'resize:none' });
    const sendBtn = h('button', { class: 'primary' }, 'Send');
    body.append(h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Command'), cmd), msgs, h('div', { class: 'row' }, input, sendBtn));

    const add = (role, text, stderr) => {
      const m = h('div', { class: `msg ${role}${stderr ? ' stderr' : ''}` }, text);
      msgs.append(m);
      msgs.scrollTop = msgs.scrollHeight;
      return m;
    };
    node.data.messages.forEach((m) => add(m.role, m.text));

    function setBusy(b) { busy = b; sendBtn.textContent = b ? 'Stop' : 'Send'; sendBtn.classList.toggle('primary', !b); }

    function send(text) {
      text = (text ?? input.value).trim();
      if (!text || busy) return;
      input.value = '';
      node.data.messages.push({ role: 'user', text });
      add('user', text);
      live = { el: add('agent', '…'), text: '' };
      setBusy(true);
      call('chat:send', { id: node.id, command: cmd.value.trim(), cwd: cwd(), prompt: text });
    }

    sendBtn.addEventListener('click', () => (busy ? call('chat:interrupt', node.id) : send()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    const offData = api.on('chat:data', (id, chunk, isErr) => {
      if (id !== node.id || !live) return;
      const clean = chunk.replace(ANSI, '').replace(/\r/g, '');
      if (isErr) { add('agent', clean.trim(), true); return; }
      live.text += clean;
      live.el.textContent = live.text;
      msgs.scrollTop = msgs.scrollHeight;
    });
    const offDone = api.on('chat:done', (id, code) => {
      if (id !== node.id) return;
      if (live) {
        if (!live.text.trim()) live.el.textContent = code === 0 ? '(no output)' : `(exited with code ${code})`;
        else node.data.messages.push({ role: 'agent', text: live.text.trim() });
      }
      live = null;
      setBusy(false);
      save();
    });

    addButton('\u{1F5D1}', 'Clear conversation', () => { node.data.messages = []; msgs.replaceChildren(); save(); });
    // Notes and other nodes can send into this chat.
    entry.api.send = (text) => send(text);

    return () => { offData(); offDone(); call('chat:interrupt', node.id); };
  },
};
