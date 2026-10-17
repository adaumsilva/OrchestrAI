// Accounts: named environments for an agent CLI, so several terminals can run the same CLI on different subscriptions or API
// keys at once. An account is an isolated config directory plus environment variables. Secret values (API keys) are encrypted
// with Electron's safeStorage, whose key lives in the operating system's keychain (DPAPI, Keychain, libsecret); the ciphertext
// is kept in its own file, never in workspace.json, and the renderer only ever learns whether a secret is set. If the OS
// keychain is unavailable, secrets are refused rather than stored in the clear.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROVIDERS = {
  claude: { label: 'Claude Code', cli: 'claude', signIn: 'claude', dirVar: 'CLAUDE_CONFIG_DIR', keyVar: 'ANTHROPIC_API_KEY', urlVar: 'ANTHROPIC_BASE_URL' },
  codex: { label: 'Codex', cli: 'codex', signIn: 'codex login', dirVar: 'CODEX_HOME', keyVar: 'OPENAI_API_KEY', urlVar: 'OPENAI_BASE_URL' },
  custom: { label: 'Custom', cli: '', signIn: '', dirVar: '', keyVar: '', urlVar: '' },
};

const metaFile = () => path.join(app.getPath('userData'), 'accounts.json');
const secretFile = () => path.join(app.getPath('userData'), 'account-secrets.json');
const configRoot = () => path.join(app.getPath('userData'), 'accounts');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const load = () => {
  const m = readJson(metaFile(), {});
  return { accounts: Array.isArray(m.accounts) ? m.accounts : [], defaults: m.defaults || {} };
};
const loadSecrets = () => readJson(secretFile(), {});
const secure = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };

const validVar = (n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(n || ''));
// Variables that would let an account hijack the terminal itself, not the agent.
const FORBIDDEN = new Set(['PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'ORCHESTRAI_URL', 'ORCHESTRAI_TOKEN', 'ORCHESTRAI_TERMINAL', 'ORCHESTRAI_NODE']);

function publicView(a, secrets) {
  const have = secrets[a.id] || {};
  return {
    id: a.id, name: a.name, provider: a.provider, configDir: a.configDir || '',
    vars: (a.vars || []).map((v) => (v.secret ? { name: v.name, secret: true, set: !!have[v.name] } : { name: v.name, secret: false, value: v.value || '' })),
  };
}

function list() {
  const { accounts, defaults } = load();
  const secrets = loadSecrets();
  return { accounts: accounts.map((a) => publicView(a, secrets)), defaults, providers: PROVIDERS, secure: secure(), configRoot: configRoot() };
}

// Environment for a terminal on this account: the config dir, the plain variables and the decrypted secrets.
function envFor(accountId) {
  if (!accountId) return {};
  const a = load().accounts.find((x) => x.id === accountId);
  if (!a) return {};
  const env = {};
  const prov = PROVIDERS[a.provider] || PROVIDERS.custom;
  if (prov.dirVar && a.configDir) { fs.mkdirSync(a.configDir, { recursive: true }); env[prov.dirVar] = a.configDir; }
  const have = loadSecrets()[a.id] || {};
  for (const v of a.vars || []) {
    if (!validVar(v.name) || FORBIDDEN.has(v.name.toUpperCase())) continue;
    if (v.secret) {
      if (have[v.name] && secure()) { try { env[v.name] = safeStorage.decryptString(Buffer.from(have[v.name], 'base64')); } catch {} }
    } else env[v.name] = String(v.value || '');
  }
  return env;
}

function save(input) {
  const db = load();
  const secrets = loadSecrets();
  const name = String(input.name || '').trim();
  if (!name) return { ok: false, error: 'Give the account a name.' };
  if (!PROVIDERS[input.provider]) return { ok: false, error: 'Unknown provider.' };
  if (db.accounts.some((a) => a.id !== input.id && a.provider === input.provider && a.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `There is already a ${PROVIDERS[input.provider].label} account called "${name}".` };
  const vars = [];
  for (const v of input.vars || []) {
    if (!validVar(v.name)) return { ok: false, error: `"${v.name}" is not a valid variable name.` };
    if (FORBIDDEN.has(String(v.name).toUpperCase())) return { ok: false, error: `${v.name} cannot be set by an account.` };
    if (vars.some((x) => x.name === v.name)) return { ok: false, error: `${v.name} is listed twice.` };
    vars.push(v.secret ? { name: v.name, secret: true } : { name: v.name, secret: false, value: String(v.value || '') });
  }
  let a = db.accounts.find((x) => x.id === input.id);
  const isNew = !a;
  if (isNew) {
    a = { id: crypto.randomBytes(6).toString('hex'), provider: input.provider };
    db.accounts.push(a);
  }
  a.name = name; a.vars = vars;
  if (PROVIDERS[a.provider].dirVar) a.configDir = path.join(configRoot(), a.id);

  const mine = (secrets[a.id] ||= {});
  for (const v of input.vars || []) {
    if (!v.secret || v.value === undefined) continue; // undefined keeps the stored secret
    if (v.value === '') { delete mine[v.name]; continue; }
    if (!secure()) { if (isNew) db.accounts.pop(); return { ok: false, error: 'The operating system keychain is not available, so secrets cannot be stored safely.' }; }
    mine[v.name] = safeStorage.encryptString(String(v.value)).toString('base64');
  }
  for (const k of Object.keys(mine)) if (!vars.some((v) => v.secret && v.name === k)) delete mine[k]; // a removed variable loses its secret
  writeJson(metaFile(), db);
  writeJson(secretFile(), secrets);
  return { ok: true, id: a.id };
}

function remove(id) {
  const db = load();
  const a = db.accounts.find((x) => x.id === id);
  if (!a) return { ok: true };
  db.accounts = db.accounts.filter((x) => x.id !== id);
  for (const [k, v] of Object.entries(db.defaults)) if (v === id) delete db.defaults[k];
  const secrets = loadSecrets();
  delete secrets[id];
  writeJson(metaFile(), db);
  writeJson(secretFile(), secrets);
  if (a.configDir && a.configDir.startsWith(configRoot())) fs.rmSync(a.configDir, { recursive: true, force: true });
  return { ok: true };
}

// Forget everything the account holds (stored keys and the CLI's own login files) but keep the account itself.
function signOut(id) {
  const db = load();
  const a = db.accounts.find((x) => x.id === id);
  if (!a) return { ok: false, error: 'No such account.' };
  const secrets = loadSecrets();
  delete secrets[id];
  writeJson(secretFile(), secrets);
  if (a.configDir && a.configDir.startsWith(configRoot())) { fs.rmSync(a.configDir, { recursive: true, force: true }); fs.mkdirSync(a.configDir, { recursive: true }); }
  return { ok: true };
}

function setDefault(provider, id) {
  const db = load();
  if (id && !db.accounts.some((a) => a.id === id && a.provider === provider)) return { ok: false, error: 'That account belongs to another provider.' };
  if (id) db.defaults[provider] = id; else delete db.defaults[provider];
  writeJson(metaFile(), db);
  return { ok: true };
}

function register(ipcMain) {
  ipcMain.handle('accounts:list', () => list());
  ipcMain.handle('accounts:save', (_e, input) => save(input || {}));
  ipcMain.handle('accounts:remove', (_e, id) => remove(String(id)));
  ipcMain.handle('accounts:signOut', (_e, id) => signOut(String(id)));
  ipcMain.handle('accounts:setDefault', (_e, provider, id) => setDefault(String(provider), id ? String(id) : null));
}

module.exports = { register, envFor, PROVIDERS };
