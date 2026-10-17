// Usage: node tests/e2e/run.js [name-filter]   (each tests/e2e/*.test.js runs in its own Electron process)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');
const filter = process.argv[2] || '';
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f.includes(filter));
const env = { ...process.env, ORCH_DEBUG: '' };
delete env.ELECTRON_RUN_AS_NODE;
let failed = 0;
for (const f of files) {
  console.log(`\n== ${f}`);
  const r = spawnSync(electron, [path.join(__dirname, 'entry.js')], { env: { ...env, ORCH_TEST: path.join(__dirname, f) }, stdio: 'inherit', timeout: 120000 });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nall passed');
process.exit(failed ? 1 : 0);
