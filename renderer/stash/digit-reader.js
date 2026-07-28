'use strict';
// Port of iou_reader_final.py — game-glyph digit reader for PoE2 currency tabs.
// Pure JS on typed arrays: Otsu -> 4-conn labeling -> IoU sliding-window match ->
// greedy assembly -> gap-fill -> leading-"1" edge filter, with a grey-opening
// tophat fallback for bright-on-bright cells.
//
// Images are represented as a "value channel": Uint8Array of max(R,G,B), row-major,
// length = w*h. Binary images are Uint8Array of 0/1, same layout.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DigitReader = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ---- primitives ----------------------------------------------------------

  // Otsu threshold over a flat Uint8Array (matches numpy hist w/ 256 bins 0..256).
  function otsu(data) {
    const hist = new Float64Array(256);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    const tot = data.length;
    let sumall = 0;
    for (let t = 0; t < 256; t++) sumall += t * hist[t];
    let wB = 0, sumB = 0, best = -1, thr = 150;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = tot - wB;
      if (wF <= 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sumall - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  // Crop [x0,x1) x [y0,y1) from a value channel, clamped to bounds.
  // Returns { data, w, h }.
  function crop(V, W, H, x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const s = (y0 + y) * W + x0, d = y * w;
      for (let x = 0; x < w; x++) out[d + x] = V[s + x];
    }
    return { data: out, w, h };
  }

  // Bilinear resample of a value-channel {data,w,h} to (nw,nh). Used to normalise a
  // calibrated (non-1080) cell crop back to reference scale so the fixed-size 0-9
  // templates match regardless of the user's resolution.
  function resample(sub, nw, nh) {
    const { data, w, h } = sub;
    if (nw === w && nh === h) return sub;
    const out = new Uint8Array(nw * nh);
    const sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) {
      let fy = (y + 0.5) * sy - 0.5; let y0 = Math.floor(fy); const wy = fy - y0;
      let y1 = y0 + 1; y0 = Math.max(0, Math.min(h - 1, y0)); y1 = Math.max(0, Math.min(h - 1, y1));
      for (let x = 0; x < nw; x++) {
        let fx = (x + 0.5) * sx - 0.5; let x0 = Math.floor(fx); const wx = fx - x0;
        let x1 = x0 + 1; x0 = Math.max(0, Math.min(w - 1, x0)); x1 = Math.max(0, Math.min(w - 1, x1));
        const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
        const top = a + (b - a) * wx, bot = c + (d - c) * wx;
        out[y * nw + x] = Math.round(top + (bot - top) * wy);
      }
    }
    return { data: out, w: nw, h: nh };
  }

  function binarize(sub, floor) {
    const thr = Math.max(otsu(sub.data), floor);
    const b = new Uint8Array(sub.data.length);
    for (let i = 0; i < b.length; i++) b[i] = sub.data[i] > thr ? 1 : 0;
    return { data: b, w: sub.w, h: sub.h };
  }

  // 4-connectivity connected components (scipy.ndimage.label default structure).
  // Returns [{ mask:{data,w,h}, x, area }] where mask is cropped to the bbox and
  // x is the component's min-x in strip coords.
  function components(bin) {
    const { data, w, h } = bin;
    const lbl = new Int32Array(w * h);
    const stack = [];
    const comps = [];
    let n = 0;
    for (let i0 = 0; i0 < w * h; i0++) {
      if (!data[i0] || lbl[i0]) continue;
      n++;
      lbl[i0] = n; stack.length = 0; stack.push(i0);
      let xMin = w, xMax = -1, yMin = h, yMax = -1, area = 0;
      while (stack.length) {
        const p = stack.pop();
        const px = p % w, py = (p - px) / w;
        area++;
        if (px < xMin) xMin = px; if (px > xMax) xMax = px;
        if (py < yMin) yMin = py; if (py > yMax) yMax = py;
        if (px > 0) { const q = p - 1; if (data[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
        if (px < w - 1) { const q = p + 1; if (data[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
        if (py > 0) { const q = p - w; if (data[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
        if (py < h - 1) { const q = p + w; if (data[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
      }
      const bw = xMax - xMin + 1, bh = yMax - yMin + 1;
      // digit-sized: height 7-16, width 1-13, area>=5
      if (bh >= 7 && bh <= 16 && bw >= 1 && bw <= 13 && area >= 5) {
        const mask = new Uint8Array(bw * bh);
        for (let yy = yMin; yy <= yMax; yy++)
          for (let xx = xMin; xx <= xMax; xx++)
            if (lbl[yy * w + xx] === n) mask[(yy - yMin) * bw + (xx - xMin)] = 1;
        comps.push({ mask: { data: mask, w: bw, h: bh }, x: xMin, area });
      }
    }
    return comps;
  }

  function inkSum(m) { let s = 0; const d = m.data; for (let i = 0; i < d.length; i++) s += d[i]; return s; }

  // Jaccard IoU of two equal-size binary masks.
  function iou(a, b) {
    let inter = 0, uni = 0;
    const da = a, db = b;
    for (let i = 0; i < da.length; i++) {
      const x = da[i], y = db[i];
      if (x & y) inter++;
      if (x | y) uni++;
    }
    return uni > 0 ? inter / uni : 0;
  }

  // ---- template extraction -------------------------------------------------

  // gtPos: [[cx, cy, "value"], ...]
  function extractTemplates(V, W, H, gtPos, P) {
    const acc = {}; // char -> [mask{data,w,h}]
    for (const [cx, cy, val] of gtPos) {
      const sub = crop(V, W, H, cx - P.stripWidth, cy - P.up, cx + P.stripWidth, cy + P.dn);
      if (!sub.w || !sub.h) continue;
      const bin = binarize(sub, P.floor);
      const comps = components(bin);
      if (!comps.length || comps.length !== val.length) continue;
      comps.sort((a, b) => a.x - b.x);
      for (let i = 0; i < val.length; i++) {
        const ch = val[i];
        (acc[ch] || (acc[ch] = [])).push(comps[i].mask);
      }
    }
    const templates = {}, counts = {};
    for (const ch of Object.keys(acc)) {
      const glyphs = acc[ch];
      if (!glyphs.length) continue;
      // median-ink representative: argsort(inks)[len//2]
      const inks = glyphs.map((g, i) => ({ ink: inkSum(g), i }));
      inks.sort((a, b) => (a.ink - b.ink) || (a.i - b.i)); // stable by original index
      const medIdx = inks[Math.floor(glyphs.length / 2)].i;
      templates[ch] = glyphs[medIdx];
      counts[ch] = glyphs.length;
    }
    return { templates, counts };
  }

  // ---- IoU matching --------------------------------------------------------

  // Slide template across a binary strip; best vertical offset per x column.
  // Returns [{ x, dy, score }].
  function slideMatch(strip, tmpl, dyLo, dyHi, minInkFrac) {
    const { data: S, w: Wd, h: Hd } = strip;
    const { data: T, w: Tw, h: Th } = tmpl;
    if (Tw > Wd) return [];
    const templateInk = inkSum(tmpl);
    const out = [];
    const win = new Uint8Array(Tw * Th);
    const xEnd = Math.max(1, Wd - Tw + 1);
    for (let x = 0; x < xEnd; x++) {
      let bestDy = null, bestScore = 0;
      for (let dy = dyLo; dy <= dyHi; dy++) {
        const yCenter = ((Hd / 2) | 0) + dy;
        const yStart = yCenter - (Th / 2 | 0);
        const yEnd = yStart + Th;
        if (yStart < 0 || yEnd > Hd) continue;
        // extract window (exact Tw x Th)
        let winInk = 0;
        for (let ty = 0; ty < Th; ty++) {
          const srow = (yStart + ty) * Wd + x, drow = ty * Tw;
          for (let tx = 0; tx < Tw; tx++) { const v = S[srow + tx]; win[drow + tx] = v; winInk += v; }
        }
        if (winInk < minInkFrac * templateInk) continue;
        const score = iou(win, T);
        if (score > bestScore) { bestScore = score; bestDy = dy; }
      }
      if (bestDy !== null && bestScore > 0) out.push({ x, dy: bestDy, score: bestScore });
    }
    return out;
  }

  // grayscale erosion/dilation with square kernel k (reflect border) -> opening.
  function greyOpening(sub, k) {
    const eroded = rankFilter(sub, k, true);
    return rankFilter(eroded, k, false); // dilation of the erosion
  }
  function rankFilter(img, k, isMin) {
    const { data, w, h } = img;
    const out = new Uint8Array(w * h);
    const r = Math.floor(k / 2);
    const reflect = (i, n) => { // scipy 'reflect' (d c b a | a b c d | d c b a)
      if (n === 1) return 0;
      const period = 2 * n;
      let m = ((i % period) + period) % period;
      return m < n ? m : period - 1 - m;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = isMin ? 255 : 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = reflect(y + dy, h);
          for (let dx = -r; dx <= r; dx++) {
            const xx = reflect(x + dx, w);
            const v = data[yy * w + xx];
            acc = isMin ? (v < acc ? v : acc) : (v > acc ? v : acc);
          }
        }
        out[y * w + x] = acc;
      }
    }
    return { data: out, w, h };
  }

  const OVERLAP = 0.20; // hardcoded in the Python accept/gap logic

  function overlaps(x, tw, accepted) {
    for (const a of accepted) {
      const xo = Math.max(0, Math.min(x + tw, a.x + a.tw) - Math.max(x, a.x));
      const minW = Math.min(tw, a.tw);
      // Tolerate <=1px of template-width slop so tightly-kerned digits (e.g. "41"
      // where a wide template's edge grazes the next digit) aren't dropped; real
      // double-detections of one glyph overlap far more than 1px.
      if (xo > OVERLAP * minW && xo > 1) return true;
    }
    return false;
  }

  // Read one cell -> string, or "?" if unreadable.
  function readCellEx(V, W, H, cx, cy, templates, P, scale) {
    scale = scale && scale > 0 ? scale : 1;
    let sub;
    if (scale !== 1) {
      // calibrated non-reference resolution: crop the scaled window, then resample
      // back to reference size so the fixed 0-9 templates + reference P still apply.
      const sw = Math.round(P.stripWidth * scale), up = Math.round(P.up * scale), dn = Math.round(P.dn * scale);
      const raw = crop(V, W, H, cx - sw, cy - up, cx + sw, cy + dn);
      if (!raw.w || !raw.h) return { text: '?', conf: 0 };
      sub = resample(raw, Math.max(1, Math.round(raw.w / scale)), Math.max(1, Math.round(raw.h / scale)));
    } else {
      sub = crop(V, W, H, cx - P.stripWidth, cy - P.up, cx + P.stripWidth, cy + P.dn);
    }
    if (!sub.w || !sub.h) return { text: '?', conf: 0 };
    const bin = binarize(sub, P.floor);

    let cands = collect(bin, templates, P.iouThresh, P);

    // FALLBACK: grey tophat for bright-on-bright cells (marble/gold faces).
    if (!cands.length) {
      let ks = Math.max(3, Math.floor(Math.min(sub.h, sub.w) / 4));
      if (ks > 1 && ks % 2 === 0) ks += 1;
      try {
        const opening = greyOpening(sub, ks);
        const top = new Uint8Array(sub.data.length);
        for (let i = 0; i < top.length; i++) {
          let v = sub.data[i] - opening.data[i];
          top[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
        const tImg = { data: top, w: sub.w, h: sub.h };
        const thr = Math.max(otsu(top), P.floor - 20);
        const btop = { data: new Uint8Array(top.length), w: sub.w, h: sub.h };
        for (let i = 0; i < top.length; i++) btop.data[i] = top[i] > thr ? 1 : 0;
        const tc = collect(btop, templates, P.iouThresh * 0.70, P);
        if (tc.length) {
          const trial = tc.slice().sort((a, b) => a.x - b.x).map(c => c.ch).join('');
          const ones = (trial.match(/1/g) || []).length;
          if (!(ones >= 2 || trial === '11' || trial === '111')) cands = tc;
        }
        void tImg;
      } catch (e) { /* proceed with empty */ }
    }

    if (!cands.length) return { text: '?', conf: 0 };

    // greedy non-overlapping, highest IoU first
    cands.sort((a, b) => b.score - a.score);
    const accepted = [];
    for (const c of cands) if (!overlaps(c.x, c.tw, accepted)) accepted.push(c);

    // GAP-FILL between and after digits (lower threshold second pass)
    gapFill(bin, templates, accepted, P);

    // left-to-right
    accepted.sort((a, b) => a.x - b.x);

    // POST-FILTER: drop a leading spurious "1" (edge bleed) with no left ink,
    // clustered with another "1".
    const filtered = [];
    const minX = accepted.length ? accepted[0].x : Infinity;
    for (const c of accepted) {
      if (c.x === minX && c.ch === '1') {
        let hasLeftInk = false;
        if (c.x > 0) {
          const x0 = Math.max(0, c.x - 2);
          for (let y = 0; y < bin.h && !hasLeftInk; y++)
            for (let x = x0; x < c.x; x++) if (bin.data[y * bin.w + x]) { hasLeftInk = true; break; }
        }
        if (!hasLeftInk && c.x > 2) {
          const near = accepted.some(o => o.ch === '1' && o.x !== c.x && Math.abs(o.x - c.x) <= 4);
          if (near) continue;
        }
      }
      filtered.push(c);
    }
    if (!filtered.length) return { text: '?', conf: 0 };
    // confidence = mean IoU match score of the accepted glyphs (gap-filled ones default
    // to the base threshold). Surfaced per-line in the UI so misreads are easy to spot.
    const scores = filtered.map((c) => (typeof c.score === 'number' ? c.score : P.iouThresh));
    const conf = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { text: filtered.map((c) => c.ch).join(''), conf };
  }

  // string-only wrapper: back-compat for callers that just want the count text.
  function readCell(V, W, H, cx, cy, templates, P, scale) {
    return readCellEx(V, W, H, cx, cy, templates, P, scale).text;
  }

  // collect candidates over all templates at a given IoU threshold.
  function collect(strip, templates, thresh, P) {
    const out = [];
    for (const ch of Object.keys(templates)) {
      const t = templates[ch];
      const ms = slideMatch(strip, t, P.dyLo, P.dyHi, P.minInkFrac);
      for (const m of ms) if (m.score >= thresh) out.push({ x: m.x, ch, score: m.score, tw: t.w });
    }
    return out;
  }

  function gapFill(bin, templates, accepted, P) {
    const sorted = accepted.slice().sort((a, b) => a.x - b.x);
    const stripW = bin.w;
    const gapThresh = Math.max(0.70, P.iouThresh - 0.06);

    const subStrip = (gs, ge) => {
      const w = ge - gs, h = bin.h;
      const d = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) d[y * w + x] = bin.data[y * bin.w + gs + x];
      return { data: d, w, h };
    };
    const regionInk = (gs, ge) => {
      let s = 0;
      for (let y = 0; y < bin.h; y++) for (let x = gs; x < ge; x++) s += bin.data[y * bin.w + x];
      return s;
    };

    // gaps BETWEEN consecutive digits
    for (let i = 0; i < sorted.length - 1; i++) {
      const gs = sorted[i].x + sorted[i].tw, ge = sorted[i + 1].x;
      const gw = ge - gs;
      if (gw >= 4 && gw <= 15 && regionInk(gs, ge) > 20) {
        const region = subStrip(gs, ge);
        const gc = collect(region, templates, gapThresh, P).map(c => ({ ...c, x: gs + c.x }));
        gc.sort((a, b) => b.score - a.score);
        for (const c of gc) if (!overlaps(c.x, c.tw, accepted)) { accepted.push(c); break; }
      }
    }

    // gap AFTER the last digit (missing trailing digit)
    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1];
      const lastEnd = last.x + last.tw;
      const gwA = stripW - lastEnd;
      if (gwA >= 4 && gwA <= 15) {
        const ink = regionInk(lastEnd, stripW);
        const density = gwA > 0 ? ink / gwA : 0;
        if (ink > 120 && density > 12) {
          const region = subStrip(lastEnd, stripW);
          const gc = collect(region, templates, gapThresh, P).map(c => ({ ...c, x: lastEnd + c.x }));
          gc.sort((a, b) => b.score - a.score);
          for (const c of gc) if (!overlaps(c.x, c.tw, accepted)) { accepted.push(c); break; }
        }
      }
    }
  }

  // Default winning params (currency tab: 48/49).
  const DEFAULTS = {
    floor: 122, up: 12, dn: 12, stripWidth: 15,
    iouThresh: 0.76, dyLo: -2, dyHi: 3, minInkFrac: 0.45,
  };

  // Max saturation (max-min) for a pixel to count as "flat white" text. Stack
  // counts are flat white with a black outline; icon art is saturated/blended, so
  // gating max(R,G,B) by low saturation isolates the digits and drops the icon.
  const DESAT_SAT = 40;

  // Value channel = max(R,G,B) but ONLY for low-saturation (near-white) pixels;
  // saturated icon pixels -> 0. Order-agnostic (RGBA or BGRA) since max/min/sat
  // don't depend on channel order. This is the channel the stash reader uses.
  function valueChannelDesatMax(buf, W, H, sat) {
    sat = sat == null ? DESAT_SAT : sat;
    const V = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const a = buf[p], g = buf[p + 1], c = buf[p + 2];
      let mx = a, mn = a;
      if (g > mx) mx = g; if (g < mn) mn = g;
      if (c > mx) mx = c; if (c < mn) mn = c;
      V[i] = (mx - mn) <= sat ? mx : 0;
    }
    return V;
  }

  // Plain max(R,G,B) value channel (kept for the reference file-screenshot path).
  function valueChannelFromRGBA(buf, W, H, bgra) {
    const V = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const a = buf[p], b = buf[p + 2];
      const c0 = bgra ? b : a, c2 = bgra ? a : b; // r/b swap for BGRA
      const g = buf[p + 1];
      let m = c0 > g ? c0 : g; if (c2 > m) m = c2;
      V[i] = m;
    }
    return V;
  }

  // Rehydrate a baked template set ({ templates: { ch: {w,h,data:[…]} } } or the
  // bare { ch: {w,h,data} } map) into the {data:Uint8Array,w,h} form readCell wants.
  function templatesFromJSON(obj) {
    const src = obj && obj.templates ? obj.templates : obj;
    const out = {};
    for (const ch of Object.keys(src || {})) {
      const t = src[ch];
      out[ch] = { w: t.w, h: t.h, data: Uint8Array.from(t.data) };
    }
    return out;
  }

  return {
    otsu, crop, binarize, components, iou, slideMatch, greyOpening,
    extractTemplates, readCell, readCellEx, valueChannelFromRGBA, valueChannelDesatMax,
    templatesFromJSON, DEFAULTS, DESAT_SAT,
  };
});
