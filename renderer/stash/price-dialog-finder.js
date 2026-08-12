'use strict';
// Find the Set Item Price dialog's quantity field on screen, without calibration.
//
// The dialog is CENTRED and sizes itself to its contents: a tall item icon (a bow) pushes
// the price row down, a long currency name (Perfect Orb of Transmutation) widens the
// dialog and slides the row sideways. So the field is not at a fixed screen position and
// a saved box cannot hold - which is what made calibrated reads fail on some items and
// work on others.
//
// What IS fixed is the selection: the game highlights the quantity the moment the dialog
// opens, painting a solid warm block behind it. Finding that block finds the number.
//
// Measured against real 1920x1080 captures - a two digit price, a single digit, a short
// dialog and a tall one:
//
//   the block          rgb(149,100,57), solid, always 25px tall, width follows the digits
//   everything else    ~1000 blobs of that colour in the game's brown UI, but after
//                      closing they are ragged (fill 0.55-0.85) and never taller than 13
//
// Height plus solidity separates it every time, and on a capture where the field was NOT
// selected it correctly finds nothing rather than reading a stale number.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PriceDialogFinder = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const HL = { r: 149, g: 100, b: 57 };
  const TOL = 30;                 // capture noise, not variation - the value is exact
  const REF_H = 1080;             // the resolution the constants below were measured at
  const BLOCK_H = 25;             // selection block height at REF_H
  const H_TOL = 0.32;             // how far from that a real block may be
  const SOLID = 0.95;             // after closing, the real block is a filled rectangle

  // Where the icon sits relative to the block, in units of the block's own height, so it
  // survives a resolution change.
  //
  // Measured against the block THIS FUNCTION RETURNS, not the raw blob: the returned block
  // is inset by the dilation radius, and deriving the offset from the un-inset bbox put
  // every icon crop several pixels short - which read as a confident 0.26 against the
  // wrong artwork on every capture.
  //
  // Reference: returned block x753 y666 h21, icon centred at (815, 676).
  const ICON = { cx: 2.95, size: 1.5 };

  function mask(rgba, w, h) {
    const on = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (Math.abs(rgba[i] - HL.r) <= TOL
        && Math.abs(rgba[i + 1] - HL.g) <= TOL
        && Math.abs(rgba[i + 2] - HL.b) <= TOL) on[p] = 1;
    }
    return on;
  }

  // Grow then shrink. The digits sit ON the block and punch holes through it; without
  // this a two digit price fragments into crumbs and ranks below a wall texture.
  function dilate(on, w, h, rad) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!on[y * w + x]) continue;
        const y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
        const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) out[yy * w + xx] = 1;
      }
    }
    return out;
  }

  function blobs(on, w, h) {
    const seen = new Uint8Array(w * h);
    const out = [];
    const stack = [];
    for (let i0 = 0; i0 < w * h; i0++) {
      if (!on[i0] || seen[i0]) continue;
      seen[i0] = 1; stack.length = 0; stack.push(i0);
      let x0 = w, x1 = -1, y0 = h, y1 = -1, area = 0;
      while (stack.length) {
        const p = stack.pop();
        const px = p % w, py = (p - px) / w;
        area++;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px > 0 && on[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (px < w - 1 && on[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (py > 0 && on[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
        if (py < h - 1 && on[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
      }
      out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
    }
    return out;
  }

  /**
   * Locate the highlighted quantity on a full-screen frame.
   * @param {Uint8ClampedArray} rgba  full frame
   * @param {number} w @param {number} h  frame size in pixels
   * @param {object} [opts]  { search: 0..1 fraction of the frame around centre to look in }
   * @returns {{block:{x,y,w,h}, icon:{x,y,w,h}, candidates:number}|null}
   */
  function find(rgba, w, h, opts) {
    const o = opts || {};
    // The dialog is always centred, so only the middle of the screen is worth scanning.
    // Cheaper, and it removes most of the brown scenery that shares the colour.
    const fx = o.search || 0.5, fy = o.search || 0.6;
    const rx = Math.round(w * (1 - fx) / 2), ry = Math.round(h * (1 - fy) / 2);
    const rw = Math.round(w * fx), rh = Math.round(h * fy);

    const sub = new Uint8ClampedArray(rw * rh * 4);
    for (let y = 0; y < rh; y++) {
      const src = ((y + ry) * w + rx) * 4;
      sub.set(rgba.subarray(src, src + rw * 4), y * rw * 4);
    }

    const scale = h / REF_H;
    const want = BLOCK_H * scale;
    const rad = Math.max(1, Math.round(2 * scale));
    const closed = dilate(mask(sub, rw, rh), rw, rh, rad);

    const hits = blobs(closed, rw, rh).filter((b) =>
      b.area >= b.w * b.h * SOLID
      && b.h >= want * (1 - H_TOL) && b.h <= want * (1 + H_TOL)
      && b.w >= Math.round(4 * scale) && b.w <= Math.round(240 * scale));
    if (!hits.length) return null;

    // Widest wins: the block's width follows the number, and the impostors that survive
    // height and solidity are narrow slivers of UI trim.
    hits.sort((a, b) => b.w - a.w);
    const b = hits[0];
    // undo the dilation's outward growth, and put it back in full-frame coordinates
    const block = { x: b.x + rx + rad, y: b.y + ry + rad, w: Math.max(1, b.w - rad * 2), h: Math.max(1, b.h - rad * 2) };
    // Centred on the icon and deliberately generous: the matcher trims the capture to the
    // artwork itself, so extra background costs nothing while clipping the orb costs the
    // match.
    const size = Math.round(ICON.size * block.h);
    const icon = {
      x: Math.round(block.x + ICON.cx * block.h - size / 2),
      y: Math.round(block.y + block.h / 2 - size / 2),
      w: size,
      h: size,
    };
    return { block, icon, candidates: hits.length };
  }

  return { find, HL, BLOCK_H, REF_H, ICON };
});
