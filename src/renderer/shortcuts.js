// Keyboard shortcut registry: every app-level shortcut is an action with a default combo; users may rebind or unbind them.
// Handlers ask shortcutMatch(event, 'action') instead of testing keys themselves, so a rebind takes effect everywhere.
// Combos are written like "Ctrl+Shift+Z", "Alt+]", "PageDown", "T" or "?" (modifier order: Ctrl, Alt, Shift).

const SHORTCUT_DEFS = [
  // `global` shortcuts also work while a terminal has focus (the terminal lets them through instead of sending them to the shell)
  { id: 'palette', label: 'Command palette', keys: ['Ctrl+K', 'Ctrl+Shift+P'], global: true },
  { id: 'nextNode', label: 'Next node', keys: ['Alt+]'], global: true },
  { id: 'prevNode', label: 'Previous node', keys: ['Alt+['], global: true },
  { id: 'nextFloor', label: 'Next floor', keys: ['Ctrl+PageDown'], global: true },
  { id: 'prevFloor', label: 'Previous floor', keys: ['Ctrl+PageUp'], global: true },
  { id: 'nextWorkspace', label: 'Next workspace', keys: ['Ctrl+Alt+PageDown'], global: true },
  { id: 'prevWorkspace', label: 'Previous workspace', keys: ['Ctrl+Alt+PageUp'], global: true },
  { id: 'selectAll', label: 'Select all nodes', keys: ['Ctrl+A'] },
  { id: 'undo', label: 'Undo', keys: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'deleteSelection', label: 'Delete selection', keys: ['Delete', 'Backspace'] },
  { id: 'group', label: 'Group selection', keys: ['Ctrl+G'] },
  { id: 'ungroup', label: 'Ungroup', keys: ['Ctrl+Shift+G'] },
  { id: 'connect', label: 'Connect selected node', keys: ['C'] },
  { id: 'tidy', label: 'Tidy nodes', keys: ['T'] },
  { id: 'minimap', label: 'Toggle minimap', keys: ['M'] },
  { id: 'prompter', label: 'Prompter', keys: ['P'] },
  { id: 'terminalsPanel', label: 'Terminals overview', keys: ['L'] },
  { id: 'taskManager', label: 'Task manager', keys: ['K'] },
  { id: 'help', label: 'Keyboard shortcuts', keys: ['?'] },
];

const NAMED_KEYS = { ' ': 'Space', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', escape: 'Esc', pageup: 'PageUp', pagedown: 'PageDown', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', tab: 'Tab', home: 'Home', end: 'End', insert: 'Insert' };

// The combo of a key event, or '' for a bare modifier press.
function eventCombo(e) {
  const k = e.key;
  if (!k || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Dead'].includes(k)) return '';
  let name = NAMED_KEYS[k.toLowerCase()] || (/^f\d{1,2}$/i.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k);
  const letter = /^[A-Z0-9]$/.test(name);
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  // For symbols the shifted character is already in the key ("?"), so Shift is only part of letter, digit and named-key combos.
  if (e.shiftKey && (letter || name.length > 1)) mods.push('Shift');
  return [...mods, name].join('+');
}

const normalizeCombo = (c) => {
  if (!c) return '';
  const parts = String(c).split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  const has = (m) => parts.some((p) => p.toLowerCase() === m);
  const k = key.length === 1 ? key.toUpperCase() : (NAMED_KEYS[key.toLowerCase()] || key);
  return [has('ctrl') || has('cmd') ? 'Ctrl' : null, has('alt') ? 'Alt' : null, has('shift') ? 'Shift' : null, k].filter(Boolean).join('+');
};

// Active combos for an action: the user's choice (one combo, or none when unbound), else the defaults.
function shortcutKeys(id) {
  const user = state?.settings?.shortcuts;
  if (user && Object.prototype.hasOwnProperty.call(user, id)) return user[id] ? [normalizeCombo(user[id])] : [];
  return (SHORTCUT_DEFS.find((d) => d.id === id)?.keys || []).map(normalizeCombo);
}

// While the shortcuts dialog is waiting for a new combo, no action may fire (the key being pressed is the new binding).
let shortcutCapturing = false;
const shortcutMatch = (e, id) => { if (shortcutCapturing) return false; const c = eventCombo(e); return !!c && shortcutKeys(id).includes(c); };
const shortcutLabel = (id) => shortcutKeys(id).join(' / ') || 'unassigned';
const shortcutIsGlobal = (e) => SHORTCUT_DEFS.some((d) => d.global && shortcutMatch(e, d.id));

// Another action already using this combo (ignoring `exceptId`).
function shortcutConflict(combo, exceptId) {
  const c = normalizeCombo(combo);
  return SHORTCUT_DEFS.find((d) => d.id !== exceptId && shortcutKeys(d.id).includes(c)) || null;
}

function setShortcut(id, combo) {
  state.settings.shortcuts = state.settings.shortcuts || {};
  const def = SHORTCUT_DEFS.find((d) => d.id === id);
  const c = normalizeCombo(combo);
  // Choosing the default again just drops the override.
  if (def && def.keys.length === 1 && c && normalizeCombo(def.keys[0]) === c) delete state.settings.shortcuts[id];
  else state.settings.shortcuts[id] = c; // '' = unbound
  save();
}
const resetShortcut = (id) => { if (state.settings.shortcuts) delete state.settings.shortcuts[id]; save(); };
const resetAllShortcuts = () => { state.settings.shortcuts = {}; save(); };

function shortcutsDialog() {
  let capturing = null; // action id waiting for a key press
  let message = '';
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:6px;min-width:520px;max-height:62vh;overflow:auto' });

  const stop = () => { capturing = null; shortcutCapturing = false; removeEventListener('keydown', onKey, true); };
  function onKey(e) {
    if (!capturing) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.key === 'Escape') { stop(); message = ''; render(); return; }
    const combo = eventCombo(e);
    if (!combo) return; // only a modifier so far
    const clash = shortcutConflict(combo, capturing);
    if (clash) { message = `${combo} is already used by “${clash.label}”. Pick another key, or change that one first.`; render(); return; }
    setShortcut(capturing, combo);
    stop(); message = ''; render();
  }

  function render() {
    body.replaceChildren(...[
      message ? h('div', { class: 'err' }, message) : null,
      h('div', { class: 'muted' }, capturing ? 'Press the new key combination. Esc cancels.' : 'Click a shortcut to change it.'),
      ...SHORTCUT_DEFS.map((d) => {
        const custom = state.settings.shortcuts && Object.prototype.hasOwnProperty.call(state.settings.shortcuts, d.id);
        return h('div', { class: 'shortcut-row' },
          h('span', {}, d.label),
          h('button', {
            class: 'shortcut-key' + (capturing === d.id ? ' capturing' : ''),
            onclick: () => { if (capturing) stop(); capturing = d.id; message = ''; shortcutCapturing = true; addEventListener('keydown', onKey, true); render(); },
          }, capturing === d.id ? 'Press keys…' : shortcutLabel(d.id)),
          h('button', { title: 'Remove the shortcut', onclick: () => { stop(); setShortcut(d.id, ''); render(); } }, '∅'),
          h('button', { title: 'Back to the default', disabled: !custom, onclick: () => { stop(); resetShortcut(d.id); render(); } }, '↺'));
      })].filter(Boolean));
  }
  render();
  modal({
    title: 'Keyboard shortcuts', content: body,
    actions: [
      { label: 'Reset all', onClick: () => { stop(); resetAllShortcuts(); message = ''; render(); } },
      { label: 'Close', primary: true, onClick: (c) => { stop(); c(); } },
    ],
  });
}

registerCommand({ id: 'edit-shortcuts', label: 'Customize keyboard shortcuts…', run: () => shortcutsDialog() });
