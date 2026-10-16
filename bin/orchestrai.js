#!/usr/bin/env node
// orchestrai: command-line control of the canvas, for Maestro terminals.
// Talks to the running OrchestrAI app through ORCHESTRAI_URL / ORCHESTRAI_TOKEN.
const http = require('http');

const HELP = `orchestrai - direct the OrchestrAI canvas from a Maestro terminal

Usage:
  orchestrai list                               List terminals (id, name, floor, status, role)
  orchestrai new [--name N] [--command C] [--cwd DIR] [--role R] [--floor F]
                                                Create a terminal next to this one, connected to it. Prints its id.
  orchestrai send <terminal> <text...> [--no-enter]
                                                Type text into a terminal (and press Enter)
  orchestrai read <terminal> [--lines N]        Print the last N lines (default 60) of a terminal's screen
  orchestrai close <terminal>                   Close a terminal
  orchestrai roles                              List the available roles

<terminal> is an id or a unique terminal name.
Add --json to list/roles for machine-readable output.`;

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (['json', 'no-enter'].includes(key)) flags[key] = true;
      else flags[key] = argv[++i];
    } else positional.push(a);
  }
  return { positional, flags };
}

function rpc(method, params) {
  const url = process.env.ORCHESTRAI_URL, token = process.env.ORCHESTRAI_TOKEN;
  if (!url || !token) {
    console.error('Not running inside a Maestro terminal (ORCHESTRAI_URL is not set). Enable "Maestro" in the terminal settings.');
    process.exit(2);
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params, from: process.env.ORCHESTRAI_TERMINAL || '' });
    const req = http.request(`${url}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          if (j.ok) resolve(j.result); else reject(new Error(j.error || 'Request failed'));
        } catch { reject(new Error(`Unexpected response (${res.statusCode})`)); }
      });
    });
    req.on('error', (e) => reject(new Error(`Could not reach OrchestrAI: ${e.message}`)));
    req.end(body);
  });
}

function table(rows, cols) {
  if (!rows.length) return '(none)';
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals) => vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ').trimEnd();
  return [line(cols), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

(async () => {
  const { positional, flags } = parse(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  try {
    switch (cmd) {
      case 'list': {
        const list = await rpc('list', {});
        console.log(flags.json ? JSON.stringify(list, null, 2) : table(list, ['id', 'name', 'floor', 'status', 'role', 'maestro']));
        break;
      }
      case 'new': {
        const r = await rpc('create', { name: flags.name, command: flags.command, cwd: flags.cwd, role: flags.role, floor: flags.floor });
        console.log(r.id);
        break;
      }
      case 'send': {
        if (rest.length < 2) throw new Error('Usage: orchestrai send <terminal> <text...>');
        await rpc('send', { target: rest[0], text: rest.slice(1).join(' '), enter: !flags['no-enter'] });
        break;
      }
      case 'read': {
        if (!rest[0]) throw new Error('Usage: orchestrai read <terminal> [--lines N]');
        console.log(await rpc('read', { target: rest[0], lines: flags.lines ? Number(flags.lines) : 60 }));
        break;
      }
      case 'close': {
        if (!rest[0]) throw new Error('Usage: orchestrai close <terminal>');
        await rpc('close', { target: rest[0] });
        break;
      }
      case 'roles': {
        const roles = await rpc('roles', {});
        console.log(flags.json ? JSON.stringify(roles, null, 2) : table(roles, ['name', 'summary']));
        break;
      }
      case undefined:
      case 'help':
      case '--help':
        console.log(HELP);
        break;
      default:
        throw new Error(`Unknown command "${cmd}". Run "orchestrai help".`);
    }
  } catch (e) {
    console.error(`orchestrai: ${e.message}`);
    process.exit(1);
  }
})();
