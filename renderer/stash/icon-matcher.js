/**
 * Icon matcher for stash slots.
 *
 * Given a slot's on-screen icon pixels and a set of candidate catalog icons,
 * ranks the candidates by visual similarity so a slot can be labeled with its
 * currency/item apiId. Used for (a) the currency tab's DYNAMIC bottom rows
 * (arbitrary contents), and (b) faster auto-labeling when building a new tab map.
 *
 * Winning method (validated 20/20 on the Abyss ground truth, beating HSV-colour,
 * Pearson-RGB, hybrid, and edge metrics): FOREGROUND-WEIGHTED SSD with a +/-4px
 * alignment search.
 *   - Cells are opaque icons on navy (~[26,26,40]) with a stack number in the
 *     top-left ~13x13, which is masked out.
 *   - Candidates are transparent catalog PNGs, composited onto navy to compare.
 *   - Only foreground pixels are scored (cells: distance-from-navy; candidates:
 *     alpha), and the best score over a small (dx,dy) shift wins, to absorb the
 *     few-px alignment slop between a live grab and a clean catalog render.
 * See STASH-NETWORTH-HANDOFF.md. Reference impl: dev/stash-matcher/icon-matcher-reference.js.
 *
 * NOTE: the reference used `dist = sqrt(sumSq); ssd += dist*dist*w`, i.e. sumSq*w.
 * This module adds sumSq directly (skips the sqrt) — identical scores, faster.
 *
 * Runtime use:
 *   const cands = catalogIcons.map(c => ({ apiId: c.apiId, f: IconMatcher.prepCandidate(c.rgba) }));
 *   const best = IconMatcher.match(cellRgb, cands).best.apiId;   // cellRgb = Uint8Array(S*S*3)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IconMatcher = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NAVY = [26, 26, 40];
  var DEFAULTS = { size: 40, corner: 13, align: 4, minWeight: 0.05 };

  function opts(o) {
    o = o || {};
    return {
      size: o.size || DEFAULTS.size,
      corner: o.corner == null ? DEFAULTS.corner : o.corner,
      align: o.align == null ? DEFAULTS.align : o.align,
      minWeight: o.minWeight == null ? DEFAULTS.minWeight : o.minWeight
    };
  }

  // Composite transparent RGBA onto the navy slot background -> opaque RGB.
  function compositeOnNavy(rgba, S) {
    var rgb = new Uint8Array(S * S * 3);
    for (var i = 0; i < S * S; i++) {
      var a = rgba[i * 4 + 3] / 255;
      rgb[i * 3]     = Math.round(rgba[i * 4]     * a + NAVY[0] * (1 - a));
      rgb[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * a + NAVY[1] * (1 - a));
      rgb[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * a + NAVY[2] * (1 - a));
    }
    return rgb;
  }

  // Paint the top-left corner (stack-number region) navy so it's ignored.
  function maskCorner(rgb, S, corner) {
    var out = new Uint8Array(rgb);
    for (var y = 0; y < corner; y++) {
      for (var x = 0; x < corner; x++) {
        var idx = (y * S + x) * 3;
        out[idx] = NAVY[0]; out[idx + 1] = NAVY[1]; out[idx + 2] = NAVY[2];
      }
    }
    return out;
  }

  function zeroCorner(w, S, corner) {
    for (var y = 0; y < corner; y++) {
      for (var x = 0; x < corner; x++) w[y * S + x] = 0;
    }
  }

  function distFromNavy2(rgb, i3) {
    var dr = rgb[i3] - NAVY[0], dg = rgb[i3 + 1] - NAVY[1], db = rgb[i3 + 2] - NAVY[2];
    return dr * dr + dg * dg + db * db;
  }

  // A prepared feature: masked RGB + a per-pixel foreground weight map.
  // Candidate feature (transparent catalog icon).
  function prepCandidate(rgba, o) {
    o = opts(o); var S = o.size;
    var rgb = maskCorner(compositeOnNavy(rgba, S), S, o.corner);
    var w = new Float32Array(S * S);
    for (var i = 0; i < S * S; i++) {
      var a = rgba[i * 4 + 3];
      w[i] = a > 50 ? 1.0 : (a > 20 ? 0.2 : 0);
    }
    zeroCorner(w, S, o.corner);
    return { rgb: rgb, weights: w, size: S, corner: o.corner, align: o.align, minWeight: o.minWeight };
  }

  // Cell feature (opaque on-screen slot, RGB Uint8Array of length S*S*3).
  function prepCell(rgb, o) {
    o = opts(o); var S = o.size;
    var src = (rgb instanceof Uint8Array) ? rgb : Uint8Array.from(rgb);
    var masked = maskCorner(src, S, o.corner);
    var w = new Float32Array(S * S);
    for (var i = 0; i < S * S; i++) {
      var d2 = distFromNavy2(masked, i * 3);
      w[i] = d2 > 900 ? 1.0 : (d2 > 144 ? 0.2 : 0); // sqrt-thresholds 30 / 12
    }
    zeroCorner(w, S, o.corner);
    return { rgb: masked, weights: w, size: S, corner: o.corner, align: o.align, minWeight: o.minWeight };
  }

  function clamp(v, hi) { return v < 0 ? 0 : (v > hi ? hi : v); }

  // Higher = better: negated mean foreground-weighted SSD, best over +/-align shift.
  function score(cell, cand) {
    var S = cell.size, A = cell.align, mw = cell.minWeight;
    var cw = cell.weights, cr = cell.rgb, dr = cand.rgb, hi = S - 1;
    var best = Infinity;
    for (var dx = -A; dx <= A; dx++) {
      for (var dy = -A; dy <= A; dy++) {
        var ssd = 0, tw = 0;
        for (var y = 0; y < S; y++) {
          for (var x = 0; x < S; x++) {
            var w = cw[y * S + x];
            if (w < mw) continue;
            var ci = (y * S + x) * 3;
            var di = (clamp(y + dy, hi) * S + clamp(x + dx, hi)) * 3;
            var er = cr[ci] - dr[di], eg = cr[ci + 1] - dr[di + 1], eb = cr[ci + 2] - dr[di + 2];
            ssd += (er * er + eg * eg + eb * eb) * w;
            tw += w;
          }
        }
        if (tw > 0) ssd /= tw;
        if (ssd < best) best = ssd;
      }
    }
    return -best;
  }

  // Rank candidates for a cell. `cell` may be a prepped feature or a raw RGB
  // Uint8Array. Each candidate may carry a prepped `.f`/`.feature`, or raw
  // `.rgba` (catalog) / `.rgb` (cell-like).
  function match(cell, candidates, o) {
    var cf = (cell && cell.weights) ? cell : prepCell(cell, o);
    var ranked = candidates.map(function (c) {
      var f = c.f || c.feature ||
        (c.rgba ? prepCandidate(c.rgba, o) : prepCell(c.rgb, o));
      return { apiId: c.apiId, name: c.name, score: score(cf, f) };
    }).sort(function (a, b) { return b.score - a.score; });
    return { ranked: ranked, best: ranked[0] };
  }

  return {
    NAVY: NAVY,
    DEFAULTS: DEFAULTS,
    compositeOnNavy: compositeOnNavy,
    prepCandidate: prepCandidate,
    prepCell: prepCell,
    score: score,
    match: match
  };
}));
