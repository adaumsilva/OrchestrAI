// Open in IDE: the preferred editor is chosen per workspace (falling back to a global default, then the first one found).

let ideCache = null;
const ideList = async (refresh) => { if (!ideCache || refresh) ideCache = await call('ide:list'); return ideCache; };

async function preferredIde(floorId) {
  const list = await ideList();
  const ws = (floorId && wsOfFloor(floorId)) || state.workspaces.find((w) => w.id === state.activeWs);
  const want = ws?.ide || state.settings?.ideId;
  return list.find((i) => i.id === want) || list[0] || null;
}

// openInIde(path, {floor, line}) opens in the preferred editor, asking the user to pick one when several are installed and none is preferred.
async function openInIde(target, { floor, line, choose } = {}) {
  const list = await ideList();
  if (!list.length) return alertModal('Open in IDE', 'No supported editor was found. Install one with its command line launcher on PATH (for example "code" for Visual Studio Code).');
  let ide = choose ? null : await preferredIde(floor?.id);
  if (!ide) {
    const it = await openPalette({ items: list.map((i) => ({ key: 'ide:' + i.id, label: i.label, icon: '⌨', ide: i })), placeholder: 'Open in which editor?', noRun: true, recent: false });
    if (!it) return;
    ide = it.ide;
  }
  const r = await call('ide:open', ide.id, target, line);
  if (!r.ok) alertModal('Open in IDE', r.error);
}

registerCommand({ id: 'open-ide', label: 'Open floor folder in IDE', run: () => { const f = activeFloor(); if (!f.dir) return alertModal('Open in IDE', 'This floor has no working directory.'); openInIde(f.dir, { floor: f }); } });
registerCommand({ id: 'open-ide-choose', label: 'Open floor folder in… (choose editor)', run: () => { const f = activeFloor(); if (!f.dir) return alertModal('Open in IDE', 'This floor has no working directory.'); openInIde(f.dir, { floor: f, choose: true }); } });
