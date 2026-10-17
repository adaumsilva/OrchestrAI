// Catalog sanity: no empty translations, placeholders kept in patterns, and the translator's matching behaves.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '../../src/renderer/locales');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const ctx = { I18N_CATALOGS: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dir, file), 'utf8'), ctx);
  const [code, cat] = Object.entries(ctx.I18N_CATALOGS)[0] || [];
  assert.ok(code && cat, `${file} registers a catalog`);
  assert.ok(cat.name, `${file} has a language name`);
  const exact = Object.entries(cat.exact || {});
  assert.ok(exact.length > 100, `${file} has a useful number of entries (${exact.length})`);
  for (const [en, tr] of exact) {
    assert.ok(typeof tr === 'string' && tr.trim(), `${code}: empty translation for "${en}"`);
    // a translation that only differs by case/whitespace is fine, but leaving a placeholder behind is not
    assert.ok(!/\{\d+\}/.test(tr), `${code}: placeholder in exact entry "${en}"`);
  }
  for (const [en, tr] of cat.patterns || []) {
    const need = [...en.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join();
    const have = [...tr.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join();
    assert.strictEqual(have, need, `${code}: pattern "${en}" must keep the same placeholders`);
  }
  // the pattern compiler must not throw on any pattern
  for (const [en] of cat.patterns || []) new RegExp('^' + en.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, '(.+?)') + '$');
  console.log(`i18n ${code}: ${exact.length} entries, ${(cat.patterns || []).length} patterns ok`);
}
console.log('i18n: all passed');
