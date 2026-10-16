// System tray icon. The icon is generated in code (a blue disc with a ring) so no asset file is needed.
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

function makeIcon(size = 32) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const edge = Math.min(1, Math.max(0, size / 2 - 1 - d + 0.5)); // anti-aliased outer edge
      const ring = d > size * 0.22 && d < size * 0.34;
      const [r, g, b] = ring ? [255, 255, 255] : [10, 132, 255];
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(edge * 255);
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

module.exports = { setup, makeIcon };
