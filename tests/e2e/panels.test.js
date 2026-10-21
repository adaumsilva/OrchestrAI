// Terminals overview, Task Manager, themes, tidy and select-all: the smaller canvas tools.
module.exports = async (t) => {
  // ---- terminals panel ----
  const ids = await t.js(`(() => { const f = activeFloor(); return [addNode('terminal', { title: 'Alpha', data: {} }, f).id, addNode('terminal', { title: 'Beta', data: {} }, f).id]; })()`);
  await t.sleep(1500);
  await t.js(`toggleTerminalsPanel(true); 0`);
  await t.sleep(200);
  const titles = await t.js(`[...document.querySelectorAll('#terminals-panel .tp-title')].map((e) => e.textContent)`);
  t.check('the panel lists every terminal', titles.includes('Alpha') && titles.includes('Beta'), titles);
  await t.js(`[...document.querySelectorAll('#terminals-panel .tp-row')].find((r) => r.textContent.includes('Beta')).click(); 0`);
  await t.sleep(200);
  t.check('clicking a row selects that terminal', await t.js(`selection.has('${ids[1]}')`));
  await t.js(`toggleTerminalsPanel(false); 0`);
  t.check('the panel closes', await t.js(`document.getElementById('terminals-panel').classList.contains('hidden')`));

  // ---- task manager ----
  await t.js(`toggleTaskManager(true); 0`);
  await t.sleep(1500);
  const tm = await t.js(`({ open: !document.getElementById('taskmgr-panel')?.classList.contains('hidden'), text: (document.getElementById('taskmgr-panel') || {}).textContent || '' })`);
  t.check('the task manager opens and shows the terminals', tm.open && tm.text.includes('Alpha'), tm.text.slice(0, 200));
  await t.js(`toggleTaskManager(false); 0`);

  // ---- themes ----
  const th = await t.js(`(() => {
    const ok = parseThemeText(JSON.stringify({ name: 'Mine', background: '#101010', foreground: '#eee', purple: '#a0a' }));
    let err = ''; try { parseThemeText('nope'); } catch (e) { err = e.message; }
    let err2 = ''; try { parseThemeText('{"x":1}'); } catch (e) { err2 = e.message; }
    const ws = parseThemeText(JSON.stringify({ schemes: [{ name: 'WT', background: '#000000', foreground: '#ffffff', purple: '#800080' }] }));
    return { ok, err, err2, ws, dark: terminalTheme('dark').background, unknown: typeof terminalTheme('does-not-exist').background };
  })()`);
  t.check('a theme is parsed with short hex expanded', th.ok.name === 'Mine' && th.ok.colors.foreground === '#eeeeee' && th.ok.colors.magenta === '#aa00aa', th.ok);
  t.check('invalid theme text is rejected with a message', /valid JSON/.test(th.err) && /No colors/.test(th.err2), th);
  t.check('Windows Terminal schemes are accepted', th.ws.name === 'WT' && th.ws.colors.magenta === '#800080', th.ws);
  t.check('an unknown theme name falls back to a real palette', th.unknown === 'string' && typeof th.dark === 'string');

  // ---- select all and tidy ----
  const moved = await t.js(`(() => {
    const f = activeFloor();
    selectAll();
    const all = selection.size === f.nodes.length;
    f.nodes.forEach((n) => { n.x = 100; n.y = 100; }); // pile everything on one spot
    setSelection(f, []);
    tidy();
    const rects = f.nodes.map((n) => [n.x, n.y, n.w, n.h]);
    let overlap = false;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]) overlap = true;
    }
    return { all, overlap, count: f.nodes.length };
  })()`);
  t.check('select all selects every node', moved.all, moved);
  t.check('tidy separates nodes that were piled up', moved.count > 1 && !moved.overlap, moved);
};
