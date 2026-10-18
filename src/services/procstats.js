// Per-terminal process statistics for the Task Manager: CPU, memory and the foreground process of each pty's process tree.
// One process-table snapshot per sample (PowerShell/CIM on Windows, `ps` elsewhere), shared by every terminal.
const { execFile } = require('child_process');

const WIN = process.platform === 'win32';
const CACHE_MS = 1200;
const IGNORED = /^(conhost|openconsole|winpty-agent)(\.exe)?$/i;

let pending = null;
let last = { at: 0, procs: null };
let prevCpu = new Map(); // pid -> cpu seconds at previous snapshot
let prevAt = 0;
let cores = require('os').cpus().length || 1;

const PS_SCRIPT = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,UserModeTime,KernelModeTime | ConvertTo-Json -Compress';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 15000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

// ps cputime: [[dd-]hh:]mm:ss[.cc]
function parseCpuTime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + +m[3] * 60 + +m[4];
}

async function snapshot() {
  if (WIN) {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT]);
    const raw = JSON.parse(out || '[]');
    return (Array.isArray(raw) ? raw : [raw]).map((p) => ({
      pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name || '', cmd: p.CommandLine || '',
      rss: p.WorkingSetSize || 0, cpu: ((p.UserModeTime || 0) + (p.KernelModeTime || 0)) / 1e7, // 100 ns units
    }));
  }
  const out = await run('ps', ['-A', '-o', 'pid=,ppid=,rss=,cputime=,args=']);
  return out.split('\n').map((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) return null;
    const cmd = m[5];
    return { pid: +m[1], ppid: +m[2], name: cmd.split(/\s+/)[0].split('/').pop(), cmd, rss: +m[3] * 1024, cpu: parseCpuTime(m[4]) };
  }).filter(Boolean);
}

async function procs() {
  if (last.procs && Date.now() - last.at < CACHE_MS) return last;
  if (!pending) {
    pending = snapshot().then((list) => {
      const now = Date.now();
      const dt = (now - prevAt) / 1000;
      for (const p of list) {
        const before = prevCpu.get(p.pid);
        p.cpuPct = before == null || dt <= 0 ? 0 : Math.max(0, ((p.cpu - before) / dt) * 100);
      }
      prevCpu = new Map(list.map((p) => [p.pid, p.cpu]));
      prevAt = now;
      last = { at: now, procs: list };
      return last;
    }).finally(() => { pending = null; });
  }
  return pending;
}

// targets: [{ id, pid }] -> { id: { pid, cpu, mem, count, fg: { pid, name, cmd } } } (cpu is percent of one core)
async function sample(targets) {
  const { procs: list } = await procs();
  const byPid = new Map(list.map((p) => [p.pid, p]));
  const children = new Map();
  for (const p of list) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const result = {};
  for (const { id, pid } of targets) {
    const root = byPid.get(pid);
    if (!root) { result[id] = { pid, gone: true }; continue; }
    let cpu = 0, mem = 0, count = 0, fg = root, fgDepth = 0;
    const seen = new Set();
    const walk = (p, depth) => {
      if (seen.has(p.pid)) return;
      seen.add(p.pid);
      cpu += p.cpuPct; mem += p.rss; count++;
      // The foreground process is the deepest descendant; among equals the newest pid.
      if (!IGNORED.test(p.name) && (depth > fgDepth || (depth === fgDepth && p.pid > fg.pid))) { fg = p; fgDepth = depth; }
      for (const c of children.get(p.pid) || []) walk(c, depth + 1);
    };
    walk(root, 0);
    result[id] = { pid, cpu: Math.round(cpu * 10) / 10, mem, count, fg: { pid: fg.pid, name: fg.name, cmd: String(fg.cmd).slice(0, 300) } };
  }
  return { cores, procs: result, at: Date.now() };
}

// Every process under rootPid (root included) from one snapshot list, each with its depth.
function treeOf(list, rootPid) {
  const children = new Map();
  for (const p of list) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const root = list.find((p) => p.pid === rootPid);
  if (!root) return [];
  const out = [], seen = new Set();
  const walk = (p, depth) => {
    if (seen.has(p.pid)) return;
    seen.add(p.pid);
    out.push({ pid: p.pid, ppid: p.ppid, name: p.name, cmd: String(p.cmd || '').slice(0, 300), rss: p.rss, cpu: Math.round((p.cpuPct || 0) * 10) / 10, depth });
    for (const c of children.get(p.pid) || []) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

// Process tree of one terminal (for the per-terminal Processes popover).
async function tree(rootPid) {
  const { procs: list } = await procs();
  return treeOf(list, rootPid);
}

// Which child processes to stop so the tree fits under limitBytes: biggest first, never the root shell or console helpers.
function pickVictims(treeList, limitBytes) {
  const total = treeList.reduce((a, p) => a + p.rss, 0);
  if (!(limitBytes > 0) || total <= limitBytes) return [];
  const root = treeList[0];
  const victims = [];
  let remaining = total;
  const byPid = new Map(treeList.map((p) => [p.pid, p]));
  const covered = (p) => { for (let q = byPid.get(p.ppid); q; q = byPid.get(q.ppid)) if (victims.includes(q)) return true; return false; };
  for (const p of [...treeList].filter((x) => x !== root && !IGNORED.test(x.name)).sort((a, b) => b.rss - a.rss)) {
    if (remaining <= limitBytes) break;
    if (covered(p)) continue;
    victims.push(p);
    // killing a process takes its subtree with it
    remaining -= treeOf(treeList.map((x) => ({ ...x })), p.pid).reduce((a, x) => a + x.rss, 0);
  }
  return victims;
}

// Stops pid and its children. Windows has no process groups here, so use taskkill /T.
function killTree(pid, force) {
  return new Promise((resolve) => {
    if (WIN) execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (err) => resolve(!err));
    else { try { process.kill(pid, force ? 'SIGKILL' : 'SIGTERM'); resolve(true); } catch { resolve(false); } }
  });
}

module.exports = { sample, tree, treeOf, pickVictims, killTree };
