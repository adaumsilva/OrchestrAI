// node tests/unit/schedule.test.js
const assert = require('assert');
const s = require('../../src/services/schedule');
const at = (y, mo, d, h, m) => new Date(y, mo - 1, d, h, m).getTime();

// once
assert.strictEqual(s.nextRun({ kind: 'once', at: at(2030, 1, 1, 9, 0) }, at(2029, 12, 31, 0, 0)), at(2030, 1, 1, 9, 0));
assert.strictEqual(s.nextRun({ kind: 'once', at: at(2030, 1, 1, 9, 0) }, at(2030, 1, 1, 9, 0)), null);
// every: stays on the anchor grid, strictly after `from`
const e = { kind: 'every', minutes: 30, anchor: at(2030, 1, 1, 9, 0) };
assert.strictEqual(s.nextRun(e, at(2030, 1, 1, 9, 0)), at(2030, 1, 1, 9, 30));
assert.strictEqual(s.nextRun(e, at(2030, 1, 1, 9, 29)), at(2030, 1, 1, 9, 30));
assert.strictEqual(s.nextRun(e, at(2030, 1, 1, 10, 31)), at(2030, 1, 1, 11, 0));
assert.strictEqual(s.nextRun(e, at(2029, 1, 1, 0, 0)), at(2030, 1, 1, 9, 0));
// daily: today if still ahead, otherwise tomorrow (incl. month rollover)
const d = { kind: 'daily', time: '08:15' };
assert.strictEqual(s.nextRun(d, at(2030, 3, 10, 7, 0)), at(2030, 3, 10, 8, 15));
assert.strictEqual(s.nextRun(d, at(2030, 3, 10, 8, 15)), at(2030, 3, 11, 8, 15));
assert.strictEqual(s.nextRun(d, at(2030, 3, 31, 9, 0)), at(2030, 4, 1, 8, 15));
// weekly: 2030-03-10 is a Sunday
const w = { kind: 'weekly', time: '18:00', days: [1, 3] };
assert.strictEqual(new Date(at(2030, 3, 10, 12, 0)).getDay(), 0);
assert.strictEqual(s.nextRun(w, at(2030, 3, 10, 12, 0)), at(2030, 3, 11, 18, 0)); // Monday
assert.strictEqual(s.nextRun(w, at(2030, 3, 11, 18, 0)), at(2030, 3, 13, 18, 0)); // Wednesday
assert.strictEqual(s.nextRun(w, at(2030, 3, 13, 18, 1)), at(2030, 3, 18, 18, 0)); // next Monday
// validation
assert.ok(s.validate({ kind: 'daily', time: '25:00' }));
assert.ok(s.validate({ kind: 'every', minutes: 0 }));
assert.ok(s.validate({ kind: 'weekly', time: '10:00', days: [] }));
assert.strictEqual(s.validate({ kind: 'daily', time: '7:05' }), null);
assert.strictEqual(s.nextRun({ kind: 'daily', time: 'bad' }, 0), null);
console.log('schedule: all passed');
