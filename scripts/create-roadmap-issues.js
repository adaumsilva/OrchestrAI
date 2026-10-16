#!/usr/bin/env node
// Creates the roadmap issues described in docs/roadmap/issues.md on GitHub using the `gh` CLI.
//   node scripts/create-roadmap-issues.js --dry-run     parse and print, change nothing
//   node scripts/create-roadmap-issues.js               create labels and issues (needs `gh auth login`)
// Already-existing issues (same title) are skipped, so it is safe to re-run.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');
const GH = process.env.GH_BIN || 'gh';
const source = path.join(__dirname, '..', 'docs', 'roadmap', 'issues.md');

const FOOTER = '\n\n---\n_Scope note: the "original behavior" above was inferred from the reference app\'s visible UI text and API surface. Implement it independently; no source code from that app is to be copied._';

function repoSlug() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot read owner/repo from remote "${url}"`);
  return m[1];
}

function parse(text) {
  return text.split(/^=== /m).slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n');
    const head = chunk.slice(0, nl);
    const bar = head.lastIndexOf(' | ');
    return {
      title: head.slice(0, bar).trim(),
      labels: head.slice(bar + 3).split(',').map((s) => s.trim()).filter(Boolean),
      body: chunk.slice(nl + 1).trim(),
    };
  });
}

const LABEL_COLORS = { enhancement: 'a2eeef', project: 'd4c5f9', 'priority:high': 'b60205', 'priority:medium': 'fbca04', 'priority:low': 'c2e0c6' };
const labelColor = (l) => LABEL_COLORS[l] || (l.startsWith('area:') ? '1d76db' : 'ededed');

const gh = (args, opts = {}) => execFileSync(GH, args, { encoding: 'utf8', ...opts }).trim();

const issues = parse(fs.readFileSync(source, 'utf8'));
const labels = [...new Set(issues.flatMap((i) => i.labels))].sort();
const repo = repoSlug();
console.log(`${issues.length} issues, ${labels.length} labels, target ${repo}${dryRun ? ' (dry run)' : ''}`);

if (dryRun) {
  for (const i of issues) console.log(`- [${i.labels.join(', ')}] ${i.title}`);
  process.exit(0);
}

gh(['auth', 'status']); // fails clearly when not logged in

for (const l of labels) {
  gh(['label', 'create', l, '--repo', repo, '--color', labelColor(l), '--force']);
}

const existing = new Map(JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '500', '--json', 'title,number,url'])).map((i) => [i.title, i]));
const created = [];
for (const issue of issues) {
  if (existing.has(issue.title)) {
    console.log(`skip (exists): ${issue.title}`);
    created.push({ ...issue, ...existing.get(issue.title) });
    continue;
  }
  const file = path.join(os.tmpdir(), `orch-issue-${process.pid}.md`);
  fs.writeFileSync(file, issue.body + FOOTER);
  const url = gh(['issue', 'create', '--repo', repo, '--title', issue.title, '--body-file', file, '--label', issue.labels.join(',')]);
  fs.rmSync(file, { force: true });
  const number = Number(url.split('/').pop());
  created.push({ ...issue, url, number });
  console.log(`created #${number}: ${issue.title}`);
}

// One tracking issue with a task list, grouped by priority.
const trackerTitle = 'Roadmap: remaining features from the reference app';
if (!existing.has(trackerTitle)) {
  const section = (p, heading) => {
    const items = created.filter((i) => i.labels.includes(`priority:${p}`));
    return items.length ? `### ${heading}\n${items.map((i) => `- [ ] #${i.number} ${i.title}`).join('\n')}\n` : '';
  };
  const body = `Tracking issue for the features of the reference app that OrchestrAI does not have yet.\n\n${section('high', 'High priority')}\n${section('medium', 'Medium priority')}\n${section('low', 'Low priority')}`;
  const file = path.join(os.tmpdir(), `orch-issue-${process.pid}.md`);
  fs.writeFileSync(file, body);
  const url = gh(['issue', 'create', '--repo', repo, '--title', trackerTitle, '--body-file', file, '--label', 'enhancement']);
  fs.rmSync(file, { force: true });
  console.log(`created tracking issue: ${url}`);
}
console.log('done');
