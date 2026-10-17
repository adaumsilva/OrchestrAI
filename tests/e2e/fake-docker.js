// Stand-in for `docker` used by the sandbox tests. State lives in the JSON file named by FAKE_DOCKER_STATE.
const fs = require('fs');
const file = process.env.FAKE_DOCKER_STATE;
const st = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(st));
const a = process.argv.slice(2);
const fail = (m, code = 1) => { process.stderr.write(m + '\n'); process.exit(code); };
st.calls = (st.calls || []).concat([a.join(' ')]); save();
if (st.broken) fail('error during connect: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.');
if (a[0] === 'version') process.stdout.write('27.3.1\n');
else if (a[0] === 'sandbox' && a[1] === 'ls') {
  const rows = st.sandboxes.map((s) => [s.name.padEnd(14), s.agent.padEnd(9), s.status.padEnd(10), s.workspace].join('  '));
  process.stdout.write(['SANDBOX'.padEnd(16) + 'AGENT'.padEnd(11) + 'STATUS'.padEnd(12) + 'WORKSPACE', ...rows].join('\n') + '\n');
} else if (a[0] === 'sandbox' && a[1] === 'create') {
  const rest = a.slice(2);
  let name = '';
  const i = rest.indexOf('--name');
  if (i >= 0) { name = rest[i + 1]; rest.splice(i, 2); }
  const [agent, workspace] = rest;
  name = name || `${agent}-${st.sandboxes.length + 1}`;
  st.sandboxes.push({ name, agent, status: 'running', workspace }); save();
  process.stdout.write(name + '\n');
} else if (a[0] === 'sandbox' && a[1] === 'exec') {
  const args = a.slice(2).filter((x) => !/^-(it|i|t)$/.test(x));
  const name = args[0];
  if (!st.sandboxes.some((s) => s.name === name)) fail(`sandbox "${name}" not found`);
  if (args[1] === 'echo') process.stdout.write(args.slice(2).join(' ') + '\n');
  else {
    process.stdout.write(`SANDBOX-SHELL ${name}\n`);
    if (st.policyDeny) process.stdout.write('Error: request to api.example.com blocked by network policy\n  To allow it, run: docker sandbox network proxy ' + name + ' --allow-host api.example.com\n');
    setTimeout(() => process.exit(0), 20000); // stay open like a shell
  }
} else fail('unexpected: ' + a.join(' '));
