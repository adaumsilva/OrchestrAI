const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = require('../../src/services/storage');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-storage-'));
const def = path.join(tmp, 'default');
const moved = path.join(tmp, 'moved');
fs.mkdirSync(moved);
const pointer = path.join(tmp, 'pointer.json');

// no pointer -> default
assert.strictEqual(s.resolveUserData(def, pointer), def);
// valid pointer to an existing folder
fs.writeFileSync(pointer, JSON.stringify({ userData: moved }));
assert.strictEqual(s.resolveUserData(def, pointer), moved);
// pointer to a folder that vanished falls back to the default instead of starting with nothing
fs.writeFileSync(pointer, JSON.stringify({ userData: path.join(tmp, 'gone') }));
assert.strictEqual(s.resolveUserData(def, pointer), def);
// relative or malformed pointers are ignored
fs.writeFileSync(pointer, JSON.stringify({ userData: 'relative/dir' }));
assert.strictEqual(s.resolveUserData(def, pointer), def);
fs.writeFileSync(pointer, '{not json');
assert.strictEqual(s.resolveUserData(def, pointer), def);

// sizes
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'backups'), { recursive: true });
fs.mkdirSync(path.join(data, 'Cache'), { recursive: true });
fs.writeFileSync(path.join(data, 'workspace.json'), 'x'.repeat(100));
fs.writeFileSync(path.join(data, 'backups', 'a.json'), 'x'.repeat(40));
fs.writeFileSync(path.join(data, 'backups', 'b.json'), 'x'.repeat(60));
fs.writeFileSync(path.join(data, 'Cache', 'c'), 'x'.repeat(7));
fs.writeFileSync(path.join(data, 'mystery.bin'), 'x'.repeat(3));
const u = s.usage(data);
const by = Object.fromEntries(u.rows.map((r) => [r.id, r.bytes]));
assert.strictEqual(by.workspace, 100);
assert.strictEqual(by.backups, 100);
assert.strictEqual(by.cache, 7);
assert.strictEqual(by.other, 3);
assert.strictEqual(u.total, 210);
assert.strictEqual(s.sizeOf(path.join(tmp, 'does-not-exist')), 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('storage: all passed');
