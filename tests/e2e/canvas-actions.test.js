// The Add and Connect buttons sit inside the canvas, at its top right, and Add is labelled "+ Add".
module.exports = async (t) => {
  const r = await t.js(`(() => {
    const vp = viewport.getBoundingClientRect(), box = document.getElementById('canvas-actions').getBoundingClientRect();
    const add = document.getElementById('add-btn'), link = document.getElementById('link-mode');
    const ar = add.getBoundingClientRect(), lr = link.getBoundingClientRect();
    return { label: add.textContent.trim(), vp: { top: vp.top, right: vp.right }, ar: { top: ar.top, right: ar.right }, lr: { top: lr.top, right: lr.right },
      inCanvas: ar.top > vp.top && lr.top > vp.top && ar.right <= vp.right && lr.right <= vp.right,
      notInToolbar: !document.getElementById('toolbar').contains(add) && !document.getElementById('subtools').contains(link) };
  })()`);
  t.check('the button reads "+ Add"', r.label === '+ Add', r.label);
  t.check('Add and Connect are inside the canvas area', r.inCanvas, r);
  t.check('and no longer in the toolbars', r.notInToolbar);
  t.check('Connect sits to the right of Add', r.lr.right > r.ar.right);

  await t.click(Math.round((r.ar.right + (await t.js(`document.getElementById('add-btn').getBoundingClientRect().left`))) / 2), Math.round(r.ar.top + 10));
  await t.sleep(200);
  const menu = await t.js(`(() => { const m = document.querySelector('#canvas-actions .menu'); if (!m) return null; const b = m.getBoundingClientRect(); return { right: b.right, left: b.left, w: innerWidth }; })()`);
  t.check('the Add menu opens and stays on screen', !!menu && menu.left >= 0 && menu.right <= menu.w, menu);
  await t.key('Escape');
};
