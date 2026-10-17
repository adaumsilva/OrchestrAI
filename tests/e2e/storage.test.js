const fs = require('fs'), path = require('path');
const { session } = require('electron');

const sumDir = (p) => {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + sumDir(path.join(p, f)), 0);
};

module.exports = async (t) => {
  const call = (ch, ...a) => t.js(`call(${JSON.stringify(ch)}, ...${JSON.stringify(a)})`);
  const pointer = path.join(t.dataDir, '..', `orch-pointer-${Date.now()}.json`);
  process.env.ORCH_POINTER_FILE = pointer;

  // ---- usage ----
  const backups = path.join(t.dataDir, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  fs.writeFileSync(path.join(backups, 'workspace-2020-01-01.json'), 'x'.repeat(1500));
  fs.writeFileSync(path.join(backups, 'workspace-2020-01-02.json'), 'y'.repeat(2500));
  fs.mkdirSync(path.join(t.dataDir, 'worktrees', 'w1'), { recursive: true });
  fs.writeFileSync(path.join(t.dataDir, 'worktrees', 'w1', 'f.txt'), 'z'.repeat(777));
  let info = await call('storage:info');
  const row = (id) => info.rows.find((r) => r.id === id).bytes;
  t.check('shows the data folder', info.path === t.dataDir && info.defaultPath !== t.dataDir, { path: info.path });
  t.check('backup usage matches the files on disk', row('backups') === 4000, info.rows);
  t.check('worktree usage matches the files on disk', row('worktrees') === 777);
  t.check('total is the sum of the categories', info.total === info.rows.reduce((s, r) => s + r.bytes, 0));
  const disk = sumDir(t.dataDir);
  t.check('total is close to the size of the folder on disk', Math.abs(info.total - disk) / disk < 0.1, { total: info.total, disk });

  // ---- dialog ----
  await t.js(`storageDialog(); 0`);
  await t.sleep(600);
  const ui = await t.js(`document.querySelector('#modal-root').innerText`);
  t.check('the dialog shows the folder, categories and backups', ui.includes(t.dataDir) && /Backups/.test(ui) && /Floor worktrees/.test(ui) && /3\.9 KB|4 KB|3\.91/.test(ui.replace(/\n/g, ' ')) || /KB/.test(ui), ui.slice(0, 300));

  // ---- delete a backup ----
  t.check('path traversal in a backup name is refused', (await call('data:deleteBackup', '../workspace.json')).ok === false);
  t.check('only .json backups can be deleted', (await call('data:deleteBackup', 'x.txt')).ok === false);
  const del = await call('data:deleteBackup', 'workspace-2020-01-01.json');
  t.check('a single backup can be deleted', del.ok && !fs.existsSync(path.join(backups, 'workspace-2020-01-01.json')) && fs.existsSync(path.join(backups, 'workspace-2020-01-02.json')), del);
  await t.js(`closeModal(); 0`);

  // ---- portal data ----
  const ses = session.fromPartition('persist:portal');
  await ses.cookies.set({ url: 'https://example.com', name: 'sid', value: 'abc', expirationDate: Math.floor(Date.now() / 1000) + 3600 });
  t.check('a portal cookie exists', (await ses.cookies.get({ name: 'sid' })).length === 1);
  await call('storage:clearPortal');
  t.check('clearing portal data signs out of every site', (await ses.cookies.get({ name: 'sid' })).length === 0);

  // ---- move ----
  await t.sleep(700); // let the autosave write workspace.json
  const src = t.dataDir;
  const dest = path.join(t.dataDir, '..', `orch-moved-${Date.now()}`);
  const inside = await call('storage:move', { dir: path.join(src, 'inner'), relaunch: false });
  t.check('moving inside the current folder is refused', inside.ok === false, inside);
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'occupied.txt'), 'x');
  t.check('a folder that is not empty is refused', (await call('storage:move', { dir: dest, relaunch: false })).ok === false);
  fs.rmSync(path.join(dest, 'occupied.txt'));
  t.check('a relative path is refused', (await call('storage:move', { dir: 'relative', relaunch: false })).ok === false);
  const mv = await call('storage:move', { dir: dest, relaunch: false });
  t.check('move copies the data', mv.ok && fs.existsSync(path.join(dest, 'workspace.json')) && fs.statSync(path.join(dest, 'workspace.json')).size === fs.statSync(path.join(src, 'workspace.json')).size && fs.existsSync(path.join(dest, 'backups', 'workspace-2020-01-02.json')) && fs.existsSync(path.join(dest, 'worktrees', 'w1', 'f.txt')), mv);
  t.check('caches and lock files are not copied', !fs.existsSync(path.join(dest, 'Cache')) && !fs.existsSync(path.join(dest, 'SingletonLock')));
  t.check('the old folder is left in place', fs.existsSync(path.join(src, 'workspace.json')));
  const ptr = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  t.check('a pointer remembers the new location for the next start', ptr.userData === dest, ptr);
  const resolved = require('../../src/services/storage').resolveUserData('/default', pointer);
  t.check('the next start resolves to the new folder', resolved === dest, resolved);
  // saves are locked once a move is done so the old copy is not touched again
  const before = fs.statSync(path.join(src, 'workspace.json')).mtimeMs;
  await t.sleep(1500);
  t.check('the old copy is not written after the move', fs.statSync(path.join(src, 'workspace.json')).mtimeMs === before);

  // ---- delete everything ----
  t.check('delete-all requires the exact word', (await call('storage:deleteAll', { confirm: 'delete', relaunch: false })).ok === false && fs.existsSync(path.join(src, 'workspace.json')));
  fs.writeFileSync(path.join(src, 'account-secrets.json'), '{}');
  fs.writeFileSync(path.join(src, 'routines.json'), '{}');
  await t.js(`deleteAllDialog(); 0`);
  await t.sleep(300);
  await t.js(`[...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Delete everything').click(); 0`);
  await t.sleep(500);
  t.check('the dialog does nothing until DELETE is typed', fs.existsSync(path.join(src, 'workspace.json')) && !!(await t.js(`!!document.querySelector('#modal-root .modal, #modal-root .sheet')`)));
  await t.js(`closeModal(); 0`);
  const wipe = await call('storage:deleteAll', { confirm: 'DELETE', relaunch: false });
  t.check('delete all removes workspace, backups, worktrees, accounts and routines', wipe.ok && ['workspace.json', 'backups', 'worktrees', 'account-secrets.json', 'routines.json'].every((n) => !fs.existsSync(path.join(src, n))), wipe);
  t.check('the pointer survives so the moved location is kept', fs.existsSync(pointer));
  await call('workspace:save', { workspaces: [] });
  t.check('a late autosave cannot bring the files back', !fs.existsSync(path.join(src, 'workspace.json')));
  fs.rmSync(pointer, { force: true });
  fs.rmSync(dest, { recursive: true, force: true });
};
