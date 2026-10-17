const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const home = path.join(t.dataDir, 'fakehome');
  process.env.ORCH_HOME = home;
  const skill = path.join(home, '.claude', 'skills', 'orchestrai', 'SKILL.md');
  const agents = path.join(home, '.codex', 'AGENTS.md');

  let st = await t.js(`call('skills:status')`);
  t.check('nothing installed at first', !st.claude.installed && !st.codex.installed, st);

  const r = await t.js(`call('skills:install', 'claude')`);
  const text = fs.readFileSync(skill, 'utf8');
  t.check('claude skill installed with frontmatter', r.ok && text.startsWith('---\nname: orchestrai') && text.includes('orchestrai ask'), r);
  st = await t.js(`call('skills:status')`);
  t.check('status shows installed and current', st.claude.installed && st.claude.upToDate, st.claude);

  // a user-modified file is backed up, not lost
  fs.writeFileSync(skill, '---\nname: orchestrai\n---\nmy edits');
  const r2 = await t.js(`call('skills:install', 'claude')`);
  t.check('existing file is backed up before overwrite', r2.ok && r2.backedUp && fs.readFileSync(r2.backedUp, 'utf8').includes('my edits'), r2);

  // AGENTS.md keeps the user's own content
  fs.mkdirSync(path.dirname(agents), { recursive: true });
  fs.writeFileSync(agents, '# My rules\nBe nice.\n');
  const r3 = await t.js(`call('skills:install', 'codex')`);
  const a = fs.readFileSync(agents, 'utf8');
  t.check('AGENTS.md block appended, user text kept, backup made', r3.ok && a.startsWith('# My rules\nBe nice.') && a.includes('orchestrai:begin') && r3.backedUp, r3);
  await t.js(`call('skills:install', 'codex')`);
  t.check('reinstall replaces the block instead of duplicating', fs.readFileSync(agents, 'utf8').split('orchestrai:begin').length === 2);

  // the typed primer is replaced when the skill covers the agent
  await t.js(`refreshSkillStatus()`);
  t.check('skill covers claude but not an unrelated command', await t.js(`skillCovers('claude --model x') && !skillCovers('npm test') && skillCovers('codex')`));

  // uninstall removes only what we wrote
  const u = await t.js(`call('skills:uninstall', 'codex')`);
  t.check('uninstall removes the block, keeps the rest', u.ok && fs.readFileSync(agents, 'utf8').trim() === '# My rules\nBe nice.', fs.readFileSync(agents, 'utf8'));
  await t.js(`call('skills:uninstall', 'claude')`);
  t.check('skill file removed (backups stay)', !fs.existsSync(skill) && fs.readdirSync(path.dirname(skill)).every((f) => f.includes('backup')));
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, 'someone else’s file');
  const u2 = await t.js(`call('skills:uninstall', 'claude')`);
  t.check('refuses to delete a file it did not write', !u2.ok && fs.existsSync(skill), u2);

  // dialog renders
  await t.js(`skillsDialog()`);
  await t.sleep(400);
  t.check('dialog lists both targets', await t.js(`document.querySelectorAll('.skill-row').length`) === 2);
};
