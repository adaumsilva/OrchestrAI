const fs = require('fs'), path = require('path');

module.exports = async (t) => {
  const text = (sel) => t.js(`document.querySelector(${JSON.stringify(sel)})?.innerText || ''`);
  const attr = (sel, a) => t.js(`document.querySelector(${JSON.stringify(sel)})?.getAttribute(${JSON.stringify(a)}) || ''`);

  t.check('starts in English when the system language is English', (await t.js(`document.documentElement.lang`)) === 'en' && (await attr('#undo-btn', 'title')) === 'Undo (Ctrl+Z)');
  t.check('the language list offers system default, English and Portuguese', JSON.stringify(await t.js(`availableLanguages()`)) === JSON.stringify([['', 'System default'], ['en', 'English'], ['pt', 'Português (Brasil)']]));

  // a note whose title and text are user content that happens to be a UI word
  await t.js(`addNode('note', { title: 'Settings', x: 60, y: 60 }, activeFloor()); 0`);
  await t.sleep(300);

  // ---- switch to Portuguese ----
  await t.js(`state.settings.language = 'pt'; setLanguage(languageFromSetting()); 0`);
  await t.sleep(300);
  t.check('html lang follows the language', (await t.js(`document.documentElement.lang`)) === 'pt');
  t.check('static toolbar tooltips are translated', (await attr('#undo-btn', 'title')) === 'Desfazer (Ctrl+Z)' && (await attr('#redo-btn', 'title')) === 'Refazer (Ctrl+Shift+Z)');
  t.check('the palette button tooltip is translated', (await attr('#palette-btn', 'title')) === 'Paleta de comandos (Ctrl+K)');

  await t.js(`terminalDialog({ mode: 'new', floor: activeFloor() }); 0`);
  await t.sleep(600);
  const sheet = await text('#modal-root');
  t.check('a dialog opened after the switch is translated', /Novo terminal/.test(sheet) && /Executa em/.test(sheet) && /Diretório de trabalho/.test(sheet) && /Monitorar atividade/.test(sheet), sheet.slice(0, 300));
  t.check('placeholders are translated', /ex\.: claude, codex/.test(await t.js(`document.querySelector('#modal-root input[placeholder^="ex."]')?.placeholder || ''`)));
  await t.js(`closeModal(); 0`);

  await t.js(`storageDialog(); 0`);
  await t.sleep(700);
  const st = await text('#modal-root');
  t.check('messages with numbers are translated through patterns', /Uso · .+ no total/.test(st) && /Limpeza/.test(st), st.slice(0, 300));
  await t.js(`closeModal(); settingsDialog(); 0`);
  await t.sleep(500);
  const se = await text('#modal-root');
  t.check('the settings dialog shows the new language setting and translated sections', /Idioma/.test(se) && /Contas/.test(se) && /Teclado/.test(se), se.slice(0, 400));
  t.check('the language select lists the languages', JSON.stringify(await t.js(`[...document.querySelectorAll('#modal-root select')].map((s) => [...s.options].map((o) => o.textContent)).find((o) => o.includes('English'))`)) === JSON.stringify(['Padrão do sistema', 'English', 'Português (Brasil)']));
  await t.js(`closeModal(); 0`);

  // ---- user content stays as typed ----
  t.check('node titles are user content and are not translated', (await t.js(`[...document.querySelectorAll('.node-head .title')].some((x) => x.textContent === 'Settings')`)));

  // ---- the observer keeps up with dynamic updates ----
  await t.js(`document.body.append(Object.assign(document.createElement('div'), { id: 'dyn', textContent: 'Redo' })); 0`);
  await t.sleep(200);
  t.check('text added later is translated', (await text('#dyn')) === 'Refazer');
  await t.js(`document.getElementById('dyn').firstChild.nodeValue = 'Undo'; 0`);
  await t.sleep(200);
  t.check('text changed later is translated again', (await text('#dyn')) === 'Desfazer');

  // ---- back to English restores the original text ----
  await t.js(`state.settings.language = 'en'; setLanguage(languageFromSetting()); 0`);
  await t.sleep(300);
  t.check('switching back restores every string', (await attr('#undo-btn', 'title')) === 'Undo (Ctrl+Z)' && (await text('#dyn')) === 'Undo');
  await t.js(`terminalDialog({ mode: 'new', floor: activeFloor() }); 0`);
  await t.sleep(500);
  t.check('and dialogs are English again', /Runs on/.test(await text('#modal-root')));
  await t.js(`closeModal(); 0`);

  // ---- system default ----
  const sys = await t.js(`(() => {
    const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');
    const set = (v) => Object.defineProperty(navigator, 'language', { configurable: true, get: () => v });
    state.settings.language = '';
    set('pt-BR'); const pt = languageFromSetting();
    set('fr-FR'); const fr = languageFromSetting();
    set('en-US'); const en = languageFromSetting();
    state.settings.language = 'en'; set('pt-BR'); const forced = languageFromSetting();
    delete navigator.language; if (real) Object.defineProperty(Navigator.prototype, 'language', real);
    return { pt, fr, en, forced };
  })()`);
  t.check('"System default" follows the OS language and falls back to English', sys.pt === 'pt' && sys.fr === 'en' && sys.en === 'en' && sys.forced === 'en', sys);

  // ---- persisted ----
  await t.js(`state.settings.language = 'pt'; save(); 0`);
  let saved = null;
  for (let i = 0; i < 30 && !(saved && saved.settings && saved.settings.language === 'pt'); i++) { await t.sleep(250); try { saved = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'workspace.json'), 'utf8')); } catch {} }
  t.check('the choice is saved with the settings', saved && saved.settings.language === 'pt');
};
