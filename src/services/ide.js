// Detects installed editors/IDEs and opens folders or files in them. Detection looks for each editor's command line launcher on
// PATH and in the usual per-user install folders; nothing is executed to probe (only file existence is checked).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const win = process.platform === 'win32';
// Install locations are read at call time so tests can point them at a fake tree.
const localDir = () => process.env.LOCALAPPDATA || '';
const pfDir = () => process.env.ProgramFiles || 'C:\\Program Files';

// gotoFile: how a "file:line" argument is passed (VS Code family), otherwise only the path is passed.
const catalog = () => {
  const local = localDir(), pf = pfDir();
  return [
  { id: 'vscode', label: 'Visual Studio Code', cmds: ['code'], paths: [`${local}\\Programs\\Microsoft VS Code\\bin\\code.cmd`, `${pf}\\Microsoft VS Code\\bin\\code.cmd`, '/usr/local/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'], goto: true },
  { id: 'cursor', label: 'Cursor', cmds: ['cursor'], paths: [`${local}\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd`, '/usr/local/bin/cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'], goto: true },
  { id: 'windsurf', label: 'Windsurf', cmds: ['windsurf'], paths: [`${local}\\Programs\\Windsurf\\bin\\windsurf.cmd`], goto: true },
  { id: 'vscode-insiders', label: 'VS Code Insiders', cmds: ['code-insiders'], paths: [`${local}\\Programs\\Microsoft VS Code Insiders\\bin\\code-insiders.cmd`], goto: true },
  { id: 'zed', label: 'Zed', cmds: ['zed'], paths: [`${local}\\Programs\\Zed\\bin\\zed.exe`, '/usr/local/bin/zed', '/Applications/Zed.app/Contents/MacOS/cli'] },
  { id: 'sublime', label: 'Sublime Text', cmds: ['subl'], paths: [`${pf}\\Sublime Text\\subl.exe`, '/usr/local/bin/subl'] },
  { id: 'idea', label: 'IntelliJ IDEA', cmds: ['idea', 'idea64'], paths: [] },
  { id: 'webstorm', label: 'WebStorm', cmds: ['webstorm', 'webstorm64'], paths: [] },
  { id: 'pycharm', label: 'PyCharm', cmds: ['pycharm', 'pycharm64'], paths: [] },
  { id: 'goland', label: 'GoLand', cmds: ['goland', 'goland64'], paths: [] },
  { id: 'rider', label: 'Rider', cmds: ['rider', 'rider64'], paths: [] },
  { id: 'notepadpp', label: 'Notepad++', cmds: ['notepad++'], paths: [`${pf}\\Notepad++\\notepad++.exe`], win: true },
  ];
};

const EXTS = win ? ['.cmd', '.exe', '.bat', ''] : [''];

function onPath(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of EXTS) {
      const f = path.join(dir, cmd + ext);
      try { if (fs.statSync(f).isFile()) return f; } catch {}
    }
  }
  return null;
}

// JetBrains Toolbox installs launch scripts here.
function jetbrainsScripts() {
  const local = localDir();
  const dirs = [path.join(local, 'JetBrains', 'Toolbox', 'scripts'), path.join(os.homedir(), 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts'), path.join(os.homedir(), '.local', 'share', 'JetBrains', 'Toolbox', 'scripts')];
  return dirs.filter((d) => d && fs.existsSync(d));
}

function detect() {
  const found = [];
  const extra = process.env.ORCH_IDE_EXTRA; // tests: '[{"id":"fake","label":"Fake IDE","cmd":["node","fake-ide.js"]}]'
  if (extra) { try { for (const e of JSON.parse(extra)) found.push({ id: e.id, label: e.label, cmd: e.cmd, goto: !!e.goto }); } catch {} }
  for (const c of catalog()) {
    if (c.win && !win) continue;
    let exe = null;
    for (const cmd of c.cmds) { exe = onPath(cmd); if (exe) break; }
    if (!exe) exe = c.paths.find((p) => { try { return p && fs.statSync(p).isFile(); } catch { return false; } }) || null;
    if (!exe) for (const d of jetbrainsScripts()) { for (const cmd of c.cmds) for (const ext of EXTS) { const f = path.join(d, cmd + ext); if (fs.existsSync(f)) { exe = f; break; } } if (exe) break; }
    if (exe) found.push({ id: c.id, label: c.label, cmd: [exe], goto: !!c.goto });
  }
  return found;
}

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;

function open(id, target, line) {
  const ide = detect().find((x) => x.id === id);
  if (!ide) return { ok: false, error: 'That editor was not found.' };
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'The path does not exist.' };
  const isFile = fs.statSync(target).isFile();
  const args = ide.goto && isFile && line ? ['-g', `${target}:${line}`] : [target];
  const [exe, ...pre] = ide.cmd;
  try {
    let child;
    if (win && /\.(cmd|bat)$/i.test(exe)) {
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[quote(exe), ...pre.map(quote), ...args.map(quote)].join(' ')}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
    } else {
      child = spawn(exe, [...pre, ...args], { detached: true, stdio: 'ignore', windowsHide: true });
    }
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function register(ipcMain) {
  ipcMain.handle('ide:list', () => detect().map(({ id, label }) => ({ id, label })));
  ipcMain.handle('ide:open', (_e, id, target, line) => open(id, target, line));
}

module.exports = { register, detect, open };
