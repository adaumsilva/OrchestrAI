// Shared helpers and the node-kind registry. Loaded before every kind.
const api = window.orchestrai;
const call = api.call;
const NodeKinds = {};

// h('div', {class: 'x', onclick: fn}, 'text', childEl)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const joinPath = (dir, name) => dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + name;

function closeModal() {
  document.getElementById('modal-root').replaceChildren();
}

// modal({title, content: Element, actions: [{label, primary, onClick(close)}]})
function modal({ title, content, actions = [] }) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: 'modal' },
    h('h3', {}, title),
    content,
    h('div', { class: 'actions' },
      actions.map((a) => h('button', { class: a.primary ? 'primary' : '', onclick: () => a.onClick(closeModal) }, a.label))));
  root.replaceChildren(box);
  root.onmousedown = (e) => { if (e.target === root) closeModal(); };
  const first = box.querySelector('input,textarea');
  if (first) first.focus();
  return box;
}

function alertModal(title, text) {
  modal({ title, content: h('div', { class: 'mono' }, text), actions: [{ label: 'OK', primary: true, onClick: (c) => c() }] });
}

function confirmModal(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    modal({
      title,
      content: h('div', {}, text),
      actions: [
        { label: 'Cancel', onClick: (c) => { c(); resolve(false); } },
        { label: okLabel, primary: true, onClick: (c) => { c(); resolve(true); } },
      ],
    });
  });
}

// popupMenu(x, y, [{label, onClick, disabled} | {separator: true}]) - a context menu at the pointer.
function popupMenu(x, y, items) {
  document.querySelectorAll(".popup-menu").forEach((m) => m.remove());
  const menu = h("div", { class: "menu popup-menu" }, items.map((it) => it.separator
    ? h("div", { class: "menu-sep" })
    : h("button", { class: "menu-item", disabled: it.disabled, onclick: () => { close(); it.onClick(); } }, it.label)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + "px";
  function close() { menu.remove(); removeEventListener("mousedown", away, true); removeEventListener("keydown", esc, true); removeEventListener("blur", close); }
  const away = (e) => { if (!menu.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  addEventListener("mousedown", away, true);
  addEventListener("keydown", esc, true);
  addEventListener("blur", close);
  return close;
}
