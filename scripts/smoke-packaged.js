// Runs the packaged app (from `npm run pack` or `npm run dist`) once in a throwaway profile and checks that it starts, a
// terminal runs a command and the orchestrai command works. Usage: node scripts/smoke-packaged.js [path-to-executable]
// On headless Linux run it under xvfb-run and add --no-sandbox through SMOKE_ARGS="--no-sandbox".
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
function find() {
  const candidates = {
    win32: [path.join(dist, 'win-unpacked', 'OrchestrAI.exe')],
    darwin: ['mac', 'mac-arm64', 'mac-universal'].map((d) => path.join(dist, d, 'OrchestrAI.app', 'Contents', 'MacOS', 'OrchestrAI')),
    linux: [path.join(dist, 'linux-unpacked', 'orchestrai'), path.join(dist, 'linux-unpacked', 'OrchestrAI')],
  }[process.platform] || [];
  return candidates.find((p) => fs.existsSync(p));
}

const exe = process.argv[2] || find();
if (!exe || !fs.existsSync(exe)) {
  console.error('No packaged app found. Run "npm run pack" first, or pass the executable path.');
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrai-smoke-'));
const out = path.join(profile, 'smoke.json');
const env = { ...process.env, ORCH_SMOKE_OUT: out, ORCH_NO_TRAY: '1', ORCH_NO_ONBOARDING: '1' };
delete env.ELECTRON_RUN_AS_NODE;
console.log('Launching', exe);
const r = spawnSync(exe, [`--user-data-dir=${path.join(profile, 'data')}`, ...(process.env.SMOKE_ARGS ? process.env.SMOKE_ARGS.split(' ') : [])], { env, stdio: 'inherit', timeout: 120000 });
let result = null;
try { result = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
console.log(JSON.stringify(result || { ok: false, error: 'the app wrote no result', exit: r.status, signal: r.signal }, null, 2));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(result && result.ok && r.status === 0 ? 0 : 1);
