const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const root = path.join(t.dataDir, 'idetest');
  const touch = (...p) => { const f = path.join(root, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f; };
  touch('Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
  touch('Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd');
  const savedPath = process.env.PATH, savedLocal = process.env.LOCALAPPDATA;
  process.env.PATH = '';
  process.env.LOCALAPPDATA = root;
  const list = await t.js(`call('ide:list', true)`);
  process.env.PATH = savedPath; process.env.LOCALAPPDATA = savedLocal;
  t.check('detects VS Code and Cursor from their install folders', list.some((i) => i.id === 'vscode') && list.some((i) => i.id === 'cursor'), list);

  // opening a folder and a specific file (with a line) in a stand-in editor
  const out = path.join(root, 'args.json');
  process.env.FAKE_IDE_OUT = out;
  process.env.ORCH_IDE_EXTRA = JSON.stringify([{ id: 'fake', label: 'Fake IDE', cmd: ['node', path.join(__dirname, 'fake-ide.js')], goto: true }]);
  const dir = path.join(root, 'project'); fs.mkdirSync(dir);
  const file = path.join(dir, 'main.js'); fs.writeFileSync(file, 'x');
  const wait = async () => { for (let i = 0; i < 40 && !fs.existsSync(out); i++) await t.sleep(100); return fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null; };

  let r = await t.js(`call('ide:open', 'fake', ${JSON.stringify(dir)})`);
  let args = await wait();
  t.check('opens the floor folder', r.ok && args && args[0] === dir, { r, args });
  fs.rmSync(out);
  r = await t.js(`call('ide:open', 'fake', ${JSON.stringify(file)}, 12)`);
  args = await wait();
  t.check('opens a specific file at a line', r.ok && args && args[0] === '-g' && args[1] === `${file}:12`, { r, args });

  const bad = await t.js(`call('ide:open', 'nope', ${JSON.stringify(dir)})`);
  t.check('unknown editor is reported', !bad.ok, bad);
  const missing = await t.js(`call('ide:open', 'fake', ${JSON.stringify(path.join(root, 'gone'))})`);
  t.check('missing path is reported', !missing.ok, missing);

  // the UI path: preferred editor per workspace, via the floor's folder
  await t.js(`(async () => { await ideList(true); activeFloor().dir = ${JSON.stringify(dir)}; currentWs().ide = 'fake'; 0; })()`);
  fs.rmSync(out, { force: true });
  await t.js(`openInIde(activeFloor().dir, { floor: activeFloor() }); 0`);
  args = await wait();
  t.check('openInIde uses the workspace preference', args && args[0] === dir, args);
  t.check('floor menu offers Open in IDE', await t.js(`(() => { floorMenu(activeFloor()); const ok = [...document.querySelectorAll('#modal-root button')].some((b) => b.textContent === 'Open in IDE'); closeModal(); return ok; })()`));
};
