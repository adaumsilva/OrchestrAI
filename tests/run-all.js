// npm test: unit tests (plain node) first, then the end-to-end tests (each in its own Electron process).
// Flaky checks must not be silently skipped: move them to tests/quarantine/ with a comment explaining why.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let failed = 0;
const unitDir = path.join(__dirname, 'unit');
for (const f of fs.readdirSync(unitDir).filter((x) => x.endsWith('.test.js'))) {
  console.log(`== unit/${f}`);
  if (spawnSync(process.execPath, [path.join(unitDir, f)], { stdio: 'inherit' }).status !== 0) failed++;
}
if (process.argv.includes('--unit-only')) process.exit(failed ? 1 : 0);
const e2e = spawnSync(process.execPath, [path.join(__dirname, 'e2e', 'run.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
if (e2e.status !== 0) failed++;
process.exit(failed ? 1 : 0);
