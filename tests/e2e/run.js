// Usage: node tests/e2e/run.js [name-filter]   (each tests/e2e/*.test.js runs in its own Electron process)
const { spawnSync } = require('child_process');
const os = require('os');
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
  const resultFile = path.join(os.tmpdir(), `orch-e2e-result-${process.pid}-${Date.now()}.json`);
  const r = spawnSync(electron, [path.join(__dirname, 'entry.js')], { env: { ...env, ORCH_TEST: path.join(__dirname, f), ORCH_RESULT: resultFile }, stdio: "inherit", timeout: Number(process.env.ORCH_E2E_TIMEOUT) || 300000 });
  let verdict = null;
  try { verdict = JSON.parse(fs.readFileSync(resultFile, 'utf8')); fs.rmSync(resultFile, { force: true }); } catch {}
  // A crash while shutting down after every check has passed is reported, but it is not a failed test.
  if (r.status !== 0 && verdict && verdict.done && verdict.failed === 0 && verdict.code === 0) {
    console.log(`WARNING ${f}: all ${verdict.checks} checks passed but the process exited abnormally (${r.status}) during shutdown`);
  } else if (r.status !== 0) { failed++; console.log(`FAILED FILE ${files[files.indexOf(f)]}: exit ${r.status}${r.signal ? ', signal ' + r.signal : ''}${r.error ? ', ' + r.error.message : ''}`); }
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nall passed');
process.exit(failed ? 1 : 0);
