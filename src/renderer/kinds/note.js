NodeKinds.note = {
  label: 'Note', w: 280, h: 200,
  mount({ node, body, addButton, linked, flash, save }) {
    const ta = h('textarea', { class: 'note', placeholder: 'Write a prompt, link this note to a terminal or chat, then press play' });
    ta.value = node.data.text || '';
    ta.addEventListener('input', () => { node.data.text = ta.value; save(); });
    body.append(ta);
    addButton('▶', 'Send text to linked terminals and chats', () => {
      for (const t of linked()) {
        flash(t.node.id);
        t.api.send?.(ta.value);
      }
    });
    // Notes that other agents wrote into (via entry.api.append) also work as shared scratch space.
  },
};
