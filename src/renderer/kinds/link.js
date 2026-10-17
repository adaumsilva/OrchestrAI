// Link node: a URL, a file/folder path or an image. Created by dropping or pasting onto the canvas.
// node.data: { type: 'url' | 'file' | 'image', target, name? }   (image: target is the stored file name under note-images)
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s).trim());

NodeKinds.link = {
  label: 'Link', w: 300, h: 150,
  mount({ node, body, floor, entry, addButton, save }) {
    const d = node.data;
    const target = () => d.target || '';
    const icon = d.type === 'url' ? '🌐' : d.type === 'image' ? '🖼' : '📄';
    const preview = d.type === 'image' ? h('img', { class: 'link-img', alt: d.name || '' }) : null;
    if (preview) call('notes:image', d.target).then((u) => { if (u) preview.src = u; });
    const label = h('div', { class: 'link-target mono', title: target() }, d.type === 'image' ? (d.name || d.target) : target());
    body.classList.add('link-body');
    body.append(h('div', { class: 'link-main' }, preview || h('span', { class: 'link-ico' }, icon), label));

    const open = () => {
      if (d.type === 'url') call('app:openExternal', d.target);
      else if (d.type === 'file') call('files:open', d.target).then((r) => { if (r) alertModal('Open', r); });
      else call('notes:openImage', d.target);
    };
    const openInPortal = () => addNode('portal', { x: node.x + node.w + 40, y: node.y, data: { url: d.target } }, floor);
    const copy = () => call('app:copy', d.type === 'image' ? d.name || d.target : d.target);
    const actions = [{ label: 'Open', fn: open }];
    if (d.type === 'url') actions.push({ label: 'Open in a portal', fn: openInPortal });
    if (d.type === 'file') actions.push({ label: 'Reveal', fn: () => call('files:reveal', d.target) });
    actions.push({ label: d.type === 'url' ? 'Copy URL' : 'Copy path', fn: copy });
    body.append(h('div', { class: 'row link-actions' }, actions.map((a) => h('button', { onclick: a.fn }, a.label))));
    label.addEventListener('dblclick', open);

    entry.api.open = open;
    entry.api.copy = copy;
    entry.api.openInPortal = openInPortal;
  },
};

// ---------- drop and paste onto the canvas ----------
function addLinkNode(f, type, target, extra = {}, at) {
  const title = type === 'url' ? (() => { try { return new URL(target).hostname; } catch { return 'Link'; } })() : (extra.name || target.split(/[\\/]/).pop() || 'Link');
  const node = addNode('link', { title, data: { type, target, ...extra }, ...(at ? { x: at.x, y: at.y } : {}), ...(type === 'image' ? { w: 300, h: 240 } : {}) }, f);
  setSelection(f, [node.id]);
  return node;
}

async function storeImageFile(file) {
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return call('notes:saveImage', btoa(bin), ext);
}

// Turn dropped or pasted data into nodes. Returns how many nodes were made.
async function importTransfer(dt, f, at) {
  let made = 0;
  const files = [...(dt.files || [])];
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const r = await storeImageFile(file);
      if (r.name) { addLinkNode(f, 'image', r.name, { name: file.name || 'image' }, at && { x: at.x + made * 24, y: at.y + made * 24 }); made++; } else alertModal('Image not added', r.error);
    } else {
      const p = api.pathForFile?.(file);
      if (p) { addLinkNode(f, 'file', p, {}, at && { x: at.x + made * 24, y: at.y + made * 24 }); made++; }
    }
  }
  if (!made) {
    const text = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
    const first = text.split(/\r?\n/).find((l) => l && !l.startsWith('#')) || '';
    if (isUrl(first)) { addLinkNode(f, 'url', first.trim(), {}, at); made++; }
  }
  return made;
}

viewport.addEventListener('dragover', (e) => {
  if (!e.target.closest('.node') && [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/plain')) e.preventDefault();
});
viewport.addEventListener('drop', async (e) => {
  if (e.target.closest('.node') || !e.dataTransfer) return; // nodes (notes, prompter, ...) handle their own drops
  const f = activeFloor();
  e.preventDefault();
  const at = worldPoint(f, e);
  await importTransfer(e.dataTransfer, f, { x: at.x - 150, y: at.y - 40 });
});

addEventListener('paste', async (e) => {
  if (isTyping(e.target) || modalOpen() || e.target.closest?.('.xterm')) return;
  const f = activeFloor();
  if (!f || !e.clipboardData) return;
  if ([...e.clipboardData.files].length || isUrl(e.clipboardData.getData('text/plain'))) {
    e.preventDefault();
    await importTransfer(e.clipboardData, f);
  }
});

registerCommand({ id: 'add-link', label: 'Add link…', run: async () => {
  const v = await askText('Add link', 'URL or file path');
  if (!v) return;
  addLinkNode(activeFloor(), isUrl(v) ? 'url' : 'file', v);
} });
