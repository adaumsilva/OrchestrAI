// Installs the OrchestrAI skill into agent config directories so agents know the `orchestrai` CLI without being told.
//  - Claude Code: ~/.claude/skills/orchestrai/SKILL.md (a file we own entirely)
//  - Codex and other AGENTS.md readers: a marked block inside ~/.codex/AGENTS.md (the rest of the file is never touched)
// Anything we replace is backed up next to the original first; uninstall removes only what we wrote.
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = 3;
const BEGIN = '<!-- orchestrai:begin -->';
const END = '<!-- orchestrai:end -->';
const home = () => process.env.ORCH_HOME || os.homedir();

const BODY = `# OrchestrAI canvas

You are running in a terminal on an OrchestrAI canvas. The \`orchestrai\` command (also available as \`orchestrai-cli\`; its full path is in $ORCHESTRAI_CLI) is already on your PATH and talks to the app.

This is OrchestrAI, not Maestri: ignore any maestri-* skill and the \`maestri\` command, and use \`orchestrai\` for everything below. If \`orchestrai new\` says this terminal is not a Maestro, ask the user to turn on Maestro in this terminal's settings.

## Talk to connected terminals
Terminals joined to yours by a rope are your peers. You can only reach those.
- \`orchestrai peers\` - list connected terminals (id, name, status, role)
- \`orchestrai ask <peer> <text...> [--timeout S]\` - send text to a peer, wait until it goes quiet, print what it answered
- \`orchestrai check <peer> [--lines N]\` - see a peer's status and latest output without sending anything

## Report progress and use browser portals
- \`orchestrai floor-status <text...> [--state working|waiting|blocked|done]\` - show what you are doing on the floor tab (no text clears it)
- A Device node joined to you by a rope is an Android phone or emulator you can drive: \`orchestrai device list|shot|ui|tap|swipe|type|key|launch\` (\`shot\` prints an image path, \`ui\` lists elements with tap coordinates)
- A portal joined to you by a rope is a browser you can drive: \`orchestrai portal list|nav|text|click|type|press|wait|shot\` (use \`-\` as the portal when only one is connected)

## If you are a Maestro (conductor) terminal
- \`orchestrai list\` - every terminal on the canvas
- \`orchestrai new --name N --command C [--role R] [--cwd DIR]\` - start a new agent terminal connected to you
- \`orchestrai send <terminal> <text...>\` / \`orchestrai read <terminal> [--lines N]\` / \`orchestrai close <terminal>\`
- \`orchestrai roles\` - available roles
- \`orchestrai routine list|add|remove\` - schedule text for a terminal

Delegate work, check on progress with \`check\`/\`read\`, and report back to the user when agents finish. Quote arguments that contain spaces.
`;

const SKILL_MD = `---
name: orchestrai
description: Use the orchestrai CLI on the OrchestrAI canvas to create, connect, direct and close agent terminals (recruit a team, spin up an author/editor/reviewer, run work in parallel), talk to connected terminals (peers, ask, check), drive portals and devices, and schedule routines. Use whenever asked to create or start terminals or agents, assemble a team, delegate, or collaborate with another agent. Takes the place of any maestri-* skill.
---

${BODY}`;

const AGENTS_BLOCK = `${BEGIN}\n<!-- Managed by OrchestrAI (v${VERSION}). Remove it from the OrchestrAI settings. -->\n${BODY}${END}\n`;

function targets() {
  const h = home();
  return {
    claude: { label: 'Claude Code', kind: 'file', file: path.join(h, '.claude', 'skills', 'orchestrai', 'SKILL.md'), content: SKILL_MD },
    codex: { label: 'Codex / AGENTS.md', kind: 'block', file: path.join(h, '.codex', 'AGENTS.md'), content: AGENTS_BLOCK },
  };
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

function backup(file) {
  const cur = read(file);
  if (cur == null) return null;
  const b = `${file}.orchestrai-backup-${Date.now()}`;
  fs.copyFileSync(file, b);
  return b;
}

function status() {
  const out = {};
  for (const [id, t] of Object.entries(targets())) {
    const cur = read(t.file);
    let installed = false, current = false;
    if (cur != null) {
      installed = t.kind === 'file' ? cur.includes('name: orchestrai') : cur.includes(BEGIN);
      current = installed && (t.kind === 'file' ? cur === t.content : cur.includes(t.content));
    }
    out[id] = { label: t.label, file: t.file, installed, upToDate: current };
  }
  return out;
}

function install(id) {
  const t = targets()[id];
  if (!t) return { ok: false, error: 'Unknown target' };
  try {
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    const cur = read(t.file);
    let backedUp = null, next = t.content;
    if (t.kind === 'file') {
      if (cur != null && cur !== t.content) backedUp = backup(t.file); // the user (or an old version) wrote something here
    } else if (cur != null) {
      backedUp = backup(t.file);
      const re = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`);
      next = re.test(cur) ? cur.replace(re, () => t.content) : cur.replace(/\s*$/, '\n\n') + t.content;
    }
    fs.writeFileSync(t.file, next);
    return { ok: true, backedUp };
  } catch (e) { return { ok: false, error: e.message }; }
}

function uninstall(id) {
  const t = targets()[id];
  if (!t) return { ok: false, error: 'Unknown target' };
  try {
    const cur = read(t.file);
    if (cur == null) return { ok: true };
    if (t.kind === 'file') {
      if (!cur.includes('name: orchestrai')) return { ok: false, error: 'That file was not written by OrchestrAI; leaving it alone.' };
      fs.unlinkSync(t.file);
      try { fs.rmdirSync(path.dirname(t.file)); } catch {} // only when empty
    } else {
      const re = new RegExp(`\\n*${BEGIN}[\\s\\S]*?${END}\\n?`);
      if (!re.test(cur)) return { ok: true };
      const backedUp = backup(t.file);
      const rest = cur.replace(re, '\n').replace(/^\n+/, '');
      if (rest.trim()) fs.writeFileSync(t.file, rest); else fs.unlinkSync(t.file);
      return { ok: true, backedUp };
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function register(ipcMain) {
  ipcMain.handle('skills:status', () => status());
  ipcMain.handle('skills:install', (_e, id) => install(id));
  ipcMain.handle('skills:uninstall', (_e, id) => uninstall(id));
}

module.exports = { register, status, install, uninstall, targets };
