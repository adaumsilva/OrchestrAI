// Small markdown renderer that builds DOM nodes directly (never innerHTML), so note text cannot inject markup or run script.
// Supports headings, paragraphs, bold/italic/strike, inline code, fenced code with light syntax highlighting, block quotes,
// nested lists with task boxes, tables, rules, links (http/https/mailto only) and images (app-stored images/<file> only).

const MD_KEYWORDS = new Set(('const let var function return if else for while do switch case break continue new class extends import export from default ' +
  'async await try catch finally throw typeof instanceof in of this super null undefined true false void yield static ' +
  'def lambda pass elif with as is not and or None True False self print raise global ' +
  'fn pub use mod impl struct enum trait match mut ref loop where type interface package public private protected final int string bool float double char ' +
  'echo fi then done esac local readonly select select until').split(' '));

function mdHighlight(code, lang) {
  const out = document.createDocumentFragment();
  const hashComments = /^(sh|bash|zsh|shell|py|python|rb|ruby|yml|yaml|toml|ps1|powershell|conf|ini|dockerfile|make)$/i.test(lang || '');
  const re = hashComments
    ? /(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)/g;
  let last = 0, m;
  const push = (text, cls) => out.append(cls ? h('span', { class: cls }, text) : document.createTextNode(text));
  while ((m = re.exec(code))) {
    if (m.index > last) push(code.slice(last, m.index));
    if (m[1]) push(m[1], 'tok-c');
    else if (m[2]) push(m[2], 'tok-s');
    else if (m[3]) push(m[3], 'tok-n');
    else push(m[4], MD_KEYWORDS.has(m[4]) ? 'tok-k' : '');
    last = re.lastIndex;
  }
  if (last < code.length) push(code.slice(last));
  return out;
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function mdInline(text, ctx) {
  const frag = document.createDocumentFragment();
  // Order matters: code spans first, then images, links, emphasis.
  const re = /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|(https?:\/\/[^\s<)]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[2] != null) frag.append(h('code', {}, m[2].trim()));
    else if (m[4] != null) frag.append(mdImage(m[3], m[4], ctx));
    else if (m[6] != null) frag.append(mdLink(m[5], m[6], ctx));
    else if (m[7] != null || m[8] != null) frag.append(h('strong', {}, mdInline(m[7] ?? m[8], ctx)));
    else if (m[9] != null) frag.append(h('del', {}, mdInline(m[9], ctx)));
    else if (m[10] != null || m[11] != null) frag.append(h('em', {}, mdInline(m[10] ?? m[11], ctx)));
    else if (m[12] != null) frag.append(mdLink(m[12], m[12], ctx));
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function mdLink(label, url, ctx) {
  if (!SAFE_URL.test(url)) return document.createTextNode(`${label} (${url})`);
  return h('a', { href: url, title: url, onclick: (e) => { e.preventDefault(); call('app:openExternal', url); } }, label);
}

// Images are only shown when they live in the app's note image store; everything else is shown as a link.
function mdImage(alt, src, ctx) {
  const m = /^images\/([\w.-]+)$/.exec(src);
  if (!m) return SAFE_URL.test(src) ? mdLink(alt || src, src, ctx) : document.createTextNode(`[image: ${alt || src}]`);
  const img = h('img', { alt, class: 'md-img' });
  call('notes:image', m[1]).then((url) => { if (url) img.src = url; else img.replaceWith(document.createTextNode(`[missing image: ${alt || src}]`)); });
  return img;
}

function mdCodeBlock(code, lang) {
  const pre = h('pre', { class: 'md-code' }, h('code', {}, mdHighlight(code, lang)));
  const copy = h('button', { class: 'md-copy', title: 'Copy', onclick: () => { navigator.clipboard.writeText(code); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); } }, 'Copy');
  return h('div', { class: 'md-codewrap' }, lang ? h('span', { class: 'md-lang' }, lang) : null, copy, pre);
}

const MD_ROW = /^\s*\|.*\|\s*$/;
const MD_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function renderMarkdown(src, ctx = {}) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { root.append(h('p', {}, mdInline(para.join('\n'), ctx))); para.length = 0; } };

  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = /^(\s*)(`{3,}|~{3,})\s*([\w+#-]*)/.exec(line))) { // fenced code
      flush();
      const fence = m[2], code = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence)) code.push(lines[i++]);
      i++;
      root.append(mdCodeBlock(code.join('\n'), m[3]));
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); root.append(h('h' + m[1].length, {}, mdInline(m[2], ctx))); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); root.append(h('hr')); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      root.append(h('blockquote', {}, [...renderMarkdown(q.join('\n'), ctx).childNodes]));
      continue;
    }
    if (MD_ROW.test(line) && i + 1 < lines.length && MD_SEP.test(lines[i + 1])) { // table
      flush();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && MD_ROW.test(lines[i])) rows.push(splitRow(lines[i++]));
      root.append(h('div', { class: 'md-tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, mdInline(c, ctx))))),
        h('tbody', {}, rows.map((r) => h('tr', {}, head.map((_, ci) => h('td', {}, mdInline(r[ci] || '', ctx)))))))));
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) { // lists, nested by indentation
      flush();
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length))) {
        const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (lm) items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), text: lm[3] });
        else items[items.length - 1].text += ' ' + lines[i].trim();
        i++;
      }
      root.append(mdList(items, ctx));
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return root;
}

function mdList(items, ctx) {
  let pos = 0;
  const build = (indent) => {
    const ordered = items[pos].ordered;
    const list = h(ordered ? 'ol' : 'ul');
    while (pos < items.length && items[pos].indent >= indent) {
      if (items[pos].indent > indent) { // deeper: attach to the previous item
        const sub = build(items[pos].indent);
        (list.lastChild || list.appendChild(h('li'))).append(sub);
        continue;
      }
      const it = items[pos++];
      const task = /^\[([ xX])\]\s+(.*)$/.exec(it.text);
      list.append(h('li', { class: task ? 'md-task' : '' }, task ? h('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ' }) : null, mdInline(task ? task[2] : it.text, ctx)));
    }
    return list;
  };
  return build(items[0].indent);
}
