// Freehand sketch pad. Strokes are stored normalised to the pad size, so resizing the node rescales the drawing.
NodeKinds.draw = {
  label: 'Drawing', w: 420, h: 320,
  mount({ node, body, save }) {
    node.data.strokes ||= [];
    node.data.color ||= '#0a84ff';
    node.data.size ||= 3;
    let tool = 'pen';

    const canvas = h('canvas', { style: 'flex:1;min-height:0;width:100%;touch-action:none;cursor:crosshair;border-radius:6px' });
    const COLORS = ['#f5f5f7', '#1d1d1f', '#ff453a', '#ff9f0a', '#30d158', '#0a84ff', '#bf5af2'];
    const swatches = COLORS.map((c) => h('button', {
      class: 'swatch', title: c, style: `background:${c}`,
      onclick: () => { node.data.color = c; tool = 'pen'; refreshTools(); save(); },
    }));
    const size = h('select', { title: 'Stroke width' }, [2, 3, 5, 9, 16].map((s) => h('option', { value: s, selected: s === node.data.size }, `${s}px`)));
    size.addEventListener('change', () => { node.data.size = +size.value; save(); });
    const eraser = h('button', { title: 'Eraser', onclick: () => { tool = tool === 'erase' ? 'pen' : 'erase'; refreshTools(); } }, 'Eraser');
    const undo = h('button', { title: 'Undo last stroke', onclick: () => { node.data.strokes.pop(); render(); save(); } }, 'Undo');
    const clear = h('button', { title: 'Clear drawing', onclick: () => { node.data.strokes = []; render(); save(); } }, 'Clear');
    body.append(h('div', { class: 'row' }, swatches, size, eraser, undo, clear), canvas);

    function refreshTools() {
      swatches.forEach((s, i) => s.classList.toggle('on', tool === 'pen' && COLORS[i] === node.data.color));
      eraser.classList.toggle('active', tool === 'erase');
    }

    function render() {
      const dpr = devicePixelRatio || 1;
      const w = canvas.clientWidth, hgt = canvas.clientHeight;
      if (!w || !hgt) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hgt);
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const s of node.data.strokes) {
        const pts = s.pts;
        if (!pts.length) continue;
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = s.color || '#000';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = s.size;
        if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0] * w, pts[0][1] * hgt, s.size / 2, 0, Math.PI * 2); ctx.fill(); continue; }
        ctx.beginPath();
        ctx.moveTo(pts[0][0] * w, pts[0][1] * hgt);
        for (let i = 1; i < pts.length - 1; i++) {
          ctx.quadraticCurveTo(pts[i][0] * w, pts[i][1] * hgt, ((pts[i][0] + pts[i + 1][0]) / 2) * w, ((pts[i][1] + pts[i + 1][1]) / 2) * hgt);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0] * w, last[1] * hgt);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Pointer coordinates are taken relative to the canvas's on-screen rect, so canvas zoom does not matter.
    const norm = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };
    let current = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey) return;
      canvas.setPointerCapture(e.pointerId);
      current = { pts: [norm(e)], color: node.data.color, size: tool === 'erase' ? node.data.size * 3 : node.data.size, erase: tool === 'erase' };
      node.data.strokes.push(current);
      render();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      current.pts.push(norm(e));
      render();
    });
    const end = () => { if (current) { current = null; save(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    refreshTools();
    render();
    return () => ro.disconnect();
  },
};
