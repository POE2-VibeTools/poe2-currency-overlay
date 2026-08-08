'use strict';
// panel-finder.js - locate the stash panel by its COLOURED FRAME, with no calibration.
//
// The panel is drawn as a rectangle outlined in one saturated colour against a UI that is
// otherwise brown/grey. The colour is NOT fixed: it is whatever the player assigned to
// that stash tab. Measured across real submissions, currency tabs came back blue, green,
// red and yellow. So this matches on hue CONSISTENCY, never on a particular hue.
//
// It works on RUNS, not per-row pixel counts. Counting pixels per row fails twice: the
// threshold has to be a fraction of the image width, which a 630px panel on a 3840px
// screen never clears; and the stash tab list beside the panel shares the tab colours, so
// a row-wide count bounds the whole stash window instead of the panel. A run is a
// contiguous span of one hue, so it measures the edge itself and is independent of how
// large the screen is or what else on it happens to be the same colour.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).panelFinder = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const HUE_BUCKETS = 24;      // 15 degrees each
  const MIN_SAT = 0.25;        // below this it is UI brown/grey, not a tab colour
  const MIN_VAL = 0.20;        // ignore near-black
  const MIN_SIDE = 200;        // a stash panel is never smaller than this in practice
  const EDGE_TOL = 6;          // px slop when matching a top run against a bottom run
  const GAP_TOL = 2;           // a frame line may drop a pixel here and there
  // A real panel border measured 17-28% ring coverage on live captures; the rest of
  // the ring is where item art and the tab list overlap it. Small UI frames sit at
  // 70-85%, so this is a floor to exclude noise, never a ranking signal.
  const MIN_COVERAGE = 0.12;
  const MIN_ASPECT = 0.80;     // the stash panel is square

  function hueBucket(b, g, r) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!mx || d / mx < MIN_SAT || mx / 255 < MIN_VAL) return -1;
    let h;
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    return Math.min(HUE_BUCKETS - 1, Math.floor(h / (360 / HUE_BUCKETS)));
  }

  // longest run of hue k along a row (or column), tolerating GAP_TOL missing pixels
  function longestRun(get, n, k) {
    let bestLen = 0, bestStart = -1, start = -1, gap = 0, end = -1;
    for (let i = 0; i < n; i++) {
      if (get(i) === k) {
        if (start < 0) start = i;
        end = i; gap = 0;
      } else if (start >= 0) {
        if (++gap > GAP_TOL) {
          if (end - start + 1 > bestLen) { bestLen = end - start + 1; bestStart = start; }
          start = -1; gap = 0;
        }
      }
    }
    if (start >= 0 && end - start + 1 > bestLen) { bestLen = end - start + 1; bestStart = start; }
    return bestLen > 0 ? { start: bestStart, len: bestLen } : null;
  }

  /**
   * Find the stash panel's coloured frame in a BGRA bitmap.
   * Returns { x, y, w, h, hue, coverage, score } for the frame rect, or null.
   * `coverage` (0-1) is how much of that rect's own border carries the winning hue - the
   * same number the calibration warning uses to tell a good box from a garbage one.
   */
  function findPanel(buf, W, H, opts) {
    opts = opts || {};
    const minSide = opts.minSide || MIN_SIDE;
    const step = Math.max(1, Math.round(Math.min(W, H) / 700)); // subsample tall frames
    const at = (x, y) => { const i = (y * W + x) * 4; return hueBucket(buf[i], buf[i + 1], buf[i + 2]); };

    // 1) per hue, collect rows carrying a long horizontal run
    const rowRuns = new Map(); // hue -> [{ y, start, len }]
    for (let y = 0; y < H; y += step) {
      const seen = new Set();
      for (let x = 0; x < W; x += step) {
        const k = at(x, y);
        if (k >= 0) seen.add(k);
      }
      for (const k of seen) {
        const run = longestRun((i) => at(i * step, y), Math.ceil(W / step), k);
        if (!run || run.len * step < minSide) continue;
        if (!rowRuns.has(k)) rowRuns.set(k, []);
        rowRuns.get(k).push({ y, x0: run.start * step, x1: (run.start + run.len - 1) * step });
      }
    }

    let best = null;
    const vMemo = new Map(), colMemo = new Map();
    for (const [k, runs] of rowRuns) {
      if (runs.length < 2) continue;
      // 2) pair a top run with a bottom run that shares its x-extent - that pair is a
      // candidate frame, and sharing the extent is what rejects the neighbouring tab list
      for (let i = 0; i < runs.length; i++) {
        for (let j = runs.length - 1; j > i; j--) {
          const a = runs[i], b = runs[j];
          // Item art overlaps a border more often than not, so one of the two runs is
          // frequently truncated (idol tab: top edge ran 335px where the bottom ran 586).
          // Requiring BOTH ends to line up threw those away. Share one end, overlap
          // substantially, and take the union as the true extent.
          const sharesEnd = Math.abs(a.x0 - b.x0) <= EDGE_TOL || Math.abs(a.x1 - b.x1) <= EDGE_TOL;
          if (!sharesEnd) continue;
          const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          if (ov < Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.6) continue;
          const x = Math.min(a.x0, b.x0), w = Math.max(a.x1, b.x1) - x;
          const y = a.y, h = b.y - a.y;
          if (w < minSide || h < minSide) continue;
          // 3) both verticals must exist too, or it is a pair of unrelated bars.
          // Probe a WINDOW, not the exact column: the frame's corners are mitred, so the
          // horizontal run starts a few px inside where the vertical line actually sits
          // (measured: top run began at x=20, left edge lived at x=15-18). Probing the
          // exact column missed it by four pixels and threw away a valid frame.
          // memoised: candidates overlap heavily, and each probe is a full-height scan.
          // Without this the relaxed pairing above pushed a find from 250ms to 1500ms.
          const vScan = (cx) => {
            const memoKey = k + '|' + cx;
            if (vMemo.has(memoKey)) return vMemo.get(memoKey);
            let bestRun = null;
            for (let d = -EDGE_TOL; d <= EDGE_TOL; d++) {
              const px = cx + d;
              if (px < 0 || px >= W) continue;
              const colKey = k + '#' + px;
              let r = colMemo.get(colKey);
              if (r === undefined) {
                r = longestRun((n) => at(px, n * step), Math.ceil(H / step), k);
                colMemo.set(colKey, r);
              }
              if (r && (!bestRun || r.len > bestRun.len)) bestRun = r;
            }
            vMemo.set(memoKey, bestRun);
            return bestRun;
          };
          // ONE vertical is enough. The horizontal pair already fixes x0 and x1, so the
          // vertical is only corroboration - and on a real capture the panel's right side
          // abuts the stash tab list and carries no coloured border at all (measured:
          // left edge 634px at x=15, right edge absent entirely). Demanding both threw
          // away the correct rectangle.
          const left = vScan(x);
          const right = vScan(Math.min(W - 1, x + w));
          const bestV = Math.max(left ? left.len * step : 0, right ? right.len * step : 0);
          if (bestV < h * 0.8) continue;
          const cov = ringCoverage(buf, W, H, x, y, w, h, k, step);
          const aspect = Math.min(w, h) / Math.max(w, h);
          if (cov < MIN_COVERAGE || aspect < MIN_ASPECT) continue;
          // Rank by AREA, not by coverage. Coverage alone picks the small, brightly
          // outlined things - a tooltip or the inventory border scored 0.83 against the
          // stash panel's 0.17 and won, because a short border is easier to keep
          // perfectly uniform than a 600px one. The panel is the LARGEST coloured square
          // frame on screen, so size is the discriminator and coverage is just a floor.
          const score = w * h;
          if (!best || score > best.score) best = { x, y, w, h, hue: k, coverage: cov, score };
        }
      }
    }
    return best;
  }

  function ringCoverage(buf, W, H, x, y, w, h, k, step) {
    let hit = 0, n = 0;
    const probe = (px, py) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const i = (py * W + px) * 4;
      n++;
      if (hueBucket(buf[i], buf[i + 1], buf[i + 2]) === k) hit++;
    };
    for (let d = 0; d < 3; d++) {
      for (let px = x; px <= x + w; px += step) { probe(px, y + d); probe(px, y + h - d); }
      for (let py = y; py <= y + h; py += step) { probe(x + d, py); probe(x + w - d, py); }
    }
    return n ? hit / n : 0;
  }

  // The coloured rect this finds is the panel FRAME; the reader works in the CONTENT box
  // inside it. Both were measured on the 1920x1032 reference capture, and the content box
  // starts a few px ABOVE the frame - that is real, not a typo.
  const REF_CONTENT = { x: 18, y: 168, w: 582, h: 606 };
  const REF_FRAME = { x: 13, y: 171, w: 594, h: 594 };
  function frameToContent(f) {
    const sx = f.w / REF_FRAME.w, sy = f.h / REF_FRAME.h;
    return {
      x: Math.round(f.x + (REF_CONTENT.x - REF_FRAME.x) * sx),
      y: Math.round(f.y + (REF_CONTENT.y - REF_FRAME.y) * sy),
      w: Math.round(REF_CONTENT.w * sx),
      h: Math.round(REF_CONTENT.h * sy),
    };
  }

  return { findPanel, frameToContent, hueBucket, ringCoverage, MIN_SIDE, REF_CONTENT, REF_FRAME };
});
