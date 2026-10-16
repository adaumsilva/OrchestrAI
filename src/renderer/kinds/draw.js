// Sketch pad. Strokes are stored normalised to the pad size, so resizing the node rescales the drawing.
// A stroke is { type, pts, color, size, erase? }. Freehand types (pen, brush, marker) keep every point; shapes keep two
// points (line/arrow: start and end, rect/ellipse: opposite corners). Strokes saved before types existed are pens.
NodeKinds.draw = {
  label: 'Drawing', w: 460, h: 340,
  mount({ node, body, save }) {
    node.data.strokes ||= [];
    node.data.color ||= '#0a84ff';
    node.data.size ||= 3;
    let tool = 'pen';
    let selected = null; // a stroke object

    const canvas = h('canvas', { tabindex: '0', style: 'flex:1;min-height:0;width:100%;touch-action:none;cursor:crosshair;border-radius:6px;outline:none' });
    const COLORS = ['#f5f5f7', '#1d1d1f', '#ff453a', '#ff9f0a', '#30d158', '#0a84ff', '#bf5af2'];
    const TOOLS = [
      ['pen', 'Pen', 'Freehand pen'], ['brush', 'Brush', 'Soft, wide brush'], ['marker', 'Marker', 'Translucent highlighter'],
      ['line', 'Line', 'Straight line'], ['arrow', 'Arrow', 'Arrow'], ['rect', 'Rect', 'Rectangle'], ['ellipse', 'Ellipse', 'Ellipse'],
      ['smart', 'Smart', 'Draw roughly; rectangles, ellipses, lines and arrows snap to clean shapes'],
      ['select', 'Select', 'Click a shape to select it, drag to move, Delete to remove'], ['erase', 'Eraser', 'Eraser'],
    ];
    const toolButtons = TOOLS.map(([id, label, tip]) => h('button', { title: tip, onclick: () => { tool = id; if (id !== 'select') selected = null; refreshTools(); render(); } }, label));
    const swatches = COLORS.map((c) => h('button', {
      class: 'swatch', title: c, style: `background:${c}`,
      onclick: () => {
        node.data.color = c;
        if (selected && tool === 'select') { selected.color = c; render(); save(); } else if (tool === 'erase') tool = 'pen';
        refreshTools();
        save();
      },
    }));
    const size = h('select', { title: 'Stroke width' }, [2, 3, 5, 9, 16].map((s) => h('option', { value: s, selected: s === node.data.size }, `${s}px`)));
    size.addEventListener('change', () => { node.data.size = +size.value; if (selected) { selected.size = +size.value; render(); } save(); });
    const del = () => { if (!selected) return; node.data.strokes = node.data.strokes.filter((s) => s !== selected); selected = null; render(); save(); };
    const undo = h('button', { title: 'Undo last stroke', onclick: () => { selected = null; node.data.strokes.pop(); render(); save(); } }, 'Undo');
    const delBtn = h('button', { title: 'Delete the selected shape', onclick: del }, 'Delete');
    const clear = h('button', { title: 'Clear drawing', onclick: () => { selected = null; node.data.strokes = []; render(); save(); } }, 'Clear');
    body.append(
      h('div', { class: 'row', style: 'flex-wrap:wrap' }, toolButtons),
      h('div', { class: 'row', style: 'flex-wrap:wrap' }, swatches, size, undo, delBtn, clear),
      canvas);

    function refreshTools() {
      toolButtons.forEach((b, i) => b.classList.toggle('active', TOOLS[i][0] === tool));
      swatches.forEach((s, i) => s.classList.toggle('on', COLORS[i] === node.data.color));
      canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    }

    const dims = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
    const px = (s) => { const { w, h: hh } = dims(); return s.pts.map(([x, y]) => [x * w, y * hh]); };

    function drawStroke(ctx, s, w, hh) {
      const pts = s.pts;
      if (!pts.length) return;
      const type = s.type || 'pen';
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = s.color || '#000';
      ctx.lineWidth = s.size;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;
      if (type === 'marker') { ctx.globalAlpha = 0.35; ctx.lineWidth = s.size * 3; ctx.lineCap = 'butt'; }
      if (type === 'brush') { ctx.globalAlpha = 0.8; ctx.lineWidth = s.size * 2; }
      const P = pts.map(([x, y]) => [x * w, y * hh]);
      if (type === 'line' || type === 'arrow') {
        const [a, b] = [P[0], P[P.length - 1]];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        if (type === 'arrow') {
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.max(10, s.size * 4);
          ctx.beginPath();
          for (const d of [-0.5, 0.5]) { ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - len * Math.cos(ang + d), b[1] - len * Math.sin(ang + d)); }
          ctx.stroke();
        }
      } else if (type === 'rect' || type === 'ellipse') {
        const [a, b] = [P[0], P[P.length - 1]];
        ctx.beginPath();
        if (type === 'rect') ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        else ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (P.length === 1) {
        ctx.beginPath(); ctx.arc(P[0][0], P[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(P[0][0], P[0][1]);
        for (let i = 1; i < P.length - 1; i++) ctx.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
        ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function render() {
      const dpr = devicePixelRatio || 1;
      const { w, h: hgt } = dims();
      if (!w || !hgt) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hgt);
      for (const s of node.data.strokes) drawStroke(ctx, s, w, hgt);
      ctx.globalCompositeOperation = 'source-over';
      if (selected) {
        const P = px(selected), pad = 6 + selected.size;
        const x0 = Math.min(...P.map((p) => p[0])) - pad, y0 = Math.min(...P.map((p) => p[1])) - pad;
        const x1 = Math.max(...P.map((p) => p[0])) + pad, y1 = Math.max(...P.map((p) => p[1])) + pad;
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#0a84ff'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.restore();
      }
    }

    // ---------- geometry ----------
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    function segDist(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      return dist(p, [a[0] + t * dx, a[1] + t * dy]);
    }
    const polyDist = (p, P) => (P.length === 1 ? dist(p, P[0]) : Math.min(...P.slice(1).map((q, i) => segDist(p, P[i], q))));
    function distanceTo(s, p) {
      const P = px(s), type = s.type || 'pen';
      if (type === 'line' || type === 'arrow') return segDist(p, P[0], P[P.length - 1]);
      if (type === 'rect' || type === 'ellipse') {
        const [a, b] = [P[0], P[P.length - 1]];
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        if (type === 'rect') return polyDist(p, [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
        const rx = (x1 - x0) / 2 || 1, ry = (y1 - y0) / 2 || 1;
        return Math.abs(Math.hypot((p[0] - (x0 + x1) / 2) / rx, (p[1] - (y0 + y1) / 2) / ry) - 1) * Math.min(rx, ry);
      }
      return polyDist(p, P);
    }

    // Smart draw: turn a rough freehand path into the shape it most resembles, or leave it alone.
    function recognize(P) {
      if (P.length < 6) return null;
      const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const bw = x1 - x0, bh = y1 - y0, diag = Math.hypot(bw, bh);
      if (diag < 24) return null;
      const first = P[0], last = P[P.length - 1];
      let len = 0;
      for (let i = 1; i < P.length; i++) len += dist(P[i - 1], P[i]);
      // Closed loop: rectangle or ellipse.
      if (dist(first, last) < diag * 0.3 && bw > 16 && bh > 16 && len > diag * 1.6) {
        const rectErr = P.reduce((m, p) => m + Math.min(Math.abs(p[0] - x0), Math.abs(p[0] - x1), Math.abs(p[1] - y0), Math.abs(p[1] - y1)), 0) / P.length / Math.min(bw, bh);
        const rx = bw / 2, ry = bh / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const ellErr = P.reduce((m, p) => m + Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1), 0) / P.length;
        if (Math.min(rectErr, ellErr) < 0.16) return { type: rectErr < ellErr ? 'rect' : 'ellipse', pts: [[x0, y0], [x1, y1]] };
        return null;
      }
      // Open path: a straight line, or a line with a short return stroke at the end (an arrow head).
      if (segMaxDev(P, first, last) < diag * 0.07) return { type: 'line', pts: [first, last] };
      let tip = 0;
      for (let i = 1; i < P.length; i++) if (dist(P[i], first) > dist(P[tip], first)) tip = i;
      const shaft = P.slice(0, tip + 1), head = P.slice(tip);
      let headLen = 0;
      for (let i = 1; i < head.length; i++) headLen += dist(head[i - 1], head[i]);
      const shaftLen = dist(first, P[tip]);
      if (tip > 2 && head.length > 2 && segMaxDev(shaft, first, P[tip]) < shaftLen * 0.1 && headLen > shaftLen * 0.1 && headLen < shaftLen * 0.6 && dist(last, first) < shaftLen) {
        return { type: 'arrow', pts: [first, P[tip]] };
      }
      return null;
    }
    const segMaxDev = (P, a, b) => Math.max(...P.map((p) => segDist(p, a, b)));

    // ---------- pointer handling ----------
    // Pointer coordinates are taken relative to the canvas's on-screen rect, so canvas zoom does not matter.
    const rectOf = () => canvas.getBoundingClientRect();
    const pointer = (e) => { const r = rectOf(); return [(e.clientX - r.left) * (canvas.clientWidth / r.width), (e.clientY - r.top) * (canvas.clientHeight / r.height)]; };
    const norm = (p) => [Math.min(1, Math.max(0, p[0] / canvas.clientWidth)), Math.min(1, Math.max(0, p[1] / canvas.clientHeight))];
    let current = null, moving = null;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey) return;
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      const p = pointer(e);
      if (tool === 'select') {
        let best = null, bd = 10;
        for (const s of node.data.strokes) { if (s.erase) continue; const d = distanceTo(s, p) - (s.size || 0) / 2; if (d <= bd) { best = s; bd = d; } }
        selected = best;
        moving = best ? { from: p, orig: best.pts.map((q) => q.slice()) } : null;
        render();
        return;
      }
      const type = tool === 'erase' ? 'pen' : tool === 'smart' ? 'pen' : tool;
      current = { type, pts: [norm(p)], color: node.data.color, size: tool === 'erase' ? node.data.size * 3 : node.data.size, erase: tool === 'erase' };
      node.data.strokes.push(current);
      render();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pointer(e);
      if (moving) {
        const dx = (p[0] - moving.from[0]) / canvas.clientWidth, dy = (p[1] - moving.from[1]) / canvas.clientHeight;
        selected.pts = moving.orig.map(([x, y]) => [x + dx, y + dy]);
        render();
        return;
      }
      if (!current) return;
      const q = norm(p);
      if (['line', 'arrow', 'rect', 'ellipse'].includes(current.type)) current.pts = [current.pts[0], q];
      else current.pts.push(q);
      render();
    });
    const end = () => {
      if (moving) { moving = null; save(); return; }
      if (!current) return;
      if (tool === 'smart') {
        const r = recognize(px(current));
        if (r) { const { w, h: hh } = dims(); Object.assign(current, { type: r.type, pts: r.pts.map(([x, y]) => [x / w, y / hh]) }); }
      }
      // A click without drag on a shape tool would leave an invisible zero-size shape.
      if (['line', 'arrow', 'rect', 'ellipse'].includes(current.type) && dist(px(current)[0], px(current)[1]) < 3) node.data.strokes.pop();
      current = null;
      render();
      save();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); e.stopPropagation(); del(); }
    });

    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    refreshTools();
    render();
    return () => ro.disconnect();
  },
};
