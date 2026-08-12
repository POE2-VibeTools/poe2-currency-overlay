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

    // Rectangles to ignore, in full-frame pixels. The app's own reprice badge is on
    // screen, always on top, and amber - so the capture contains it, and once it started
    // holding the last result permanently it also contained DIGITS. Its block is wider
    // than a real price highlight, and widest wins, so the reader began reading its own
    // output back to itself.
    const skip = Array.isArray(o.exclude) ? o.exclude : [];
    const excluded = (b) => {
      const cx2 = b.x + rx + b.w / 2, cy2 = b.y + ry + b.h / 2;
      return skip.some((r) => cx2 >= r.x && cx2 <= r.x + r.w && cy2 >= r.y && cy2 <= r.y + r.h);
    };

    const hits = blobs(closed, rw, rh).filter((b) =>
      b.area >= b.w * b.h * SOLID
      && b.h >= want * (1 - H_TOL) && b.h <= want * (1 + H_TOL)
      && b.w >= Math.round(4 * scale) && b.w <= Math.round(240 * scale)
      && !excluded(b));
    if (!hits.length) return null;

    // Rank by how close the height is to a real selection block, and only then by width.
    //
    // Widest-wins was wrong, and single-digit prices are where it showed. A price of 7 has
    // a block about ten pixels across, so ANY wider impostor beat it - and a solid patch of
    // brown scenery 41 wide by 25 tall duly did, on a screen where the real block is 21.
    // Height is what identifies this thing; width is just however long the number is.
    hits.sort((a, b) => {
      const da = Math.abs(a.h - want), db = Math.abs(b.h - want);
      if (da !== db) return da - db;
      return b.w - a.w;
    });
    // Take the first candidate that is actually inside a price field.
    //
    // This is the check the finder never had. Ranking only ever reordered guesses; nothing
    // asked whether the thing found was a price field at all, so a solid patch of ground
    // the right colour and roughly the right height sailed through and was read as a
    // number. A field has a bordered box around it with a consistent aspect. Scenery does
    // not, and no amount of ranking substitutes for asking.
    let b = null, boxLocal = null;
    for (const cand of hits.slice(0, 6)) {
      const probe = { x: cand.x + rad, y: cand.y + rad, w: Math.max(1, cand.w - rad * 2), h: Math.max(1, cand.h - rad * 2) };
      const bx = fieldBox(sub, rw, rh, probe);
      if (bx) { b = cand; boxLocal = bx; break; }
    }
    // Nothing verified. Fall back to the best-ranked candidate rather than refusing
    // outright - a dialog drawn in some way this has not seen should still be readable,
    // and the digit reader is the second opinion.
    if (!b) b = hits[0];
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
    const local = { x: block.x - rx, y: block.y - ry, w: block.w, h: block.h };
    const box = boxLocal || fieldBox(sub, rw, rh, local);
    const found = locateIcon(sub, rw, rh, local, box);
    const icon = strip;
    const iconAlt = found ? { x: found.x + rx, y: found.y + ry, w: found.w, h: found.h } : null;
    const field = box ? { x: box.x + rx, y: box.y + ry, w: box.w, h: box.h } : null;
    return { block, icon, iconAlt, field, verified: !!boxLocal, strip: icon, located: !!found, candidates: hits.length };
  }

  return { find, HL, BLOCK_H, REF_H, ICON };
});
