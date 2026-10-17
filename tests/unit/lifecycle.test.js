// The diagnostic report must never carry credentials, so the redaction is tested on its own.
const assert = require('assert');
const os = require('os');
const { redact } = require('../../src/services/lifecycle');

const secrets = [
  'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt', 'sk-proj-1234567890abcdefghij', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
  'xoxb-1234567890-abcdefghij', 'AKIAABCDEFGHIJKLMNOP', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  'a3f5c8d2e1b4a7968d0c1e2f3a4b5c6d7e8f9a0b1c2d3e4', // a per-terminal bridge token
];
for (const s of secrets) {
  const out = redact(`request failed for ${s} at step 3`);
  assert.ok(!out.includes(s), `token leaked: ${s} -> ${out}`);
  assert.ok(out.includes('step 3'), 'surrounding text is kept');
}
assert.ok(!redact('Authorization: Bearer abcdef1234567890xyz').includes('abcdef1234567890xyz'));
assert.ok(!/hunter2/.test(redact('login with password=hunter2 now')));
assert.ok(!/s3cr3t/.test(redact('{"api_key": "s3cr3t-value"}') + redact('API_KEY=s3cr3t-value')));
assert.ok(!redact(`opened ${os.homedir()}/projects/secret-app/file.txt`).includes(os.userInfo().username) || os.homedir().length <= 3, 'home directory is shortened');
assert.ok(redact('x'.repeat(5000)).length < 700, 'long messages are cut');
assert.strictEqual(redact('plain message'), 'plain message');
assert.strictEqual(redact(undefined), '');
console.log('lifecycle: all passed');
