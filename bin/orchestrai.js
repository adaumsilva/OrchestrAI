#!/usr/bin/env node
// orchestrai: command-line control of the canvas, for Maestro terminals.
// Talks to the running OrchestrAI app through ORCHESTRAI_URL / ORCHESTRAI_TOKEN.
const http = require('http');

const HELP = `orchestrai - direct the OrchestrAI canvas from a Maestro terminal

Usage:
  orchestrai list                               List terminals (id, name, floor, status, role)
  orchestrai new [--name N] [--command C] [--cwd DIR] [--role R] [--floor F]
                                                Create a terminal next to this one, connected to it. Prints its id.
  orchestrai send <terminal> <text...> [--no-enter] [--no-reply]
                                                Type text into a terminal (and press Enter). When it finishes and goes
                                                quiet, its latest output is typed back into you (--no-reply: don't)
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
  orchestrai portal open [url] [--name N] [--floor F]   (Maestro) Create a portal connected to this terminal; prints its id
  orchestrai portal close <portal>              (Maestro) Close a portal
  orchestrai portal list                        List the portals (id, name, url)
  orchestrai portal nav <portal> <url>          Navigate (use "-" for <portal> when there is only one)
  orchestrai portal text <portal> [--max N]     Print the page's visible text
  orchestrai portal click <portal> <selector>   Click the first element matching a CSS selector
  orchestrai portal type <portal> <selector> <text...> [--submit] [--clear]   Type into an input or a rich editor (contenteditable); --clear replaces the content, --submit presses Enter after
  orchestrai portal press <portal> <key>        Press a real key: Enter, Tab, Shift+Tab, Escape, Up, Ctrl+A ...
  orchestrai portal wait <portal> [selector|load] [--timeout S]   Wait until the selector is visible (default: the page finished loading)
  orchestrai portal shot <portal>               Save a screenshot and print its file path

Android devices: a Device node joined to this terminal by a rope (a Maestro can use any; use "-" for <device> when only one is connected):
  orchestrai device list                        List the device nodes and their adb devices
  orchestrai device shot <device>               Save a screenshot and print its file path
  orchestrai device ui <device>                 Print the on-screen elements (label, id, centre x y, clickable)
  orchestrai device tap <device> <x> <y>        Tap at screen coordinates
  orchestrai device swipe <device> <x1> <y1> <x2> <y2> [--ms N]
  orchestrai device type <device> <text...>     Type text into the focused field
  orchestrai device key <device> <back|home|recents|enter|power|volup|voldown|CODE>
  orchestrai device launch <device> <package>   Start an app
  orchestrai device info <device>               Print the screen size
  (all take --serial S to pick one adb device when several are attached)

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
      if (['json', 'no-enter', 'no-reply', 'submit', 'clear'].includes(key)) flags[key] = true;
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
        await rpc('send', { target: rest[0], text: rest.slice(1).join(' '), enter: !flags['no-enter'], reply: !flags['no-reply'] });
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
      case 'device': {
        const [sub, ref0, ...args] = rest;
        const target = ref0 === '-' ? '' : ref0;
        const serial = flags.serial;
        const num = (v, name) => { if (v === undefined || !Number.isFinite(Number(v))) throw new Error('Expected a number for ' + name); return Number(v); };
        if (sub === 'list') {
          const list = await rpc('device-list', {});
          console.log(flags.json ? JSON.stringify(list, null, 2) : table(list, ['node', 'name', 'serial', 'devices']));
        } else if (sub === 'shot') console.log((await rpc('device-shot', { target, serial })).path);
        else if (sub === 'info') { const r = await rpc('device-info', { target, serial }); console.log(r.width + 'x' + r.height); }
        else if (sub === 'ui') {
          const nodes = await rpc('device-ui', { target, serial });
          console.log(flags.json ? JSON.stringify(nodes, null, 2) : nodes.map((n) => [n.label, n.id || '-', n.cx + ' ' + n.cy, n.clickable ? 'clickable' : ''].join('\t')).join('\n'));
        } else if (sub === 'tap') await rpc('device-tap', { target, serial, x: num(args[0], 'x'), y: num(args[1], 'y') });
        else if (sub === 'swipe') await rpc('device-swipe', { target, serial, x1: num(args[0], 'x1'), y1: num(args[1], 'y1'), x2: num(args[2], 'x2'), y2: num(args[3], 'y2'), ms: flags.ms });
        else if (sub === 'type') { if (!args.length) throw new Error('Usage: orchestrai device type <device> <text...>'); await rpc('device-type', { target, serial, text: args.join(' ') }); }
        else if (sub === 'key') { if (!args[0]) throw new Error('Usage: orchestrai device key <device> <key>'); await rpc('device-key', { target, serial, key: args[0] }); }
        else if (sub === 'launch') { if (!args[0]) throw new Error('Usage: orchestrai device launch <device> <package>'); await rpc('device-launch', { target, serial, pkg: args[0] }); }
        else throw new Error('Usage: orchestrai device list | shot | ui | tap | swipe | type | key | launch | info');
        break;
      }
      case 'portal': {
        const [sub, ref0, ...args] = rest;
        const target = ref0 === '-' ? '' : ref0;
        if (sub === 'open') {
          console.log((await rpc('portal-open', { url: ref0 || '', name: flags.name, floor: flags.floor })).id);
        } else if (sub === 'close') {
          if (!ref0) throw new Error('Usage: orchestrai portal close <portal>');
          await rpc('portal-close', { target: ref0 });
        } else if (sub === 'list') {
          const list = await rpc('portal-list', {});
          console.log(flags.json ? JSON.stringify(list, null, 2) : table(list, ['id', 'name', 'url']));
        } else if (sub === 'nav') {
          if (!args[0]) throw new Error('Usage: orchestrai portal nav <portal> <url>');
          console.log((await rpc('portal-nav', { target, url: args.join(' '), timeout: flags.timeout ? Number(flags.timeout) : undefined })).url);
        } else if (sub === 'text') {
          console.log(await rpc('portal-text', { target, max: flags.max ? Number(flags.max) : undefined }));
        } else if (sub === 'click') {
          if (!args[0]) throw new Error('Usage: orchestrai portal click <portal> <selector>');
          await rpc('portal-click', { target, selector: args.join(' ') });
        } else if (sub === 'type') {
          if (args.length < 2) throw new Error('Usage: orchestrai portal type <portal> <selector> <text...>');
          await rpc('portal-type', { target, selector: args[0], text: args.slice(1).join(' '), submit: !!flags.submit, clear: !!flags.clear });
        } else if (sub === 'press') {
          if (!args[0]) throw new Error('Usage: orchestrai portal press <portal> <key>');
          await rpc('portal-press', { target, key: args.join('+') });
        } else if (sub === 'wait') {
          await rpc('portal-wait', { target, selector: args[0] || 'load', timeout: flags.timeout ? Number(flags.timeout) : undefined });
        } else if (sub === 'shot') {
          console.log((await rpc('portal-shot', { target })).path);
        } else throw new Error('Usage: orchestrai portal list | nav | text | click | type | press | wait | shot');
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
      case 'turn-end': { // called by the agent's Stop hook; must never fail or print
        if (process.env.ORCHESTRAI_URL && process.env.ORCHESTRAI_TOKEN) await rpc('turn-end', {}).catch(() => {});
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
