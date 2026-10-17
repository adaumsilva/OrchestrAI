// Ropes: dashed verlet cables between nodes, attached at the nearest edge midpoints,
// plus the "connect" interaction (select a node, press C, click another node).
// Uses globals from renderer.js (rt, state, activeFloor, save, viewport) at call time.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROPE_POINTS = 14;
const GRAVITY = 0.5;
const DAMPING = 0.97;
const SLEEP_SPEED = 0.03;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const sims = new Map(); // rope id -> { pts, flashUntil, dom }
let ropeFrame = null;
let connecting = null; // { floorId, nodeId, tip: {x, y} | null, hover: nodeId | null }

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// ---------- geometry ----------
const edgeMidpoints = (n) => [
  { x: n.x + n.w / 2, y: n.y }, { x: n.x + n.w, y: n.y + n.h / 2 },
  { x: n.x + n.w / 2, y: n.y + n.h }, { x: n.x, y: n.y + n.h / 2 },
];
const center = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const closest = (points, to) => points.reduce((best, p) => (Math.hypot(p.x - to.x, p.y - to.y) < Math.hypot(best.x - to.x, best.y - to.y) ? p : best));

const SIDE_DIRS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]; // top, right, bottom, left
const closestIndex = (points, to) => points.reduce((best, p, i) => (Math.hypot(p.x - to.x, p.y - to.y) < Math.hypot(points[best].x - to.x, points[best].y - to.y) ? i : best), 0);

function pinsFor(a, b) {
  const ma = edgeMidpoints(a), mb = edgeMidpoints(b);
  const ia = closestIndex(ma, center(b)), ib = closestIndex(mb, center(a));
  return { start: ma[ia], end: mb[ib], sa: SIDE_DIRS[ia], sb: SIDE_DIRS[ib] };
}

// ---------- circuit routing: right-angle runs with rounded corners ----------
const ropeRouting = () => (state.settings?.ropeRouting === 'circuit' ? 'circuit' : 'cable');
const CIRCUIT_GAP = 22, CIRCUIT_RADIUS = 10;

// Leg between two points, leaving horizontally first or vertically first.
const manhattan = (a, b, horizFirst) => (horizFirst ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b]);

// The corner points of a circuit route. sa/sb are the outward directions of the sides the rope leaves and enters by;
// a tie (pin) is a point the route must pass through.
function circuitPoints(start, sa, end, sb, pin) {
  const p1 = { x: start.x + sa.x * CIRCUIT_GAP, y: start.y + sa.y * CIRCUIT_GAP };
  const p3 = { x: end.x + sb.x * CIRCUIT_GAP, y: end.y + sb.y * CIRCUIT_GAP };
  let mid;
  if (pin) {
    mid = [...manhattan(p1, pin, sa.x !== 0), ...manhattan(pin, p3, sb.x === 0).slice(1)];
  } else if (sa.x !== 0 && sb.x !== 0) {
    const mx = (p1.x + p3.x) / 2;
    mid = [p1, { x: mx, y: p1.y }, { x: mx, y: p3.y }, p3];
  } else if (sa.x === 0 && sb.x === 0) {
    const my = (p1.y + p3.y) / 2;
    mid = [p1, { x: p1.x, y: my }, { x: p3.x, y: my }, p3];
  } else {
    mid = manhattan(p1, p3, sa.x !== 0);
  }
  const pts = [start, ...mid, end];
  // drop repeated points and points in the middle of a straight run
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1], b = out[i + 1];
    return !((Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5) || (Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5));
  });
}

function roundedPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(CIRCUIT_RADIUS, la / 2, lb / 2);
    const ax = p.x + ((a.x - p.x) / la) * r, ay = p.y + ((a.y - p.y) / la) * r;
    const bx = p.x + ((b.x - p.x) / lb) * r, by = p.y + ((b.y - p.y) / lb) * r;
    d += ` L${ax.toFixed(1)},${ay.toFixed(1)} Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

// Point halfway along a polyline, where the remove chip sits.
function polylineMid(pts) {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let left = lens.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) { const t = lens[i] ? left / lens[i] : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }; }
    left -= lens[i];
  }
  return pts[0];
}

// Smooth path through points using midpoint quadratic segments.
function smoothPath(pts) {
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

// ---------- simulation ----------
function newSim(pa, pb) {
  const pts = [];
  for (let i = 0; i < ROPE_POINTS; i++) {
    const t = i / (ROPE_POINTS - 1);
    const x = pa.x + (pb.x - pa.x) * t, y = pa.y + (pb.y - pa.y) * t;
    pts.push({ x, y, px: x, py: y });
  }
  return { pts, flashUntil: 0, dom: null, still: 0 };
}

function stepSim(sim, pa, pb, pin) {
  const pts = sim.pts, last = pts.length - 1, midI = Math.floor(pts.length / 2);
  const seg = Math.max(4, (Math.hypot(pb.x - pa.x, pb.y - pa.y) * 1.1 + 24) / last);
  let energy = 0;
  for (let i = 1; i < last; i++) {
    const p = pts[i];
    const vx = (p.x - p.px) * DAMPING, vy = (p.y - p.py) * DAMPING;
    energy += Math.abs(vx) + Math.abs(vy);
    p.px = p.x; p.py = p.y;
    p.x += vx; p.y += vy + GRAVITY;
  }
  for (let iter = 0; iter < 10; iter++) {
    pts[0].x = pa.x; pts[0].y = pa.y; pts[last].x = pb.x; pts[last].y = pb.y;
    if (pin) { pts[midI].x = pin.x; pts[midI].y = pin.y; }
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.0001;
      const diff = (d - seg) / d;
      const wa = i === 0 || (pin && i === midI) ? 0 : 0.5, wb = i + 1 === last || (pin && i + 1 === midI) ? 0 : 0.5;
      const total = wa + wb || 1;
      a.x += dx * diff * (wa / total); a.y += dy * diff * (wa / total);
      b.x -= dx * diff * (wb / total); b.y -= dy * diff * (wb / total);
    }
  }
  pts[0].x = pa.x; pts[0].y = pa.y; pts[last].x = pb.x; pts[last].y = pb.y;
  if (pin) { pts[midI].x = pin.x; pts[midI].y = pin.y; }
  return energy;
}

// ---------- rendering ----------
function ensureDom(f, rope, sim) {
  const R = rt.get(f.id);
  if (sim.dom) return sim.dom;
  const hit = svg('path', { class: 'rope-hit' });
  const line = svg('path', { class: 'rope' });
  const chip = svg('g', { class: 'rope-chip' });
  chip.append(svg('circle', { r: 9 }), svg('path', { d: 'M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5', class: 'x' }));
  chip.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  chip.addEventListener('click', (e) => { e.stopPropagation(); removeRope(f, rope.id); });
  const pinEl = svg('circle', { class: 'rope-pin', r: 6, style: 'display:none' });
  pinEl.addEventListener('mousedown', (e) => { e.stopPropagation(); startPinDrag(f, rope, e); });
  pinEl.addEventListener('dblclick', (e) => { e.stopPropagation(); setRopePin(f, rope, null); });
  hit.addEventListener('mousedown', (e) => { if (e.button === 0) startPinDrag(f, rope, e, true); });
  const g = svg('g', { class: 'rope-group' });
  g.append(hit, line, pinEl, chip);
  R.ropesEl.append(g);
  sim.dom = { g, hit, line, chip, pinEl };
  return sim.dom;
}

function renderRope(f, rope, sim) {
  const dom = ensureDom(f, rope, sim);
  const d = sim.circuit ? roundedPath(sim.circuit) : smoothPath(sim.pts);
  dom.hit.setAttribute('d', d);
  dom.line.setAttribute('d', d);
  const mid = sim.circuit ? polylineMid(sim.circuit) : sim.pts[Math.floor(sim.pts.length / 2)];
  dom.pinEl.style.display = rope.pin ? '' : 'none';
  if (rope.pin) { dom.pinEl.setAttribute('cx', rope.pin.x.toFixed(1)); dom.pinEl.setAttribute('cy', rope.pin.y.toFixed(1)); }
  dom.chip.setAttribute('transform', `translate(${mid.x.toFixed(1)},${mid.y.toFixed(1)})`);
  dom.line.classList.toggle('active', performance.now() < sim.flashUntil);
}

function stepRopes() {
  ropeFrame = null;
  const f = activeFloor();
  if (!f) return;
  let moving = false;
  const routing = ropeRouting();
  for (const rope of f.ropes) {
    if (rope.rf) continue; // cross-floor ropes are drawn as stubs (crossfloor.js)
    const a = f.nodes.find((n) => n.id === rope.a), b = f.nodes.find((n) => n.id === rope.b);
    if (!a || !b) continue;
    const { start, end, sa, sb } = pinsFor(a, b);
    let sim = sims.get(rope.id);
    if (!sim) {
      sim = newSim(start, end);
      sims.set(rope.id, sim);
      if (!reducedMotion.matches && routing === 'cable') for (let i = 0; i < 40; i++) stepSim(sim, start, end, rope.pin);
    }
    let energy = 0;
    if (routing === 'circuit') {
      sim.circuit = circuitPoints(start, sa, end, sb, rope.pin);
    } else {
      sim.circuit = null;
      energy = stepSim(sim, start, end, rope.pin);
      if (reducedMotion.matches) { for (let i = 0; i < 30; i++) stepSim(sim, start, end, rope.pin); energy = 0; } // settle instantly, no swinging
    }
    renderRope(f, rope, sim);
    if (energy > SLEEP_SPEED || performance.now() < sim.flashUntil + 50) moving = true;
  }
  // drop DOM for deleted ropes (ropes on other floors keep their state)
  const existing = new Set(allFloors().flatMap((fl) => fl.ropes.map((r) => r.id)));
  for (const [id, sim] of sims) {
    if (existing.has(id)) continue;
    sim.dom?.g.remove();
    sims.delete(id);
  }
  drawPreview(f);
  if (typeof drawStubs === 'function') drawStubs(f);
  if (moving || connecting) ropeFrame = requestAnimationFrame(stepRopes);
}

const wakeRopes = () => { if (!ropeFrame) ropeFrame = requestAnimationFrame(stepRopes); };
function drawRopes() { wakeRopes(); } // called whenever nodes move, resize or ropes change

function flashRope(f, aId, bId) {
  const rope = f.ropes.find((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId && !r.rf));
  if (rope?.rf) { flashStub(rope.id); wakeRopes(); return; }
  const sim = rope && sims.get(rope.id);
  if (!sim) return;
  sim.flashUntil = performance.now() + 900;
  wakeRopes();
}

function removeRope(f, id) {
  f.ropes = f.ropes.filter((r) => r.id !== id);
  if (typeof removeRopeEverywhere === 'function') removeRopeEverywhere(id);
  save();
  wakeRopes();
}

// ---------- ties: hold a rope at a point on the canvas ----------
function setRopePin(f, rope, pin) {
  if (pin) rope.pin = { x: Math.round(pin.x), y: Math.round(pin.y) }; else delete rope.pin;
  save();
  wakeRopes();
}

// Dragging a rope (or its tie) ties it where you let go; the tie is only created once the pointer has really moved.
function startPinDrag(f, rope, e, fromLine) {
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY;
  let moved = !fromLine;
  drag((m) => {
    if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
    moved = true;
    rope.pin = worldPoint(f, m);
    wakeRopes();
  });
}

// ---------- connect interaction ----------
function selectedNode(f) {
  return selection.size === 1 ? f.nodes.find((n) => n.id === [...selection][0]) : null;
}

function hint(text) {
  const el = document.getElementById('hint');
  if (!el) return;
  const old = el.dataset.default || (el.dataset.default = el.textContent);
  el.textContent = text || old;
  el.classList.toggle('flash', !!text);
}

function startConnect(f, nodeId) {
  if (connecting) cancelConnect();
  if (!nodeId) { hint('Select a node first, then connect (C)'); setTimeout(() => hint(''), 2500); return; }
  connecting = { floorId: f.id, nodeId, tip: null, hover: null };
  rt.get(f.id).live.get(nodeId)?.el.classList.add('connect-source');
  viewport.classList.add('connecting');
  document.getElementById('link-mode')?.classList.add('active');
  hint('Click another node to connect · Esc to cancel');
  wakeRopes();
}

function cancelConnect() {
  if (!connecting) return;
  const R = rt.get(connecting.floorId);
  R?.live.forEach((e) => e.el.classList.remove('connect-source', 'connect-target'));
  R?.ropesEl.querySelector('.rope-preview')?.remove();
  connecting = null;
  viewport.classList.remove('connecting');
  document.getElementById('link-mode')?.classList.remove('active');
  hint('');
  wakeRopes();
}

function completeConnect(f, target) {
  const from = connecting.nodeId;
  cancelConnect();
  if (target.id === from) return;
  if (f.ropes.some((r) => (r.a === from && r.b === target.id) || (r.a === target.id && r.b === from))) {
    hint('Already connected'); setTimeout(() => hint(''), 1800);
    return;
  }
  f.ropes.push({ id: uid(), a: from, b: target.id });
  save();
  wakeRopes();
}

function drawPreview(f) {
  if (!connecting || connecting.floorId !== f.id) return;
  const R = rt.get(f.id);
  const from = f.nodes.find((n) => n.id === connecting.nodeId);
  let g = R.ropesEl.querySelector('.rope-preview');
  if (!connecting.tip || !from) { g?.remove(); return; }
  if (!g) {
    g = svg('g', { class: 'rope-preview' });
    g.append(svg('path'), svg('circle', { r: 3.5 }));
    R.ropesEl.append(g);
  }
  const start = closest(edgeMidpoints(from), connecting.tip);
  const { x, y } = connecting.tip;
  g.firstChild.setAttribute('d', `M${start.x},${start.y} L${x},${y}`);
  g.lastChild.setAttribute('cx', x);
  g.lastChild.setAttribute('cy', y);
}

function worldPoint(f, e) {
  const r = viewport.getBoundingClientRect(), v = f.view;
  return { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom };
}

viewport.addEventListener('mousemove', (e) => {
  if (!connecting) return;
  const f = activeFloor();
  connecting.tip = worldPoint(f, e);
  const over = e.target.closest?.('.node');
  const R = rt.get(f.id);
  R.live.forEach((en) => en.el.classList.toggle('connect-target', en.el === over && !en.el.classList.contains('connect-source')));
  wakeRopes();
});

// Capture so the click completes (or cancels) the connection before the node or the pan handler sees it.
viewport.addEventListener('mousedown', (e) => {
  if (!connecting || e.button !== 0) return;
  const f = activeFloor();
  e.preventDefault();
  e.stopPropagation();
  const el = e.target.closest?.('.node');
  const target = el && f.nodes.find((n) => rt.get(f.id).live.get(n.id)?.el === el);
  if (target) completeConnect(f, target); else cancelConnect();
}, true);

const isTyping = (t) => t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { cancelConnect(); return; }
  if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target) && !document.getElementById('modal-root').firstChild) {
    const f = activeFloor();
    const n = f && selectedNode(f);
    if (n && !connecting) { e.preventDefault(); startConnect(f, n.id); }
  }
});
