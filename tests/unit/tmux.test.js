// tmux target validation and command wrapping (services/tmux.js). Nothing here runs tmux.
const assert = require('assert');
const { validate, status, kill } = require('../../src/services/tmux');

const ok = { kind: 'local', socket: 'orchestrai', session: 'orchestrai-n1' };
assert.strictEqual(validate(ok), '', 'a plain local target is valid');
assert.ok(validate(null), 'no target is refused');
assert.ok(validate({ ...ok, kind: 'docker' }), 'unsupported kinds are refused');
assert.ok(validate({ ...ok, socket: 'a b' }), 'spaces in the socket are refused');
assert.ok(validate({ ...ok, session: '$(rm -rf)' }), 'shell syntax in the session is refused');
assert.ok(validate({ ...ok, session: 'x'.repeat(65) }), 'over-long session names are refused');
assert.ok(validate({ ...ok, kind: 'wsl', distro: '' }), 'WSL needs a distribution');
assert.ok(validate({ ...ok, kind: 'wsl', distro: 'Ubuntu; calc' }), 'shell syntax in the distribution is refused');
assert.strictEqual(validate({ ...ok, kind: 'wsl', distro: 'Ubuntu-22.04' }), '', 'a normal distribution is valid');
assert.ok(validate({ ...ok, kind: 'ssh', host: '' }), 'SSH needs a host');
assert.ok(validate({ ...ok, kind: 'ssh', host: 'h;rm' }), 'shell syntax in the host is refused');
assert.ok(validate({ ...ok, kind: 'ssh', host: 'example.com', port: 'abc' }), 'a non-numeric port is refused');
assert.strictEqual(validate({ ...ok, kind: 'ssh', host: 'user.example.com', port: 2222, user: 'dev' }), '', 'a normal SSH target is valid');
assert.ok(validate({ ...ok, kind: 'ssh', host: 'example.com', user: 'a b' }), 'a bad user is refused');

(async () => {
  // Invalid targets are rejected before anything is executed.
  const s = await status({ ...ok, session: 'bad session' });
  assert.deepStrictEqual([s.available, s.exists], [false, false]);
  assert.ok(s.error);
  assert.strictEqual(await kill({ ...ok, session: 'bad session' }), false);
  console.log('tmux: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
