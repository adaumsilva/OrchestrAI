const fs = require('fs'), path = require('path');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

module.exports = async (t) => {
  const id = await t.js(`addNode('note', { title: 'N', data: { text: '' } }).id`);
  const live = `rt.get(state.active).live.get('${id}')`;
  const md = [
    '# Title', '', 'Some **bold** and `code` and [ok](https://example.com) and [bad](javascript:alert(1)).', '',
    '- one', '  - nested', '- [x] done', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '```js', 'const x = "hi"; // c', '```', '',
    '<script>window.__pwned = 1</script>', '<img src=x onerror="window.__pwned=2">', '![pic](images/missing.png)',
  ].join('\n');
  await t.js(`(() => { const e = ${live}; e.api.setText(${JSON.stringify(md)}); e.el.querySelector('.note-bar button:nth-child(2)').click(); })()`);
  await t.sleep(400);
  const r = await t.js(`(() => { const v = ${live}.el.querySelector('.note-view'); return {
    h1: !!v.querySelector('h1'), strong: !!v.querySelector('strong'), code: !!v.querySelector('p code'), table: v.querySelectorAll('td').length,
    nested: !!v.querySelector('ul ul'), task: !!v.querySelector('li.md-task input:checked'), kw: !!v.querySelector('.tok-k'), str: !!v.querySelector('.tok-s'), cm: !!v.querySelector('.tok-c'),
    copy: !!v.querySelector('.md-copy'), scripts: v.querySelectorAll('script, img[onerror]').length, pwned: window.__pwned || 0,
    links: [...v.querySelectorAll('a')].map((a) => a.getAttribute('href')), text: v.textContent } })()`);
  t.check('renders headings, emphasis, inline code', r.h1 && r.strong && r.code, r);
  t.check('renders tables, nested lists, task boxes', r.table === 2 && r.nested && r.task, r);
  t.check('highlights code blocks and offers copy', r.kw && r.str && r.cm && r.copy, r);
  t.check('does not execute or inject HTML', r.scripts === 0 && r.pwned === 0 && r.text.includes('<script>'), r);
  t.check('only http(s) links become anchors', r.links.length === 1 && r.links[0] === 'https://example.com', r.links);

  // images are stored under app data and render from there
  const saved = await t.js(`call('notes:saveImage', '${PNG}', 'png')`);
  t.check('image saved to app data', saved.name && fs.existsSync(path.join(t.dataDir, 'note-images', saved.name)), saved);
  await t.js(`${live}.api.setText('![pixel](images/${saved.name})')`);
  await t.sleep(600);
  t.check('stored image renders', await t.js(`!!${live}.el.querySelector('.note-view img[src^="data:image/png"]')`));
  const bad = await t.js(`call('notes:image', '../../workspace.json')`);
  t.check('image path traversal is refused', bad === null);

  // file-backed note follows external changes and saves edits
  const file = path.join(t.dataDir, 'backed.md');
  fs.writeFileSync(file, '# from disk');
  await t.js(`(async () => { ${live}.node.data.file = ${JSON.stringify(file)}; await call('notes:watch', '${id}', ${JSON.stringify(file)}); })()`);
  await t.sleep(300);
  fs.writeFileSync(file, '# changed externally');
  await t.sleep(2200);
  t.check('external change reloads the note', (await t.js(`${live}.api.getText()`)) === '# changed externally');
  await t.js(`(() => { const ta = ${live}.el.querySelector('textarea'); ta.value = '# edited in app'; ta.dispatchEvent(new Event('input')); })()`);
  await t.sleep(1200);
  t.check('edits are saved to the file', fs.readFileSync(file, 'utf8') === '# edited in app');
  t.check('mode persists in node data', await t.js(`${live}.node.data.mode === 'preview'`));
};
