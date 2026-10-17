// Localization. The UI is written in English; a catalog maps the English text to another language and the visible DOM
// (text, tooltips, placeholders) is translated as it appears, so every dialog is covered without touching each call site.
// Catalogs live in locales/<code>.js and register themselves in I18N_CATALOGS. Text that is not in the catalog stays English.
//
// Catalog format: { name: 'Português (Brasil)', exact: { 'English text': 'Texto' }, patterns: [['Discard changes to {0}?', 'Descartar alterações em {0}?']] }
// Patterns cover messages that carry a name or a number; {0}, {1}... are filled from the matched text.

const I18N_CATALOGS = {};
const i18n = { code: 'en', catalog: null, patterns: [], seen: new Set() };

const I18N_ATTRS = ['title', 'placeholder', 'aria-label'];
// User content and code are never translated.
const I18N_SKIP = '.xterm, textarea, pre, code, .md, .md-pane, .node-head .title, .floor-tab > span, .sb-item, .tabbar .tab, .tree-item, .commit-row, .mono, [data-no-i18n], script, style';

const textRecords = new WeakMap(); // text node -> { src, out }
const attrRecords = new WeakMap(); // element -> { attr -> { src, out } }

const patternRegex = (pat) => new RegExp('^' + pat.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, '(.+?)') + '$');

function setLanguage(code) {
  const cat = code && code !== 'en' ? I18N_CATALOGS[code] : null;
  i18n.code = cat ? code : 'en';
  i18n.catalog = cat;
  i18n.patterns = cat ? (cat.patterns || []).map(([en, tr]) => ({ re: patternRegex(en), tr })) : [];
  document.documentElement.lang = i18n.code;
  retranslateAll();
}

// Translate one English string; returns the input when there is no translation.
function tr(text) {
  if (!i18n.catalog) return text;
  const core = text.trim();
  if (!core) return text;
  const lead = text.slice(0, text.indexOf(core)), trail = text.slice(text.indexOf(core) + core.length);
  let out = i18n.catalog.exact[core];
  if (out === undefined) {
    for (const p of i18n.patterns) {
      const m = p.re.exec(core);
      if (m) { out = p.tr.replace(/\{(\d+)\}/g, (_x, i) => m[+i + 1]); break; }
    }
  }
  return out === undefined ? text : lead + out + trail;
}

const skipped = (el) => !!(el && el.closest && el.closest(I18N_SKIP));

function translateText(node) {
  if (skipped(node.parentElement)) return;
  const rec = textRecords.get(node);
  const cur = node.nodeValue;
  // Our own write (or an unchanged node): keep the remembered English. Anything else is new English text.
  const src = rec && cur === rec.out ? rec.src : cur;
  if (!src.trim()) return;
  if (!i18n.catalog) {
    if (src.trim().length > 1) i18n.seen.add(src.trim());
    if (rec && cur !== src) node.nodeValue = src;
    textRecords.set(node, { src, out: src });
    return;
  }
  i18n.seen.add(src.trim());
  const out = tr(src);
  textRecords.set(node, { src, out });
  if (out !== cur) node.nodeValue = out;
}

function translateAttrs(el) {
  if (skipped(el)) return;
  const recs = attrRecords.get(el) || {};
  for (const attr of I18N_ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const cur = el.getAttribute(attr);
    const rec = recs[attr];
    const src = rec && cur === rec.out ? rec.src : cur;
    if (!src.trim()) continue;
    i18n.seen.add(src.trim());
    const out = i18n.catalog ? tr(src) : src;
    recs[attr] = { src, out };
    if (out !== cur) el.setAttribute(attr, out);
  }
  attrRecords.set(el, recs);
}

function translateTree(root) {
  if (root.nodeType === 3) { translateText(root); return; }
  if (root.nodeType !== 1) return;
  if (root.matches?.('script, style, .xterm')) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches('script, style, .xterm, textarea, pre, code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) translateText(n); else translateAttrs(n);
  }
}

function retranslateAll() { translateTree(document.body); }

const i18nObserver = new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'childList') m.addedNodes.forEach((n) => translateTree(n));
    else if (m.type === 'characterData') translateText(m.target);
    else if (m.type === 'attributes') translateAttrs(m.target);
  }
});

// The language setting: '' follows the system, otherwise a catalog code or 'en'.
function languageFromSetting() {
  const wanted = state?.settings?.language;
  if (wanted === 'en') return 'en';
  if (wanted && I18N_CATALOGS[wanted]) return wanted;
  const system = (navigator.language || 'en').toLowerCase();
  return (!wanted && Object.keys(I18N_CATALOGS).find((c) => system.startsWith(c.split('-')[0]))) || 'en';
}

function startI18n() {
  setLanguage(languageFromSetting());
  i18nObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
}

const availableLanguages = () => [['', 'System default'], ['en', 'English'], ...Object.entries(I18N_CATALOGS).map(([c, v]) => [c, v.name])];
