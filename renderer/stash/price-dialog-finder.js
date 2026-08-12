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

  // The BOX the highlight sits in, found by scanning outward from it for the field's
  // border.
  //
  // This is the piece that was missing all along, and it does two jobs at once.
  //
  // It VERIFIES. A price field is a bordered box containing a highlight; a lump of brown
  // scenery is not. Colour alone could never tell those apart, which is why the old finder
  // kept accumulating qualifiers and still read 1081 off the ground on an item priced 7.
  //
  // And it ANCHORS. Every attempt to place the currency icon by multiplying the highlight's
  // height failed, because that height is a small integer - 19, 20, 21 - and the icon is
  // three of them away, so a pixel of measurement error became three at the target. The
  // box's right edge is an actual edge, found not derived, and the icon is measured from
  // there.
  //
  // Across every capture the box comes out at aspect 1.47-1.54 and the next border a
  // consistent 0.61 box-heights beyond it, at both screen scales.
  const BOX_ASPECT_LO = 1.15, BOX_ASPECT_HI = 2.05;
  // The highlight is a known fraction of the field it sits in - measured 0.656 to 0.679
  // across every capture, at both screen scales. Scenery has no such relationship, and
  // aspect alone was not enough: scanning outward through busy ground always finds SOME
  // pair of bright lines, and often enough they land in the aspect range by luck.
  const FILL_LO = 0.56, FILL_HI = 0.80;
  // And the field is a near-black box. Ground lit by daylight is not.
  const DARK_LUMA = 45, DARK_FRAC = 0.25;

  function fieldBox(rgba, w, h, block) {
    const lum = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      const p = (y * w + x) * 4;
      return 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    };
    const cy = Math.round(block.y + block.h / 2);
    const half = Math.round(block.h * 0.4);

    // A border is a CONTINUOUS bright line, so test a stretch of it rather than one pixel.
    const colIsBorder = (x) => {
      if (x < 0 || x >= w) return false;
      let n = 0;
      for (let y = cy - half; y <= cy + half; y++) if (lum(x, y) > 85) n++;
      return n >= (half * 2 + 1) * 0.75;
    };
    const rowIsBorder = (y) => {
      if (y < 0 || y >= h) return false;
      let n = 0;
      for (let x = block.x; x <= block.x + block.w; x++) if (lum(x, y) > 85) n++;
      return n >= block.w * 0.8;
    };

    let left = null, right = null, top = null, bottom = null;
    for (let d = 2; d < block.h * 4; d++) if (colIsBorder(block.x - d)) { left = block.x - d; break; }
    for (let d = 2; d < block.h * 6; d++) if (colIsBorder(block.x + block.w + d)) { right = block.x + block.w + d; break; }
    for (let d = 2; d < block.h * 2; d++) if (rowIsBorder(block.y - d)) { top = block.y - d; break; }
    for (let d = 2; d < block.h * 2; d++) if (rowIsBorder(block.y + block.h + d)) { bottom = block.y + block.h + d; break; }
    if (left == null || right == null || top == null || bottom == null) return null;

    const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    const aspect = box.w / box.h;
    if (aspect < BOX_ASPECT_LO || aspect > BOX_ASPECT_HI) return null;

    // the highlight has to be the right size for the box it claims to be inside
    const fill = block.h / box.h;
    if (fill < FILL_LO || fill > FILL_HI) return null;

    // and the box has to be mostly empty and dark, the way an input field is
    let dark = 0, n = 0;
    for (let y = box.y + 2; y < box.y + box.h - 2; y += 2) {
      for (let x = box.x + 2; x < box.x + box.w - 2; x += 2) {
        if (lum(x, y) < DARK_LUMA) dark++;
        n++;
      }
    }
    if (!n || dark / n < DARK_FRAC) return null;

    return box;
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
  function locateIcon(rgba, w, h, block, box) {
    // Scan from the FIELD BOX's right edge when we have it. The highlight's own right edge
    // moves with the number - five pixels for "1", thirty-four for "12345" - so starting
    // there meant starting somewhere different on every item.
    const H = box ? box.h : block.h;
    const cy = box ? box.y + box.h / 2 : block.y + block.h / 2;
    const from = box ? box.x + box.w : block.x + block.w;
    const y0 = Math.max(0, Math.round(cy - H * 0.6));
    const y1 = Math.min(h - 1, Math.round(cy + H * 0.6));
    const xa = Math.min(w - 1, Math.round(from + H * 0.15));
    const xb = Math.min(w - 1, Math.round(from + H * 4));
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
  // Find the price field, then everything else from it.
  //
  // The order used to be backwards: hunt the selection highlight's colour across a large
  // region, then try to prove the thing found was a price field. In a game built out of
  // brown that produced false positive after false positive, each one patched with another
  // qualifier.
  //
  // Now the BOX comes first - a complete rectangle in one exact border colour, nearest to
  // where the dialog puts it. Everything else is inside it or a fixed step from it, and
  // colour matching is safe once it is confined to a verified box.
  function find(rgba, w, h, opts) {
    const o = opts || {};
    const rowFinder = (typeof require === 'function')
      ? require('./price-row-finder.js')
      : (typeof self !== 'undefined' ? self.PriceRowFinder : null);
    if (!rowFinder) return null;

    const found = rowFinder.find(rgba, w, h, o.win);
    if (!found) return null;
    const box = found.quantity;

    // The highlight, looked for ONLY inside the box. This says the field is selected, and
    // gives the digits' extent; the surrounding screen cannot interfere because the search
    // never leaves the box.
    const block = highlightIn(rgba, w, h, box);

    // The icon sits a short, fixed step right of the box - scanned for rather than stepped
    // to, because the step is small and the box edge is exact.
    const icon = locateIcon(rgba, w, h, block || box, box);

    // No highlight means the field is not selected, which means the dialog is not ready -
    // it is highlighted the instant it opens. Reading an unselected field would report a
    // number nobody is about to change.
    if (!block) return null;

    return {
      field: box,
      block,
      selected: true,
      icon: icon || fallbackIcon(box),
      iconAlt: icon ? fallbackIcon(box) : null,
      verified: true,
      candidates: 1,
    };
  }

  // Largest run of highlight-coloured pixels inside the box.
  function highlightIn(rgba, w, h, box) {
    const x0 = Math.max(0, box.x + 1), x1 = Math.min(w - 1, box.x + box.w - 2);
    const y0 = Math.max(0, box.y + 1), y1 = Math.min(h - 1, box.y + box.h - 2);
    let bx0 = x1, bx1 = x0, by0 = y1, by1 = y0, n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = (y * w + x) * 4;
        if (Math.abs(rgba[p] - HL.r) <= TOL && Math.abs(rgba[p + 1] - HL.g) <= TOL
          && Math.abs(rgba[p + 2] - HL.b) <= TOL) {
          n++;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
          if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
      }
    }
    if (n < 20 || bx1 < bx0 || by1 < by0) return null;
    return { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
  }

  // Where the icon is, measured from the box's right edge across every capture:
  //
  //   starts   0.50 - 0.55 box-heights past it
  //   width    0.38 - 0.43 box-heights
  //
  // A ratio is trustworthy here in a way it never was before, because it is taken from the
  // box's exact edge rather than from the highlight's height - a small integer that got
  // multiplied by three and turned one pixel of error into three.
  function fallbackIcon(box) {
    const H = box.h;
    const size = Math.round(H * 0.58);          // a little wider than the orb, for margin
    const cx = box.x + box.w + H * 0.72;        // centre of the measured run
    return {
      x: Math.round(cx - size / 2),
      y: Math.round(box.y + box.h / 2 - size / 2),
      w: size, h: size,
    };
  }

  return { find, HL, BLOCK_H, REF_H, ICON };
});
