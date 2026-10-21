// CI guard: a change to application code must come with a test change. Usage: node scripts/check-tests-changed.js <base-ref>
// Opt out for a change that cannot be tested (docs-only edits are ignored automatically) by putting "[no-tests]" in a commit message.
const { execFileSync } = require('child_process');
const base = process.argv[2] || 'origin/main';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const files = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const isCode = (f) => /^(src|bin)\/.+\.(js|html|css)$/.test(f) && !/^src\/renderer\/locales\//.test(f);
const isTest = (f) => /^tests\//.test(f);
const code = files.filter(isCode);
if (!code.length || files.some(isTest)) { console.log(code.length ? 'Tests changed along with the code.' : 'No application code changed.'); process.exit(0); }
if (/\[no-tests\]/i.test(git('log', '--format=%B', `${base}..HEAD`))) { console.log('Skipped: a commit says [no-tests].'); process.exit(0); }
console.error('Application code changed without any test change:\n  ' + code.join('\n  ') + '\nAdd or update a test in tests/ (tests/e2e/<feature>.test.js or tests/unit/), or put [no-tests] in a commit message with the reason.');
process.exit(1);
