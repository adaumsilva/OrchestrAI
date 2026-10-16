// Terminal themes: built-in palettes, custom themes, the light/dark pair that "Follow system" uses,
// theme import, and the installed-monospace-font picker. Loaded before the terminal node kind.

const TERMINAL_PALETTES = {
  dark: {
    background: '#1e1e1e', foreground: '#f5f5f7', cursor: '#0a84ff', cursorAccent: '#1e1e1e', selectionBackground: '#0a84ff4d',
    black: '#3a3a3c', red: '#ff453a', green: '#32d74b', yellow: '#ffd60a', blue: '#0a84ff', magenta: '#bf5af2', cyan: '#64d2ff', white: '#d1d1d6',
    brightBlack: '#636366', brightRed: '#ff6961', brightGreen: '#5ee07a', brightYellow: '#ffe066', brightBlue: '#409cff', brightMagenta: '#da8fff', brightCyan: '#8ae0ff', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#1d1d1f', cursor: '#007aff', cursorAccent: '#ffffff', selectionBackground: '#007aff33',
    black: '#1d1d1f', red: '#d70015', green: '#248a3d', yellow: '#b25000', blue: '#0040dd', magenta: '#8944ab', cyan: '#0071a4', white: '#6e6e73',
    brightBlack: '#8e8e93', brightRed: '#ff3b30', brightGreen: '#30d158', brightYellow: '#c93400', brightBlue: '#007aff', brightMagenta: '#af52de', brightCyan: '#32ade6', brightWhite: '#3a3a3c',
  },
  midnight: {
    background: '#0b0f1a', foreground: '#c8d3f5', cursor: '#82aaff', cursorAccent: '#0b0f1a', selectionBackground: '#2f3b6a99',
    black: '#1b2036', red: '#ff757f', green: '#c3e88d', yellow: '#ffc777', blue: '#82aaff', magenta: '#c099ff', cyan: '#86e1fc', white: '#c8d3f5',
    brightBlack: '#444a73', brightRed: '#ff98a4', brightGreen: '#c7fb6d', brightYellow: '#ffd89e', brightBlue: '#9bb8ff', brightMagenta: '#d3b5ff', brightCyan: '#a4ecff', brightWhite: '#ffffff',
  },
  solarized: {
    background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', cursorAccent: '#002b36', selectionBackground: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
};

const BUILTIN_THEMES = [['dark', 'Dark'], ['light', 'Light'], ['midnight', 'Midnight'], ['solarized', 'Solarized dark']];
const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const THEME_KEYS = ['background', 'foreground', 'cursor', 'selection', ...ANSI_KEYS];
const THEME_LABELS = { background: 'Background', foreground: 'Text', cursor: 'Cursor', selection: 'Selection' };

const prefersDark = matchMedia('(prefers-color-scheme: dark)');

const customThemes = () => state.settings?.customThemes || [];
const hex6 = (v) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(v || '').trim());
  if (!m) return '';
  let c = m[1].toLowerCase();
  if (c.length === 3) c = [...c].map((x) => x + x).join('');
  return '#' + c.slice(0, 6);
};

// Custom themes keep a plain color map ({ background, foreground, cursor, selection, black ... }).
function paletteFromColors(c) {
  const base = TERMINAL_PALETTES.dark;
  const bg = hex6(c.background) || base.background;
  const out = { ...base, background: bg, foreground: hex6(c.foreground) || base.foreground, cursor: hex6(c.cursor) || base.cursor, cursorAccent: bg, selectionBackground: (hex6(c.selection) || '#0a84ff') + '66' };
  for (const k of ANSI_KEYS) out[k] = hex6(c[k]) || base[k];
  return out;
}

// All names a terminal can use: built-ins and `custom:<id>`. 'system' follows the light/dark pair from Settings.
function terminalTheme(name) {
  const s = terminalSettings();
  if (name === 'system' || !name) name = prefersDark.matches ? (s.themeDark || 'dark') : (s.themeLight || 'light');
  if (TERMINAL_PALETTES[name]) return TERMINAL_PALETTES[name];
  const custom = customThemes().find((t) => `custom:${t.id}` === name);
  if (custom) return paletteFromColors(custom.colors);
  return TERMINAL_PALETTES[prefersDark.matches ? 'dark' : 'light'];
}

const themeChoices = () => [...BUILTIN_THEMES, ...customThemes().map((t) => [`custom:${t.id}`, t.name || 'Custom theme'])];

// ---------- import ----------
// Accepts JSON in the xterm.js / VS Code style or a Windows Terminal color scheme.
function parseThemeText(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('Not valid JSON. Paste an xterm.js theme or a Windows Terminal color scheme.'); }
  if (Array.isArray(j?.schemes)) j = j.schemes[0];
  if (!j || typeof j !== 'object') throw new Error('No theme found in that text.');
  const alias = { cursorColor: 'cursor', cursorBackground: 'cursor', selectionBackground: 'selection', purple: 'magenta', brightPurple: 'brightMagenta' };
  const colors = {};
  for (const [k, v] of Object.entries(j)) {
    const key = alias[k] || k;
    if (THEME_KEYS.includes(key) && hex6(v)) colors[key] = hex6(v);
  }
  if (!colors.background && !colors.foreground) throw new Error('No colors were recognised in that theme.');
  return { name: typeof j.name === 'string' ? j.name.slice(0, 40) : '', colors };
}

// ---------- installed monospace fonts ----------
let monoFonts = null; // [{ family }] once loaded; null while unknown, [] when unavailable
const probe = document.createElement('canvas').getContext('2d');
function isMonospace(family) {
  probe.font = `16px "${family.replace(/"/g, '')}", serif`;
  const a = probe.measureText('iiiiiiiiii').width, b = probe.measureText('WWWWWWWWWW').width, c = probe.measureText('0000000000').width;
  probe.font = '16px serif';
  const serif = probe.measureText('iiiiiiiiii').width;
  return Math.abs(a - b) < 0.5 && Math.abs(a - c) < 0.5 && Math.abs(a - serif) > 0.5; // equal widths, and not a fallback to serif
}

async function loadMonospaceFonts() {
  if (monoFonts) return monoFonts;
  try {
    const all = await navigator.queryLocalFonts();
    const families = [...new Set(all.map((f) => f.family))].sort((x, y) => x.localeCompare(y));
    monoFonts = families.filter(isMonospace);
  } catch {
    monoFonts = []; // permission denied or API unavailable; the free-text field still works
  }
  return monoFonts;
}

// A font control: a free-text family field plus a list of installed monospace fonts, each previewed in its own face.
// onChange receives the CSS font-family string, or '' for "use default".
function fontPicker({ value, placeholder, onChange }) {
  const input = h('input', { placeholder, value: value || '', style: 'flex:1', oninput: (e) => onChange(e.target.value.trim()) });
  const list = h('div', { class: 'font-list hidden' });
  const toggle = h('button', { type: 'button', class: 'sheet-btn', title: 'Choose from installed monospace fonts' }, 'Installed fonts ▾');
  const css = (family) => `"${family}", monospace`;
  const pick = (family) => { input.value = family ? css(family) : ''; onChange(input.value); list.classList.add('hidden'); };
  const fill = (fonts) => {
    list.replaceChildren(
      h('div', { class: 'font-row', onclick: () => pick('') }, h('span', {}, 'Use default')),
      ...(fonts.length
        ? fonts.map((f) => h('div', { class: 'font-row', onclick: () => pick(f) }, h('span', {}, f), h('span', { class: 'font-sample', style: `font-family:${css(f)}` }, 'AaBb 0O1l {}')))
        : [h('div', { class: 'sheet-hint', style: 'padding:8px' }, 'The installed font list is not available here. Type a font family instead.')]));
  };
  toggle.onclick = async () => {
    if (!list.classList.contains('hidden')) return list.classList.add('hidden');
    list.classList.remove('hidden');
    list.replaceChildren(h('div', { class: 'sheet-hint', style: 'padding:8px' }, 'Reading installed fonts…'));
    fill(await loadMonospaceFonts());
  };
  return { input, toggle, list, root: h('div', { class: 'font-picker' }, h('div', { class: 'row' }, input, toggle), list) };
}
