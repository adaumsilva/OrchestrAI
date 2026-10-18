// node tests/unit/procstats.test.js
const assert = require('assert');
const { treeOf, pickVictims } = require('../../src/services/procstats');
const MB = 1024 * 1024;
const list = [
  { pid: 1, ppid: 0, name: 'shell', rss: 50 * MB }, { pid: 2, ppid: 1, name: 'node', rss: 400 * MB },
  { pid: 3, ppid: 2, name: 'helper', rss: 100 * MB }, { pid: 4, ppid: 1, name: 'small', rss: 10 * MB },
  { pid: 5, ppid: 1, name: 'conhost.exe', rss: 90 * MB }, { pid: 9, ppid: 0, name: 'other', rss: 999 * MB },
];
const tree = treeOf(list, 1);
assert.deepStrictEqual(tree.map((p) => p.pid), [1, 2, 3, 4, 5]);
assert.strictEqual(tree[2].depth, 2);
assert.deepStrictEqual(treeOf(list, 77), []);
assert.deepStrictEqual(pickVictims(tree, 0), []); // no limit
assert.deepStrictEqual(pickVictims(tree, 1000 * MB), []); // under the limit
// over: the biggest child goes (taking its helper with it); the shell and console helper are never picked
assert.deepStrictEqual(pickVictims(tree, 300 * MB).map((p) => p.pid), [2]);
// a limit nothing can satisfy stops every child but still keeps the shell
assert.deepStrictEqual(pickVictims(tree, 1 * MB).map((p) => p.pid), [2, 4]);
console.log('procstats ok');
