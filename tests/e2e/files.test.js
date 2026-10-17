const fs = require('fs'), path = require('path');

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const root = path.join(t.dataDir, 'filestest');
  const outside = path.join(t.dataDir, 'outside');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'a.js'), 'const answer = 42; // find-me-needle\nfunction f() { return "x"; }\n');
  fs.writeFileSync(path.join(root, 'notes.md'), '# Title\n\nSome *text*.\n');
  fs.writeFileSync(path.join(root, 'pic.png'), PNG);
  fs.writeFileSync(path.join(root, 'doc.pdf'), '%PDF-1.4\n%%EOF\n');
  fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'second file with the needle\n');
  fs.writeFileSync(path.join(outside, 'secret.png'), PNG);

  const id = await t.js(`addNode('files', { x: 60, y: 60, w: 760, h: 480, data: { root: ${JSON.stringify(root)} } }, activeFloor()).id`);
  await t.sleep(1200);
  const q = (sel) => t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; return ${sel}; })()`);
  const click = (sel, n = 0) => t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; el.querySelectorAll(${JSON.stringify(sel)})[${n}].click(); return 0; })()`);
  const names = () => q(`[...el.querySelectorAll('.tree-item')].map((x) => x.textContent.trim())`);

  t.check('tree lists the folder', (await names()).join('|').includes('a.js') && (await names()).join('|').includes('sub'), await names());

  // ---- tabs ----
  await click('.tree-item', (await names()).findIndex((n) => n.includes('a.js')));
  await t.sleep(400);
  await click('.tree-item', (await names()).findIndex((n) => n.includes('notes.md')));
  await t.sleep(400);
  t.check('two files open in two tabs', await q(`el.querySelectorAll('.tabbar .tab').length`) === 2);
  // edit the active (markdown) tab
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; const ta = el.querySelector('textarea'); ta.value = '# Changed\\n'; ta.dispatchEvent(new Event('input')); return 0; })()`);
  t.check('edited tab shows a dirty marker', await q(`el.querySelectorAll('.tabbar .dirty-dot').length`) === 1);
  t.check('markdown tab offers a preview', await q(`getComputedStyle([...el.querySelectorAll('button')].find((b) => b.textContent === 'Preview')).display !== 'none'`));
  await click('.tabbar .tab', 0); await t.sleep(200);
  const hlText = await q(`({ spans: el.querySelectorAll('.hl-layer .tok-k, .hl-layer .tok-c, .hl-layer .tok-n').length, text: el.querySelector('.hl-layer').textContent.includes('answer') })`);
  t.check('code is syntax highlighted', hlText.spans >= 3 && hlText.text, hlText);
  await click('.tabbar .tab', 1); await t.sleep(200);
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; [...el.querySelectorAll('button')].find((b) => b.textContent === 'Save all').click(); return 0; })()`);
  await t.sleep(500);
  t.check('Save all writes the modified tabs', fs.readFileSync(path.join(root, 'notes.md'), 'utf8').startsWith('# Changed') && await q(`el.querySelectorAll('.tabbar .dirty-dot').length`) === 0);
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; [...el.querySelectorAll('button')].find((b) => b.textContent === 'Preview').click(); return 0; })()`);
  t.check('markdown preview renders', await q(`el.querySelector('.md-pane h1')?.textContent`) === 'Changed');

  // ---- media ----
  await click('.tree-item', (await names()).findIndex((n) => n.includes('pic.png')));
  await t.sleep(700);
  const img = await q(`(() => { const i = el.querySelector('.media-img'); return i && { src: i.src, w: i.naturalWidth }; })()`);
  t.check('image opens in a media tab through the restricted protocol', img && /^orchestrai-file:/.test(img.src) && img.w === 1, img);
  await click('.tree-item', (await names()).findIndex((n) => n.includes('doc.pdf')));
  await t.sleep(500);
  t.check('pdf opens in a frame', await q(`!!el.querySelector('iframe.media-pdf')?.src.startsWith('orchestrai-file:')`));

  const { net } = require('electron'); // the handler lives in the main process, so ask it from here (the page's CSP blocks fetch())
  const fetchStatus = (p) => net.fetch('orchestrai-file://f/?p=' + encodeURIComponent(p)).then((r) => ({ s: r.status, type: r.headers.get('content-type') })).catch((e) => ({ s: String(e) }));
  const okImg = await fetchStatus(path.join(root, 'pic.png'));
  t.check('allowed image is served', okImg.s === 200 && /image\/png/.test(okImg.type), okImg);
  t.check('image outside the opened folder is refused', (await fetchStatus(path.join(outside, 'secret.png'))).s === 403);
  t.check('non-media file is refused even inside the folder', (await fetchStatus(path.join(root, 'a.js'))).s === 403);
  t.check('path traversal is refused', (await fetchStatus(path.join(root, '..', 'outside', 'secret.png'))).s === 403);
  t.check('media API refuses outside files', (await call('files:media', path.join(outside, 'secret.png'))).error !== undefined);

  // ---- grid ----
  await click('button[title="Switch between list and icon grid"]');
  await t.sleep(600);
  t.check('grid view shows icon cells', await q(`el.querySelectorAll('.icon-cell').length`) >= 5);
  await click('.icon-cell', 0); // the "sub" folder sorts first
  await t.sleep(500);
  t.check('clicking a folder in the grid navigates into it', await q(`[...el.querySelectorAll('.icon-name')].map((x) => x.textContent).join()`) === 'b.txt');
  await click('button[title="Switch between list and icon grid"]');
  await t.sleep(400);

  // ---- content search ----
  const g = await call('files:grep', root, 'needle');
  t.check('content search returns file, line and snippet', g.results.length === 2 && g.results.some((r) => r.path.endsWith('a.js') && r.line === 1 && /find-me-needle/.test(r.text)), g);
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; const sel = el.querySelector('select'); sel.value = 'content'; sel.dispatchEvent(new Event('change')); const s = el.querySelector('input[placeholder="Search"]'); s.value = 'needle'; s.dispatchEvent(new Event('input')); return 0; })()`);
  await t.sleep(900);
  t.check('search box lists matches with line numbers', await q(`[...el.querySelectorAll('.grep-hit')].map((x) => x.firstChild.textContent).sort().join()`) === 'a.js:1,sub/b.txt:1');
  await click('.grep-hit', 0); await t.sleep(500);
  t.check('clicking a hit opens the file', await q(`el.querySelector('.tabbar .tab.active')?.title`) === path.join(root, 'a.js'));
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; const s = el.querySelector('input[placeholder="Search"]'); s.value = ''; s.dispatchEvent(new Event('input')); return 0; })()`);
  await t.sleep(700);

  // ---- clipboard ----
  const a = path.join(root, 'a.js'), sub = path.join(root, 'sub');
  let r = await call('files:transfer', [a], sub, 'copy');
  t.check('copy puts the file in the folder', r.ok && fs.existsSync(path.join(sub, 'a.js')) && fs.existsSync(a), r);
  r = await call('files:transfer', [a], sub, 'copy');
  t.check('a second copy gets a free name', r.ok && path.basename(r.made[0]) === 'a copy.js', r);
  r = await call('files:transfer', [path.join(root, 'notes.md')], sub, 'move');
  t.check('move removes the original', r.ok && !fs.existsSync(path.join(root, 'notes.md')) && fs.existsSync(path.join(sub, 'notes.md')), r);
  r = await call('files:transfer', [sub], path.join(sub, 'deeper-nope'), 'copy').catch(() => ({}));
  fs.mkdirSync(path.join(sub, 'inner'));
  r = await call('files:transfer', [sub], path.join(sub, 'inner'), 'copy');
  t.check('a folder cannot be copied into itself', !!r.error && /itself/.test(r.error), r);

  // UI clipboard via keyboard on the tree
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; const items = [...el.querySelectorAll('.tree-item')]; items.find((x) => x.textContent.includes('pic.png')).click(); return 0; })()`);
  await t.sleep(300);
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; const tr = el.querySelector('.tree'); tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); return fileClipboard.paths.length; })()`);
  const clip = await t.js(`({ mode: fileClipboard.mode, paths: fileClipboard.paths.map((p) => p.split(/[\\\\/]/).pop()) })`);
  t.check('Ctrl+C on the tree fills the file clipboard', clip.mode === 'copy' && clip.paths[0] === 'pic.png', clip);

  // ---- watcher failure ----
  await t.js(`(() => { const el = rt.get(state.active).live.get('${id}').el; const i = el.querySelector('input'); i.value = ${JSON.stringify(path.join(t.dataDir, 'does-not-exist'))}; i.dispatchEvent(new Event('change')); return 0; })()`);
  await t.sleep(900);
  t.check('a failed watcher shows a Retry button', await q(`[...el.querySelectorAll('button')].some((b) => b.textContent === 'Retry')`));
};
