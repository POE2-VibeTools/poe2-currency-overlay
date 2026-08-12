'use strict';
// Find the price field by its BORDER: a complete bright rectangle drawn in one exact
// colour, with a dark interior, sitting where the dialog puts it.
//
// The border is rgb(182,169,138) - measured, and identical on every capture. That is a
// far harder thing to fake than "a brownish blob", which is what the old finder looked for
// and what the terrain kept supplying. An earlier attempt at this same idea failed because
// it tested "brighter than 52" instead of the actual colour, which most of a sunlit
// hillside satisfies.
//
// A rectangle means all four sides: a top run, a bottom run the same width, and both
// verticals joining them. Dirt does not do that.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PriceRowFinder = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // The exact border colour. Tolerance is for capture noise and the compositor, not for
  // variation - every sample of it reads the same.
  const BORDER = { r: 182, g: 169, b: 138 };
  // Tight. The border is drawn flat - every sample of it reads 182,169,138 exactly - so
  // this is for capture noise and nothing else. At 46 it accepted r 136-228, g 123-215,
  // b 92-184, which is most of a dirt floor, and the floor duly matched.
  const TOL = 16;

  // Where the row lives, as a fraction of the game window: measured at x 0.28-0.41 and
  // y 0.57-0.80, then widened, because a long currency name pushes the field left and a
  // tall item icon pushes the row down.
  const BAND = { x0: 0.20, x1: 0.54, y0: 0.44, y1: 0.90 };

  const MIN_W = 18, MAX_W = 140;     // the quantity box, in pixels
  const MIN_H = 12, MAX_H = 64;
  // Every real field measures 1.47 to 1.54 wide-to-tall - 42x28, 43x28, 47x31, 47x32 - so
  // this can be tight. At 1.05 a 19x18 scrap of UI qualified and, being nearer the centre,
  // won.
  const ASPECT_LO = 1.28, ASPECT_HI = 1.85;
  const SIDE_FRAC = 0.6;             // how much of each vertical side must be border
  // Mean luma inside. Generous, because a field holding a long price is mostly SELECTION
  // HIGHLIGHT rather than empty black - "12345" filled it and the box was rejected for not
  // being dark enough. The rectangle itself is the real test; this only rules out a bright
  // panel that happens to have a border-coloured outline.
  const DARK_INSIDE = 165;

  function isBorder(rgba, p) {
    return Math.abs(rgba[p] - BORDER.r) <= TOL
      && Math.abs(rgba[p + 1] - BORDER.g) <= TOL
      && Math.abs(rgba[p + 2] - BORDER.b) <= TOL;
  }

  /**
   * @param {Uint8ClampedArray} rgba  full frame
   * @param {number} w @param {number} h
   * @param {{x,y,w,h}} win  the game window inside that frame
   * @returns {{quantity, row, boxes}|null}
   */
  function find(rgba, w, h, win) {
    const g = win && win.w > 0 ? win : { x: 0, y: 0, w, h };
    const bx0 = Math.max(1, Math.round(g.x + g.w * BAND.x0));
    const bx1 = Math.min(w - 2, Math.round(g.x + g.w * BAND.x1));
    const by0 = Math.max(1, Math.round(g.y + g.h * BAND.y0));
    const by1 = Math.min(h - 2, Math.round(g.y + g.h * BAND.y1));
    if (bx1 - bx0 < 40 || by1 - by0 < 24) return null;

    // border mask over the band only
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const M = new Uint8Array(bw * bh);
    const L = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const p = ((y + by0) * w + (x + bx0)) * 4;
        M[y * bw + x] = isBorder(rgba, p) ? 1 : 0;
        L[y * bw + x] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      }
    }

    // horizontal runs of border colour, long enough to be a box's top or bottom
    const rows = [];
    for (let y = 0; y < bh; y++) {
      let start = -1;
      const list = [];
      for (let x = 0; x <= bw; x++) {
        const on = x < bw && M[y * bw + x];
        if (on && start < 0) start = x;
        else if (!on && start >= 0) {
          const len = x - start;
          if (len >= MIN_W && len <= MAX_W) list.push({ x0: start, x1: x - 1 });
          start = -1;
        }
      }
      rows.push(list);
    }

    const cx = (g.x + g.w / 2) - bx0;
    const cy = (g.y + g.h / 2) - by0;
    let best = null;

    for (let y = 0; y < bh; y++) {
      for (const top of rows[y]) {
        for (let dy = MIN_H; dy <= MAX_H && y + dy < bh; dy++) {
          // a bottom edge of the same extent
          const match = rows[y + dy].find((r) => Math.abs(r.x0 - top.x0) <= 2 && Math.abs(r.x1 - top.x1) <= 2);
          if (!match) continue;

          const boxW = top.x1 - top.x0 + 1, boxH = dy + 1;
          const aspect = boxW / boxH;
          if (aspect < ASPECT_LO || aspect > ASPECT_HI) continue;

          // BOTH verticals, or it is two unrelated lines rather than a rectangle
          let lc = 0, rc = 0;
          for (let yy = y; yy <= y + dy; yy++) {
            if (M[yy * bw + top.x0]) lc++;
            if (M[yy * bw + top.x1]) rc++;
          }
          if (lc < boxH * SIDE_FRAC || rc < boxH * SIDE_FRAC) continue;

          // and it is an input box: dark inside
          let s = 0, n = 0;
          for (let yy = y + 3; yy < y + dy - 2; yy += 2) {
            for (let xx = top.x0 + 3; xx < top.x1 - 2; xx += 2) { s += L[yy * bw + xx]; n++; }
          }
          if (!n || s / n > DARK_INSIDE) continue;

          // Nearest to where the dialog puts it wins - never biggest. Size ranking is what
          // made every previous version pick the merchant panel.
          const d = Math.hypot((top.x0 + boxW / 2) - cx, y - cy);
          if (!best || d < best.d) {
            best = { d, box: { x: top.x0 + bx0, y: y + by0, w: boxW, h: boxH } };
          }
        }
      }
    }
    if (!best) return null;
    return { quantity: best.box, row: best.box, boxes: [best.box] };
  }

  return { find, BAND, BORDER };
});
