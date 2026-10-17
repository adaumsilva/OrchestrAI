const { clipboard } = require('electron');
const fs = require('fs'), path = require('path');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

module.exports = async (t) => {
  await t.js(`window.__errs = []; addEventListener('error', (e) => window.__errs.push(String(e.message))); 0`);
  const links = () => t.js(`activeFloor().nodes.filter((n) => n.kind === 'link').map((n) => ({ id: n.id, type: n.data.type, target: n.data.target, title: n.title }))`);

  // drop a URL on the canvas
  await t.js(`(() => { const dt = new DataTransfer(); dt.setData('text/uri-list', 'https://example.com/docs'); viewport.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: 500, clientY: 400, bubbles: true, cancelable: true })); return 0; })()`);
  await t.sleep(400);
  let l = await links();
  t.check('dropping a URL creates a link node', l.length === 1 && l[0].type === 'url' && l[0].target === 'https://example.com/docs' && l[0].title === 'example.com', l);

  // drop an image file
  await t.js(`(async () => { const bin = atob('${PNG}'); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' })); viewport.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: 700, clientY: 400, bubbles: true, cancelable: true })); return 0; })()`);
  await t.sleep(900);
  l = await links();
  const img = l.find((x) => x.type === 'image');
  t.check('dropping an image creates an image node stored in app data', img && fs.existsSync(path.join(t.dataDir, 'note-images', img.target)), l);
  t.check('image node shows a preview', await t.js(`!!document.querySelector('.link-img[src^="data:image/png"]')`));

  // paste a URL on the canvas
  await t.js(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'https://github.com/x/y'); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return 0; })()`);
  await t.sleep(300);
  l = await links();
  t.check('pasting a URL creates a link node', l.some((x) => x.target === 'https://github.com/x/y'), l);
  // pasting while typing in a field must not create nodes
  const before = (await links()).length;
  await t.js(`(() => { const i = document.createElement('input'); document.body.append(i); i.focus(); const dt = new DataTransfer(); dt.setData('text/plain', 'https://typed.example'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); i.remove(); return 0; })()`);
  await t.sleep(200);
  t.check('paste into a text field is left alone', (await links()).length === before);

  // a file link and its actions
  const file = path.join(t.dataDir, 'notes.txt');
  fs.writeFileSync(file, 'hi');
  const fl = await t.js(`addLinkNode(activeFloor(), 'file', ${JSON.stringify(file)}).id`);
  const live = `rt.get(state.active).live.get('${fl}')`;
  t.check('file link shows its path', (await t.js(`${live}.el.querySelector('.link-target').textContent`)) === file);
  await t.js(`${live}.api.copy(); 0`);
  await t.sleep(300);
  t.check('copy puts the path on the clipboard', (await clipboard.readText()) === file);
  const missing = await t.js(`call('files:open', ${JSON.stringify(path.join(t.dataDir, 'gone.txt'))})`);
  t.check('open reports a missing file', /no longer exists/.test(missing), missing);

  // URL link: copy and open in a portal
  const ul = l.find((x) => x.type === 'url');
  const ulive = `rt.get(state.active).live.get('${ul.id}')`;
  await t.js(`${ulive}.api.copy(); 0`);
  await t.sleep(300);
  t.check('copy URL works', (await clipboard.readText()) === 'https://example.com/docs');
  await t.js(`${ulive}.api.openInPortal(); 0`);
  t.check('open in portal creates a portal node with the URL', await t.js(`activeFloor().nodes.some((n) => n.kind === 'portal' && n.data.url === 'https://example.com/docs')`));
  t.check('link buttons are labelled', (await t.js(`[...${ulive}.el.querySelectorAll('.link-actions button')].map((b) => b.textContent)`)).join() === 'Open,Open in a portal,Copy URL');
  t.check('no errors were raised', (await t.js(`window.__errs`)).length === 0, await t.js(`window.__errs`));
};
