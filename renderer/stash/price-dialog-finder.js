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
  // Swept against every real capture at once - 1080p fullscreen, a 1600x1200 window and a
  // 1440x900 window pushed off centre - by dev/tune-icon-geometry.js. cx 2.95 passes all
  // five at sizes 1.0 through 1.2, so 1.1 sits in the middle of a stable plateau rather
  // than on an edge. A bigger box starts clipping the dropdown's frame, whose bright trim
  // then defeats the trim step that isolates the artwork; tuning against one capture alone
  // produced 1.5, which was correct at 1080p and wrong in a window.
  const ICON = { cx: 2.95, size: 1.1 };

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

  // Find the icon by looking for it, rather than by stepping a fixed distance.
  //
  // The distance from the block to the icon was fitted as a ratio of the block's height,
  // twice, and missed at a block height between the ones it was fitted at - clipping the
  // orb, which then matched the wrong currency. The layout is evidently not a clean
  // multiple of that one number.
  //
  // What the row actually looks like, scanning right from the block: the field's border
  // (a column or two), a gap, the icon (a solid run about 0.75 block-heights wide), a gap,
  // then the currency name. So walk the columns, skip anything too narrow to be artwork,
  // and take the first run wide enough to be the icon - stopping before the text, which is
  // what the width ceiling is for.
  function locateIcon(rgba, w, h, block) {
    const H = block.h;
    const cy = block.y + H / 2;
    const y0 = Math.max(0, Math.round(cy - H * 0.75));
    const y1 = Math.min(h - 1, Math.round(cy + H * 0.75));
    const xa = Math.min(w - 1, Math.round(block.x + block.w + H * 0.15));
    const xb = Math.min(w - 1, Math.round(block.x + H * 5));
    if (xb <= xa || y1 <= y0) return null;

    const lit = [];
    for (let x = xa; x <= xb; x++) {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        const p = (y * w + x) * 4;
        if (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2] > 60) n++;
      }
      // A column counts as artwork only if a real fraction of it is lit. At two pixels the
      // faint speckle either side of the icon joined everything into one run far too wide
      // to be a glyph, so the scan fell through to whatever came next.
      lit.push(n >= Math.max(3, Math.round(H * 0.22)) ? 1 : 0);
    }

    const minRun = Math.max(4, Math.round(H * 0.45));
    const maxRun = Math.max(minRun + 2, Math.round(H * 1.35));
    let i = 0;
    while (i < lit.length) {
      if (!lit[i]) { i++; continue; }
      let j = i;
      while (j + 1 < lit.length && lit[j + 1]) j++;
      const run = j - i + 1;
      if (run >= minRun && run <= maxRun) {
        const bx0 = xa + i, bx1 = xa + j;
        // SQUARE, from the horizontal run only.
        //
        // Measuring the vertical extent the same way looked obvious and was wrong: within
        // the icon's columns there is also the dropdown's top and bottom edge, so the box
        // came out 24 tall around a 14px orb. Stretching that to a square template wrecked
        // the match. The artwork is square and centred on the row, so its width is the
        // honest measure of its size.
        const pad = 1;
        const size = (bx1 - bx0 + 1) + pad * 2;
        const cxm = (bx0 + bx1) / 2;
        const x = Math.max(0, Math.round(cxm - size / 2));
        const y = Math.max(0, Math.round(cy - size / 2));
        return {
          x, y,
          w: Math.min(w - x, size),
          h: Math.min(h - y, size),
        };
      }
      i = j + 1;
    }
    return null;
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
    // Look in the middle first, then at everything. The dialog is centred on the GAME
    // WINDOW, not the screen - in a window pushed to one side it is nowhere near the
    // middle - but the centre is where it is for most people, it is a quarter of the
    // pixels, and it excludes most of the brown scenery that shares the colour. Paying
    // for the full frame only when the cheap look finds nothing gets both.
    if (!o.search) {
      return scan(rgba, w, h, 0.5, 0.6, o) || scan(rgba, w, h, 1, 1, o);
    }
    return scan(rgba, w, h, o.search, o.search, o);
  }

  function scan(rgba, w, h, fxIn, fyIn, o) {
    const fx = fxIn, fy = fyIn;
    const rx = Math.round(w * (1 - fx) / 2), ry = Math.round(h * (1 - fy) / 2);
    const rw = Math.round(w * fx), rh = Math.round(h * fy);

    const sub = new Uint8ClampedArray(rw * rh * 4);
    for (let y = 0; y < rh; y++) {
      const src = ((y + ry) * w + rx) * 4;
      sub.set(rgba.subarray(src, src + rw * 4), y * rw * 4);
    }

    // Scale against the SCREEN height, not the frame handed in. The caller may already
    // have cropped to the middle of the display to save work, and sizing a 25px block
    // against a 60%-tall crop would look for a block 40% too small.
    const scale = (o.screenH || h) / REF_H;
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
    // A STRIP the icon is somewhere inside, not a box the icon is assumed to fill.
    //
    // A single box positioned by a fixed ratio was tuned at two block heights and missed
    // at a third: at h20 it clipped the orb's right edge and left dead space on the left,
    // and the clipped shape matched Mirror of Kalandra at 0.42 with Divine third. Wrong,
    // and confident. Handing the matcher a strip and letting it find the icon inside is
    // the same answer the digits needed - search, do not assume.
    // MEASURED, not guessed. dev/measure-icon-offset.js reads the icon's actual extent
    // off every capture: it runs from 2.68 to 3.37 block-heights right of the block's left
    // edge, and the currency NAME starts at about 3.68. So the usable window is narrow, and
    // the two previous attempts failed at its edges - a box sized 1.1 clipped the orb at a
    // block height it had not been tuned at, and a wide sliding strip ran into the text.
    const H = block.h;
    // Confirmed twice over: measurement puts the icon at 2.68-3.37 block-heights wide
    // 0.74, and sweeping every capture independently lands on the same place. A box only
    // a little wider than the icon beats a generous one here, because the artwork it is
    // compared against is trimmed to the orb - extra background is not neutral, it is
    // noise. Weakest match across 11 captures went 0.44 -> 0.55 on this change alone.
    const cx = 3.00, size = 0.82;   // centre and width, in block-heights
    const sw = Math.round(size * H);
    const strip = {
      x: Math.max(0, Math.round(block.x + cx * H - sw / 2)),
      y: Math.max(0, Math.round(block.y + H / 2 - sw / 2)),
      w: sw,
      h: sw,
    };
    // Offer BOTH the fitted box and the located one, and let the matcher decide.
    //
    // Neither wins everywhere. The fitted box - a ratio of the block height - reads every
    // stored capture, and missed a live block height that fell between the ones it was
    // fitted at. Scanning for the artwork handles that one and reads the windowed captures
    // better, but does worse at 1080p fullscreen, where the run it finds is a little off.
    //
    // Picking one on the evidence available would just be choosing which case to break.
    // Scoring both against the templates costs one more comparison and the answer that
    // actually matches the artwork wins.
    const found = locateIcon(sub, rw, rh, { x: block.x - rx, y: block.y - ry, w: block.w, h: block.h });
    const icon = strip;
    const iconAlt = found ? { x: found.x + rx, y: found.y + ry, w: found.w, h: found.h } : null;
    return { block, icon, iconAlt, strip: icon, located: !!found, candidates: hits.length };
  }

  return { find, HL, BLOCK_H, REF_H, ICON };
});
