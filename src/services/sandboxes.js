// Docker Sandboxes: list, create and test the sandboxes of the `docker sandbox` command. OrchestrAI only attaches terminals
// to them; it never deletes a sandbox (several terminals may share one). The docker command can be replaced for tests with
// ORCH_CLI_DOCKER='["node","C:/fake-docker.js"]'.
const { execFile } = require('child_process');
const os = require('os');
const { app } = require('electron');

function cliFor() {
  const override = process.env.ORCH_CLI_DOCKER;
  if (override) { try { const a = JSON.parse(override); return { cmd: a[0], pre: a.slice(1) }; } catch {} }
  return { cmd: 'docker', pre: [] };
}

function run(args, timeout = 60000) {
  const { cmd, pre } = cliFor();
  return new Promise((resolve) => {
    execFile(cmd, [...pre, ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: String(stdout || ''), err: String(stderr || (err && err.code === 'ENOENT' ? 'The docker command was not found on PATH.' : err ? err.message : '')) });
    });
  });
}

// `docker sandbox ls` prints a table. Columns are found from the header row (separated by two or more spaces) so the parser
// does not depend on their order; unknown columns are ignored.
function parseList(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0];
  const cols = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(header))) cols.push({ name: m[0].trim().toLowerCase(), start: m.index });
  const field = (line, i) => line.slice(cols[i].start, i + 1 < cols.length ? cols[i + 1].start : undefined).trim();
  const idx = (...names) => cols.findIndex((c) => names.some((n) => c.name === n));
  const iName = idx('sandbox', 'name', 'sandbox id', 'id'), iAgent = idx('agent'), iStatus = idx('status', 'state'), iWs = idx('workspace', 'workspaces', 'path');
  return lines.slice(1).map((l) => ({
    name: iName >= 0 ? field(l, iName) : l.trim().split(/\s+/)[0],
    agent: iAgent >= 0 ? field(l, iAgent) : '',
    status: iStatus >= 0 ? field(l, iStatus) : '',
    workspace: iWs >= 0 ? field(l, iWs) : '',
  })).filter((s) => s.name);
}

function register(ipcMain) {
  ipcMain.handle('sandbox:cli', () => cliFor());

  ipcMain.handle('sandbox:list', async () => {
    const r = await run(['sandbox', 'ls'], 30000);
    if (!r.ok) return { ok: false, error: (r.err || r.out).trim() || `docker sandbox ls exited with ${r.code}`, sandboxes: [] };
    return { ok: true, sandboxes: parseList(r.out), raw: r.out };
  });

  ipcMain.handle('sandbox:create', async (_e, { agent, workspace, name }) => {
    agent = String(agent || '').trim(); workspace = String(workspace || '').trim(); name = String(name || '').trim();
    if (!agent || !workspace) return { ok: false, error: 'Choose an agent and a workspace folder.' };
    if (name && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return { ok: false, error: 'The name may only contain letters, digits, dots, dashes and underscores.' };
    const r = await run(['sandbox', 'create', ...(name ? ['--name', name] : []), agent, workspace], 10 * 60 * 1000);
    if (!r.ok) return { ok: false, error: (r.err || r.out).trim() || `exited with ${r.code}`, output: r.out + r.err };
    return { ok: true, output: r.out + r.err, name: name || undefined };
  });

  // Runs the checks one by one and keeps every command and its output, so a failure can be copied into a bug report.
  ipcMain.handle('sandbox:test', async (_e, name) => {
    const token = 'orchestrai-sandbox-ok';
    const steps = [];
    const step = async (label, args, check) => {
      const r = await run(args, 60000);
      const ok = r.ok && (!check || check(r));
      steps.push({ label, command: ['docker', ...args].join(' '), code: r.code, ok, stdout: r.out.trim(), stderr: r.err.trim() });
      return ok;
    };
    let ok = await step('Docker is installed', ['version', '--format', '{{.Client.Version}}']);
    if (ok) ok = await step('The sandbox command works', ['sandbox', 'ls']);
    if (ok && name) ok = await step(`Run a command in "${name}"`, ['sandbox', 'exec', name, 'echo', token], (r) => r.out.includes(token));
    const diagnostic = [
      `OrchestrAI ${app.getVersion()} on ${os.platform()} ${os.release()} (${os.arch()})`,
      ...steps.map((s) => `\n[${s.ok ? 'ok' : 'FAILED'}] ${s.label}\n$ ${s.command}\nexit ${s.code}${s.stdout ? '\n' + s.stdout : ''}${s.stderr ? '\n' + s.stderr : ''}`),
    ].join('\n');
    return { ok, steps, diagnostic };
  });
}

module.exports = { register, parseList };
