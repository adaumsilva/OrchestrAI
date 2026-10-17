const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const ev = (init) => `new KeyboardEvent('keydown', ${JSON.stringify({ bubbles: true, cancelable: true, ...init })})`;

  // ---- combos ----
  const combos = await t.js(`({
    ctrlZ: eventCombo(${ev({ key: 'z', ctrlKey: true })}),
    redo: eventCombo(${ev({ key: 'Z', ctrlKey: true, shiftKey: true })}),
    meta: eventCombo(${ev({ key: 'k', metaKey: true })}),
    qm: eventCombo(${ev({ key: '?', shiftKey: true })}),
    bracket: eventCombo(${ev({ key: ']', altKey: true })}),
    pgdn: eventCombo(${ev({ key: 'PageDown', ctrlKey: true, altKey: true })}),
    bare: eventCombo(${ev({ key: 'Control', ctrlKey: true })}),
    norm: normalizeCombo('shift+ctrl+t'),
  })`);
  t.check('key events become canonical combos', combos.ctrlZ === 'Ctrl+Z' && combos.redo === 'Ctrl+Shift+Z' && combos.meta === 'Ctrl+K' && combos.qm === '?' && combos.bracket === 'Alt+]' && combos.pgdn === 'Ctrl+Alt+PageDown' && combos.bare === '' && combos.norm === 'Ctrl+Shift+T', combos);
  t.check('defaults match the documented keys', await t.js(`shortcutMatch(${ev({ key: 't' })}, 'tidy') && shortcutMatch(${ev({ key: 'y', ctrlKey: true })}, 'redo') && shortcutMatch(${ev({ key: 'p', ctrlKey: true, shiftKey: true })}, 'palette') && !shortcutMatch(${ev({ key: 't', ctrlKey: true })}, 'tidy')`));

  // spy on the action so we can see when a key triggers it
  await t.js(`(() => { window.__tidyCalls = 0; const real = window.tidy; window.__realTidy = real; window.tidy = function () { window.__tidyCalls++; }; return 0; })()`);
  const press = async (key, mods) => { await t.js(`document.activeElement && document.activeElement.blur(); 0`); await t.key(key, mods); return t.js(`window.__tidyCalls`); };
  t.check('T runs tidy by default', (await press('T')) === 1);

  // ---- rebind through the dialog ----
  await t.js(`shortcutsDialog(); 0`);
  await t.sleep(300);
  const rows = await t.js(`[...document.querySelectorAll('#modal-root .shortcut-row')].map((r) => r.firstChild.textContent + '=' + r.querySelector('.shortcut-key').textContent)`);
  t.check('the dialog lists every action with its keys', rows.length >= 18 && rows.includes('Tidy nodes=T') && rows.includes('Redo=Ctrl+Shift+Z / Ctrl+Y'), rows);
  const rowOf = (label) => `[...document.querySelectorAll('#modal-root .shortcut-row')].find((r) => r.firstChild.textContent === ${JSON.stringify(label)})`;
  const capture = async (label, init) => {
    await t.js(`${rowOf(label)}.querySelector('.shortcut-key').click(); 0`);
    await t.js(`document.body.dispatchEvent(${ev(init)}); 0`);
    await t.sleep(150);
  };

  await capture('Tidy nodes', { key: 'k', ctrlKey: true });
  t.check('a combo used by another action is refused and explained', /already used by .Command palette./.test(await t.js(`document.querySelector('#modal-root .err')?.textContent || ''`)) && (await t.js(`shortcutLabel('tidy')`)) === 'T');
  await t.js(`document.body.dispatchEvent(${ev({ key: 'Escape' })}); 0`); // cancel capture
  await capture('Tidy nodes', { key: 'T', ctrlKey: true, shiftKey: true });
  t.check('the new combo is shown', (await t.js(`shortcutLabel('tidy')`)) === 'Ctrl+Shift+T' && (await t.js(`${rowOf('Tidy nodes')}.querySelector('.shortcut-key').textContent`)) === 'Ctrl+Shift+T');
  await t.js(`closeModal(); 0`);

  t.check('the old key no longer triggers the action', (await press('T')) === 1);
  t.check('the new combo triggers it', (await press('T', ['control', 'shift'])) === 2);

  // ---- persistence ----
  const saved = await t.readSaved((s) => s.settings && s.settings.shortcuts && s.settings.shortcuts.tidy);
  t.check('the binding is saved with the settings', saved.settings.shortcuts.tidy === 'Ctrl+Shift+T', saved.settings.shortcuts);

  // ---- unbind and reset ----
  await t.js(`shortcutsDialog(); 0`);
  await t.sleep(300);
  await t.js(`${rowOf('Tidy nodes')}.querySelectorAll('button')[1].click(); 0`);
  await t.js(`closeModal(); 0`);
  t.check('a shortcut can be unbound', (await t.js(`shortcutLabel('tidy')`)) === 'unassigned' && (await press('T', ['control', 'shift'])) === 2 && (await press('T')) === 2);
  await t.js(`shortcutsDialog(); 0`);
  await t.sleep(300);
  await t.js(`${rowOf('Tidy nodes')}.querySelectorAll('button')[2].click(); closeModal(); 0`);
  t.check('reset brings the default back', (await t.js(`shortcutLabel('tidy')`)) === 'T' && (await press('T')) === 3);

  // ---- global shortcuts reach past a terminal ----
  await t.js(`shortcutsDialog(); 0`);
  await t.sleep(300);
  await capture('Command palette', { key: 'O', ctrlKey: true, shiftKey: true });
  t.check('rebinding a global shortcut updates what terminals let through', await t.js(`shortcutIsGlobal(${ev({ key: 'O', ctrlKey: true, shiftKey: true })}) && !shortcutIsGlobal(${ev({ key: 'k', ctrlKey: true })}) && !shortcutIsGlobal(${ev({ key: 't' })})`));
  await t.js(`closeModal(); 0`);
  await t.key('O', ['control', 'shift']);
  await t.sleep(400);
  t.check('the palette opens with the new combo', await t.js(`!!document.querySelector('.palette, #palette, [class*=palette]')`));
  await t.key('Escape');
  await t.sleep(200);

  // reset everything
  await t.js(`shortcutsDialog(); 0`);
  await t.sleep(200);
  await t.js(`[...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Reset all').click(); 0`);
  t.check('Reset all restores every default', await t.js(`Object.keys(state.settings.shortcuts).length === 0 && shortcutLabel('palette') === 'Ctrl+K / Ctrl+Shift+P'`));
  await t.js(`closeModal(); window.tidy = window.__realTidy; 0`);

  // help dialog reflects the bindings
  await t.js(`setShortcut('minimap', 'Ctrl+Alt+M'); helpDialog(); 0`);
  await t.sleep(300);
  t.check('the help dialog shows the current keys', /Ctrl\+Alt\+M/.test(await t.js(`document.querySelector('#modal-root').innerText`)));
  await t.js(`closeModal(); resetShortcut('minimap'); 0`);
};
