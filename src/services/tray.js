// System tray icon. The icon is generated in code (the OrchestrAI logo, drawn pixel by pixel) so no asset file is needed.
const { Tray, Menu, nativeImage, app } = require('electron');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// The logo: a ring cut into three arcs around a solid centre disc, in the accent blue on a transparent background.
// Geometry is in a 100x100 box and mirrors docs/images/logo.svg. Rendered with 4x4 supersampling so edges stay smooth.
const LOGO = {
  outer: 48, inner: 29.1, disc: 17, gap: 7.6, color: [10, 132, 255],
  cuts: [[0, -1], [Math.sqrt(3) / 2, 0.5], [-Math.sqrt(3) / 2, 0.5]], // the three gaps: up, lower right, lower left
};

function inLogo(x, y) {
  const L = LOGO, px = x - 50, py = y - 50, r = Math.hypot(px, py);
  if (r <= L.disc) return true;
  if (r < L.inner || r > L.outer) return false;
  return !L.cuts.some(([dx, dy]) => px * dx + py * dy > 0 && Math.abs(px * dy - py * dx) < L.gap / 2);
}

function makeIcon(size = 32) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4, L = LOGO;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let on = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (inLogo((x + (sx + 0.5) / SS) * 100 / size, (y + (sy + 0.5) / SS) * 100 / size)) on++;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = L.color[0]; raw[o + 1] = L.color[1]; raw[o + 2] = L.color[2];
      raw[o + 3] = Math.round(on / (SS * SS) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

let tray = null;

function setup(getWin) {
  const show = () => {
    const w = getWin();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  };
  tray = new Tray(makeIcon(32).resize({ width: 16, height: 16 }));
  tray.setToolTip('OrchestrAI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show OrchestrAI', click: show },
    { label: 'Hide', click: () => getWin()?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => {
    const w = getWin();
    if (w?.isVisible() && w.isFocused()) w.hide(); else show();
  });
}

// Shows how many terminals need attention in the tray tooltip (and the taskbar badge where supported).
function setAttention(count) {
  const n = Math.max(0, Number(count) || 0);
  tray?.setToolTip(n ? `OrchestrAI — ${n} terminal${n === 1 ? '' : 's'} need attention` : 'OrchestrAI');
  try { app.setBadgeCount(n); } catch {}
}

module.exports = { setup, makeIcon, setAttention };
