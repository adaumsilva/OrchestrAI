// Smoke test for packaged builds: ORCH_SMOKE_OUT=<file> makes the app check itself once it has started, write the result as
// JSON and exit with 0 (all good) or 1. It proves the interface loads, a terminal runs a command, and the `orchestrai`
// command is on the terminal's PATH and runs from the packaged files. Used by CI on every platform and by hand after packaging.
const fs = require('fs');

async function run(win, outFile) {
  const result = { ok: false, checks: {}, platform: process.platform, arch: process.arch, packaged: require('electron').app.isPackaged };
  const js = (code) => win.webContents.executeJavaScript(code);
  const binDir = require('path').join(__dirname, '..', 'bin').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  result.bin = { dir: binDir, files: (() => { try { return fs.readdirSync(binDir); } catch (e) { return String(e.code); } })(), pathKeys: Object.keys(process.env).filter((k) => k.toLowerCase() === 'path') };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms) => { for (let i = 0; i < ms / 250; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(250); } return false; };
  try {
    result.checks.interface = !!(await waitFor(() => js('typeof state !== "undefined" && typeof rt !== "undefined" && rt.size > 0'), 30000));
    const id = await waitFor(() => js('(() => { const n = activeFloor().nodes.find((x) => x.kind === "terminal"); return n && rt.get(state.active).live.get(n.id) ? n.id : null; })()'), 20000);
    result.checks.terminalNode = !!id;
    if (id) {
      await sleep(2500); // let the shell print its prompt
      const run = (cmd) => js(`rt.get(state.active).live.get(${JSON.stringify(id)}).api.send(${JSON.stringify(cmd)})`);
      const screen = () => js(`rt.get(state.active).live.get(${JSON.stringify(id)}).api.readScreen()`);
      await run('echo smoke-' + 'ok');
      result.checks.shellRuns = !!(await waitFor(async () => /smoke-ok/.test(await screen()), 15000));
      if (!result.checks.shellRuns) result.screen = String(await screen()).slice(-600);
      await run('orchestrai help');
      result.checks.cliOnPath = !!(await waitFor(async () => /direct the OrchestrAI canvas/i.test(await screen()), 20000));
      if (!result.checks.cliOnPath) result.screen = String(await screen()).slice(-600);
    }
    result.ok = Object.values(result.checks).every(Boolean);
  } catch (e) {
    result.error = String(e && e.message || e);
  }
  try { fs.writeFileSync(outFile, JSON.stringify(result, null, 2)); } catch {}
  require('electron').app.exit(result.ok ? 0 : 1);
}

module.exports = { run };
