// Embedded browser. Uses a shared persistent partition so logins survive restarts.
NodeKinds.portal = {
  label: 'Portal', w: 640, h: 440,
  mount({ node, body, save }) {
    node.data.url ||= 'https://www.google.com';
    const url = h('input', { value: node.data.url });
    const view = h('webview', { src: node.data.url, partition: 'persist:portal' });
    const nav = (fn) => () => { try { fn(); } catch {} };
    body.append(
      h('div', { class: 'row' },
        h('button', { title: 'Back', onclick: nav(() => view.goBack()) }, '←'),
        h('button', { title: 'Forward', onclick: nav(() => view.goForward()) }, '→'),
        h('button', { title: 'Reload', onclick: nav(() => view.reload()) }, '⟳'),
        url,
        h('button', { title: 'DevTools', onclick: nav(() => view.openDevTools()) }, '{}')),
      view);

    const normalize = (v) => {
      v = v.trim();
      if (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(v)) return 'http://' + v;
      if (/^[a-z]+:\/\//i.test(v)) return v;
      if (/^[^\s]+\.[^\s]+$/.test(v)) return 'https://' + v;
      return 'https://www.google.com/search?q=' + encodeURIComponent(v);
    };
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') view.loadURL(normalize(url.value)); });
    const onNav = (e) => { if (e.url && e.url !== 'about:blank') { url.value = e.url; node.data.url = e.url; save(); } };
    view.addEventListener('did-navigate', onNav);
    view.addEventListener('did-navigate-in-page', onNav);
    view.addEventListener('page-title-updated', (e) => { node.data.pageTitle = e.title; });
  },
};
