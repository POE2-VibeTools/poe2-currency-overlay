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

  // The dialog's colours come in (at least) two BRIGHTNESS PROFILES, and it is not a
  // single gain: at 2560x1440 with 100% display scaling (first real user submission)
  // the border renders 255,255,212 against the usual 182,169,138 (x1.4, clipped) while
  // the panel behind it doubles (85,75,60 vs 44,38,30). Every colour gate is therefore
  // parameterised and the finder tries each profile in turn - the structural gates
  // (rectangle, dark interior, flat surround) are what actually reject scenery, and
  // they are shared.
  const PROFILES = [
    {
      // the reference profile: every capture from the dev machines
      border: { r: 182, g: 169, b: 138 },
      // Tight-ish: the border is drawn flat, but LIVE frames arrive through a
      // getDisplayMedia video stream whose chroma subsampling washes the colour -
      // measured drift up to 18 on blue. The rectangle gates carry the rest.
      tol: 20,
      // the scaled-hue path (windowed games render the border dimmer, hue intact)
      hueRatio: true,
      surround: { r: 44, g: 38, b: 30 },
      surroundTol: 26,
      surroundSd: 24,
    },
    {
      // The brightness-boosted profile. Users run gamma/vibrance/contrast filters
      // (NVIDIA overlays and the like), so this one matches by CHROMA - the colour
      // proportions, which those filters preserve - rather than by absolutes, which
      // would bake one submitter's video settings. Grounded on the first community
      // submission (border 255,255,212, panel 85,75,60: within 2% of the reference
      // proportions at ~1.4-2x the brightness). Runs ONLY when the reference profile
      // finds nothing, so it cannot disturb any known-good setup.
      chroma: true,
      // border: reference proportions of 182,169,138; only ABOVE reference brightness
      // (boosted setups) - the dim regime belongs to profile 1's hue-ratio path
      borderChroma: { r: 0.3724, g: 0.3456, b: 0.2823 },
      borderChromaTol: { r: 0.035, g: 0.020, b: 0.030 },
      borderSumMin: 420,
      // panel: reference proportions of 44,38,30, flat relative to its own brightness
      surroundChroma: { r: 0.3929, g: 0.3393, b: 0.2679 },
      surroundChromaTol: 0.03,
      surroundLumaLo: 30, surroundLumaHi: 150,
    },
  ];

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

  // The surround (what sits BEHIND the box) is part of each profile: the dialog is a
  // flat panel, and terrain has the colour sometimes but never the flatness.
  function isBorder(rgba, p, prof) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    if (prof.chroma) {
      const sum = r + g + b;
      if (sum < prof.borderSumMin) return false;
      const nr = r / sum, ng = g / sum, nb = b / sum;
      return Math.abs(nr - prof.borderChroma.r) <= prof.borderChromaTol.r
        && Math.abs(ng - prof.borderChroma.g) <= prof.borderChromaTol.g
        && Math.abs(nb - prof.borderChroma.b) <= prof.borderChromaTol.b;
    }
    const B = prof.border;
    // The direct match, tol-wide for video chroma smear (which shifts hue, so the
    // ratio test below does NOT cover it).
    if (Math.abs(r - B.r) <= prof.tol
      && Math.abs(g - B.g) <= prof.tol
      && Math.abs(b - B.b) <= prof.tol) return true;
    if (!prof.hueRatio) return false;
    // The scaled match. A windowed game (1920x1039 under a taskbar, say) renders its UI
    // slightly shrunk, and the 1px border resamples across two rows at reduced
    // intensity - measured rgb(96,87,71) and rgb(114,105,85) for the same border that
    // reads 182,169,138 at native size. Brightness is lost but the HUE survives, so
    // accept any pixel that is the border colour times a constant: per-channel ratios
    // to the reference must agree. The selection orange and the digits' near-white fail
    // the agreement; some terrain browns pass, and the rectangle, dark-interior and
    // flat-panel gates remain what actually rejects scenery.
    const kr = r / B.r, kg = g / B.g, kb = b / B.b;
    const k = (kr + kg + kb) / 3;
    if (k < 0.42 || k > 1.15) return false;
    return Math.abs(kr - kg) <= 0.07 && Math.abs(kr - kb) <= 0.11 && Math.abs(kg - kb) <= 0.09;
  }

  // Is the box sitting on the dialog's panel? Sampled as a ring a few pixels outside it,
  // which is panel on all four sides for a real field.
  function onPanel(rgba, w, h, b, prof) {
    let n = 0;
    let sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0;
    const take = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = (y * w + x) * 4;
      const r = rgba[p], g = rgba[p + 1], bl = rgba[p + 2];
      sr += r; sg += g; sb += bl;
      qr += r * r; qg += g * g; qb += bl * bl;
      n++;
    };
    for (let d = 3; d <= 7; d++) {
      for (let x = b.x - d; x <= b.x + b.w + d; x += 2) { take(x, b.y - d); take(x, b.y + b.h + d); }
    }
    if (n < 40) return false;
    const mr = sr / n, mg = sg / n, mb = sb / n;
    if (prof.chroma) {
      // same proportions as the reference panel, any boosted brightness, still FLAT
      // relative to how bright it renders
      const meanL = 0.299 * mr + 0.587 * mg + 0.114 * mb;
      if (meanL < prof.surroundLumaLo || meanL > prof.surroundLumaHi) return false;
      const sum = mr + mg + mb;
      if (!(sum > 0)) return false;
      if (Math.abs(mr / sum - prof.surroundChroma.r) > prof.surroundChromaTol
        || Math.abs(mg / sum - prof.surroundChroma.g) > prof.surroundChromaTol
        || Math.abs(mb / sum - prof.surroundChroma.b) > prof.surroundChromaTol) return false;
      const sdc = (q, m) => Math.sqrt(Math.max(0, q / n - m * m));
      const lim = Math.max(24, 0.35 * meanL);
      return sdc(qr, mr) <= lim && sdc(qg, mg) <= lim && sdc(qb, mb) <= lim;
    }
    if (Math.abs(mr - prof.surround.r) > prof.surroundTol
      || Math.abs(mg - prof.surround.g) > prof.surroundTol
      || Math.abs(mb - prof.surround.b) > prof.surroundTol) return false;
    const sd = (q, m) => Math.sqrt(Math.max(0, q / n - m * m));
    return sd(qr, mr) <= prof.surroundSd && sd(qg, mg) <= prof.surroundSd && sd(qb, mb) <= prof.surroundSd;
  }

  /**
   * @param {Uint8ClampedArray} rgba  full frame
   * @param {number} w @param {number} h
   * @param {{x,y,w,h}} win  the game window inside that frame
   * @returns {{quantity, row, boxes}|null}
   */
  function findWithProfile(rgba, w, h, win, prof) {
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
        M[y * bw + x] = isBorder(rgba, p, prof) ? 1 : 0;
        L[y * bw + x] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      }
    }

    // Horizontal runs of border colour, long enough to be a box's top or bottom.
    //
    // A pixel counts for row y if it is border on y OR an adjacent row - the same grace
    // the verticals get, and for the same reason. At 150% scaling the border is 1.5
    // physical pixels and wanders between two rows, and in a live video frame the chroma
    // smear pushes parts of it over the line: a 60px edge that is plainly there ends up as
    // fragments on any one exact row, and the whole display read as "no dialog" while
    // clean screenshot captures of the same scene passed.
    const rows = [];
    for (let y = 0; y < bh; y++) {
      let start = -1;
      const list = [];
      for (let x = 0; x <= bw; x++) {
        const on = x < bw && (M[y * bw + x]
          || (y > 0 && M[(y - 1) * bw + x])
          || (y < bh - 1 && M[(y + 1) * bw + x]));
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

          // The runs above were found with a row of grace, so the run's own y may be one
          // off the border's real row. Snap each edge to whichever adjacent row holds the
          // most raw border pixels - the box must come out at the same coordinates
          // whether the frame is a clean screenshot or a smeared video frame, because the
          // icon is measured from its edges.
          const snap = (yy) => {
            let bestY = yy, bestN = -1;
            for (let c = yy - 1; c <= yy + 1; c++) {
              if (c < 0 || c >= bh) continue;
              let cnt = 0;
              for (let x = top.x0; x <= top.x1; x++) cnt += M[c * bw + x];
              if (cnt > bestN) { bestN = cnt; bestY = c; }
            }
            return bestY;
          };
          const ty = snap(y), by = snap(y + dy);
          if (by - ty + 1 < MIN_H) continue;

          const boxW = top.x1 - top.x0 + 1, boxH = by - ty + 1;
          const aspect = boxW / boxH;
          if (aspect < ASPECT_LO || aspect > ASPECT_HI) continue;

          // BOTH verticals, or it is two unrelated lines rather than a rectangle.
          //
          // Tested across a pixel either side, not on one exact column. The side is a
          // single pixel wide and does not always sit at the very column the top run
          // starts on - at 150% scaling it lands one over, and the whole 2560x1440
          // display failed to find a field whose borders were plainly there.
          const col = (xx, yy) => (xx > 0 && xx < bw - 1)
            && (M[yy * bw + xx] || M[yy * bw + xx - 1] || M[yy * bw + xx + 1]);
          let lc = 0, rc = 0;
          for (let yy = ty; yy <= by; yy++) {
            if (col(top.x0, yy)) lc++;
            if (col(top.x1, yy)) rc++;
          }
          // ONE side is enough. At 1080p the field draws both, but at 150% scaling the
          // left vertical is simply not painted in the border colour - top edge, bottom
          // edge and right side, and nothing down the left. Demanding both found no field
          // at all on that display.
          //
          // Two horizontal runs of identical extent plus one vertical, over a dark
          // interior, on the dialog's flat panel, at the right aspect, is still not
          // something scenery produces.
          if (Math.max(lc, rc) < boxH * SIDE_FRAC) continue;

          // and it is an input box: dark inside
          let s = 0, n = 0;
          for (let yy = ty + 3; yy < by - 2; yy += 2) {
            for (let xx = top.x0 + 3; xx < top.x1 - 2; xx += 2) { s += L[yy * bw + xx]; n++; }
          }
          if (!n || s / n > DARK_INSIDE) continue;

          // ...and it is sitting on the dialog's flat brown panel, not on scenery
          if (!onPanel(rgba, w, h, { x: top.x0 + bx0, y: ty + by0, w: boxW, h: boxH }, prof)) continue;

          // Nearest to where the dialog puts it wins - never biggest. Size ranking is what
          // made every previous version pick the merchant panel.
          const d = Math.hypot((top.x0 + boxW / 2) - cx, ty - cy);
          if (!best || d < best.d) {
            best = { d, box: { x: top.x0 + bx0, y: ty + by0, w: boxW, h: boxH } };
          }
        }
      }
    }
    if (!best) return null;
    return { quantity: best.box, row: best.box, boxes: [best.box] };
  }

  // reference profile first: it covers every known setup but one, and a hit ends the
  // search - the bright profile only ever runs on frames the reference cannot read
  function find(rgba, w, h, win) {
    for (const prof of PROFILES) {
      const hit = findWithProfile(rgba, w, h, win, prof);
      if (hit) return hit;
    }
    return null;
  }

  return { find, BAND, PROFILES };
});
