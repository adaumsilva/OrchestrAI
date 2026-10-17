// Stand-in for the GitHub CLI used by the PR tests. State lives in the JSON file named by FAKE_GH_STATE.
const fs = require('fs');
const file = process.env.FAKE_GH_STATE;
const st = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(st));
const a = process.argv.slice(2);
const fail = (m) => { process.stderr.write(m + '\n'); process.exit(1); };
st.calls = (st.calls || []).concat([a.join(' ')]); save();
if (st.auth === false) fail('To get started with GitHub CLI, please run:  gh auth login');
if (a[0] === 'pr' && a[1] === 'view') {
  if (!st.pr) fail('no pull requests found for branch "x"');
  process.stdout.write(JSON.stringify(st.pr));
} else if (a[0] === 'pr' && a[1] === 'create') {
  const title = a[a.indexOf('--title') + 1];
  st.pr = { number: 7, title, state: 'OPEN', url: 'https://github.com/x/y/pull/7', isDraft: a.includes('--draft'), headRefName: 'feature', baseRefName: 'main', reviewDecision: '', mergeable: 'MERGEABLE', statusCheckRollup: [{ status: 'IN_PROGRESS' }] };
  save();
  process.stdout.write('https://github.com/x/y/pull/7\n');
} else if (a[0] === 'pr' && a[1] === 'merge') {
  st.pr.state = 'MERGED'; st.mergedWith = a[2]; save();
  process.stdout.write('merged\n');
} else fail('unexpected: ' + a.join(' '));
