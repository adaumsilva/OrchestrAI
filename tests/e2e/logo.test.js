// The app logo (also the tray and installer icon) is drawn in code: a ring cut into three arcs around a solid centre disc.
const { makeIcon } = require('../../src/services/tray');
module.exports = async (t) => {
  const N = 128, img = makeIcon(N), bmp = img.toBitmap(); // BGRA
  const at = (ang, rad) => { const a = ang * Math.PI / 180, ux = 50 + rad * Math.cos(a), uy = 50 - rad * Math.sin(a); // ang: 90 = up
    const o = (Math.round(uy / 100 * (N - 1)) * N + Math.round(ux / 100 * (N - 1))) * 4; return { b: bmp[o], g: bmp[o + 1], r: bmp[o + 2], a: bmp[o + 3] }; };
  const solid = (p) => p.a === 255 && p.b > 240 && p.r < 30;
  t.check('it is the requested size', img.getSize().width === N && img.getSize().height === N, img.getSize());
  t.check('the centre disc is solid blue', solid(at(0, 0)) && solid(at(45, 12)), at(0, 0));
  t.check('the gap between disc and ring is transparent', at(0, 23).a === 0 && at(200, 23).a === 0, at(0, 23));
  t.check('the ring arcs are solid blue', solid(at(30, 40)) && solid(at(150, 40)) && solid(at(270, 40)), [at(30, 40), at(150, 40), at(270, 40)]);
  t.check('the ring is cut at the top, lower right and lower left', at(90, 40).a === 0 && at(330, 40).a === 0 && at(210, 40).a === 0, [at(90, 40), at(330, 40), at(210, 40)]);
  t.check('the corners are transparent', at(45, 70).a === 0 && at(225, 70).a === 0);
};
