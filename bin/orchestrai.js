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
  orchestrai routine list                       List scheduled routines
  orchestrai routine add --name N --text T [--target TERMINAL] (--every MIN | --daily HH:MM | --weekly mon,wed --at HH:MM | --once YYYY-MM-DDTHH:MM)
                                                Schedule text for a terminal (or a new one when --target is omitted; add --command C)
  orchestrai routine remove <id>                Delete a routine

Terminals joined to this one by a rope (any terminal, Maestro or not):
  orchestrai peers                              List the connected terminals
  orchestrai ask <peer> <text...> [--timeout S] Send text to a peer, wait until it goes quiet, print its reply
  orchestrai check <peer> [--lines N]           Show a peer's status and latest output without sending anything

Browser portals joined to this terminal by a rope (a Maestro can use any portal; <portal> may be omitted when only one is connected):
  orchestrai portal list                        List the portals (id, name, url)
  orchestrai portal nav <portal> <url>          Navigate (use "-" for <portal> when there is only one)
  orchestrai portal text <portal> [--max N]     Print the page's visible text
  orchestrai portal click <portal> <selector>   Click the first element matching a CSS selector
  orchestrai portal type <portal> <selector> <text...>   Fill an input
  orchestrai portal shot <portal>               Save a screenshot and print its file path

Any terminal can report progress on its floor (shown on the floor tab):
  orchestrai floor-status <text...> [--state working|waiting|blocked|done]   (no text clears it)

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

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function scheduleFromFlags(f) {
  if (f.every) return { kind: 'every', minutes: Number(f.every) };
  if (f.daily) return { kind: 'daily', time: f.daily };
  if (f.weekly) {
    const days = f.weekly.split(',').map((d) => DAYS.indexOf(d.trim().toLowerCase().slice(0, 3)));
    if (days.includes(-1)) throw new Error('--weekly takes weekday names like mon,wed');
    return { kind: 'weekly', days, time: f.at || '09:00' };
  }
  if (f.once) return { kind: 'once', at: new Date(f.once).getTime() };
  throw new Error('Give a schedule: --every MIN, --daily HH:MM, --weekly mon,wed --at HH:MM or --once YYYY-MM-DDTHH:MM');
}

function rpc(method, params) {
  const url = process.env.ORCHESTRAI_URL, token = process.env.ORCHESTRAI_TOKEN;
  if (!url || !token) {
    console.error('Not running inside an OrchestrAI terminal (ORCHESTRAI_URL is not set).');
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
      case 'routine': {
        const [sub, ...args] = rest;
        if (sub === 'list') {
          const list = await rpc('routine-list', {});
          console.log(flags.json ? JSON.stringify(list, null, 2) : table(list, ['id', 'name', 'schedule', 'enabled', 'next', 'target']));
        } else if (sub === 'remove') {
          if (!args[0]) throw new Error('Usage: orchestrai routine remove <id>');
          await rpc('routine-remove', { id: args[0] });
        } else if (sub === 'add') {
          if (!flags.name) throw new Error('Usage: orchestrai routine add --name N --text T ...');
          console.log((await rpc('routine-add', { name: flags.name, text: flags.text, target: flags.target, command: flags.command, schedule: scheduleFromFlags(flags) })).id);
        } else throw new Error('Usage: orchestrai routine list | add | remove');
        break;
      }
      case 'peers': {
        const list = await rpc('peers', {});
        console.log(flags.json ? JSON.stringify(list, null, 2) : table(list, ['id', 'name', 'status', 'role']));
        break;
      }
      case 'ask': {
        if (rest.length < 2) throw new Error('Usage: orchestrai ask <peer> <text...> [--timeout S]');
        console.log(await rpc('ask', { target: rest[0], text: rest.slice(1).join(' '), timeout: flags.timeout ? Number(flags.timeout) : undefined, quiet: flags.quiet ? Number(flags.quiet) : undefined }));
        break;
      }
      case 'portal': {
        const [sub, ref0, ...args] = rest;
        const target = ref0 === '-' ? '' : ref0;
        if (sub === 'list') {
          const list = await rpc('portal-list', {});
          console.log(flags.json ? JSON.stringify(list, null, 2) : table(list, ['id', 'name', 'url']));
        } else if (sub === 'nav') {
          if (!args[0]) throw new Error('Usage: orchestrai portal nav <portal> <url>');
          console.log((await rpc('portal-nav', { target, url: args.join(' ') })).url);
        } else if (sub === 'text') {
          console.log(await rpc('portal-text', { target, max: flags.max ? Number(flags.max) : undefined }));
        } else if (sub === 'click') {
          if (!args[0]) throw new Error('Usage: orchestrai portal click <portal> <selector>');
          await rpc('portal-click', { target, selector: args.join(' ') });
        } else if (sub === 'type') {
          if (args.length < 2) throw new Error('Usage: orchestrai portal type <portal> <selector> <text...>');
          await rpc('portal-type', { target, selector: args[0], text: args.slice(1).join(' ') });
        } else if (sub === 'shot') {
          console.log((await rpc('portal-shot', { target })).path);
        } else throw new Error('Usage: orchestrai portal list | nav | text | click | type | shot');
        break;
      }
      case 'floor-status': {
        const r = await rpc('floor-status', { text: rest.join(' '), state: flags.state });
        console.log(r.status ? `${r.floor}: ${r.status.text} (${r.status.state})` : `${r.floor}: status cleared`);
        break;
      }
      case 'check': {
        if (!rest[0]) throw new Error('Usage: orchestrai check <peer> [--lines N]');
        const r = await rpc('check', { target: rest[0], lines: flags.lines ? Number(flags.lines) : 30 });
        console.log(`status: ${r.status}
${r.screen}`);
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
