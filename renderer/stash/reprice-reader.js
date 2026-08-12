'use strict';
// Reads the number out of the game's Set Item Price box.
//
// This is a much easier target than a stash tab: one short run of digits, left-aligned,
// bright on a near-black field, at a fixed size, with no item art behind it. So it does
// NOT need the adaptive threshold sweep the stash reader uses - a single Otsu split and
// left-to-right component matching is enough, and being simple makes it fast and
// predictable.
//
// The digits are the game's own font at a size the stash templates were never cut for,
// so this carries its OWN template set (reprice-digits.json), built from a real capture
// by dev/build-reprice-digits.js.
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./digit-reader.js') : root.DigitReader
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RepriceReader = api;
})(typeof self !== 'undefined' ? self : this, function (DR) {

  // Deliberately NOT reusing digit-reader's components(): that one hardcodes the stash
  // font's glyph box (height 7-16px) and the price digits are far larger, so every
  // component was being thrown away. Only otsu is borrowed.
  const MIN_PX = 8;

  // RGBA (from getImageData / canvas) -> value channel the matcher wants.
  function valueChannel(rgba, w, h) {
    const V = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      V[p] = r > g ? (r > b ? r : b) : (g > b ? g : b);
    }
    return V;
  }

  // The number is SELECTED the moment the dialog opens. That does NOT invert it: the
  // digits stay bright, and the selection paints a warm mid-tone band behind them. So the
  // crop holds three tones - dark surround, selection band, bright digits - and a single
  // Otsu split lands between the first two, welding the band to the glyphs. Both
  // polarities are tried anyway, cheaply, rather than assuming which way round it is.
  function glyphs(V, w, h) {
    // Three tones live in this crop, not two: the dark surround, the SELECTION highlight
    // behind the number (the game selects it the moment the dialog opens), and the digits
    // themselves. One Otsu split lands between the surround and the highlight, which
    // merges highlight and digits into a single blob. So also try a second Otsu computed
    // over just the pixels above the first - that lands between highlight and digits.
    const t1 = DR.otsu(V);
    const upper = V.filter((v) => v > t1);
    const t2 = upper.length > 16 ? DR.otsu(upper) : t1;
    const cands = [
      label(V, w, h, (v) => v > t1),   // bright glyphs on a dark field
      label(V, w, h, (v) => v <= t1),  // dark glyphs on a bright field
      label(V, w, h, (v) => v > t2),   // bright glyphs on a mid-tone selection
    ];
    let best = cands[0], bestScore = score(cands[0], h);
    for (let i = 1; i < cands.length; i++) {
      const sc = score(cands[i], h);
      if (sc > bestScore) { best = cands[i]; bestScore = sc; }
    }
    return bestScore > 0 ? best : [];
  }

  // How much a set of components looks like a row of digits: same-ish heights, sensible
  // count. A border or a solid fill scores 0.
  //
  // The tie-break on INK matters as much as the count. One threshold isolates the digits;
  // a lower one takes the whole selection block as a single solid rectangle. Both produce
  // one component for a single-digit price, and whichever was tried first used to win -
  // so "0" came back as the block, which resampled to a decent match for "1" and read as
  // a confident 1. Digits are strokes; a filled rectangle is furniture.
  function score(comps, h) {
    if (!comps.length || comps.length > 7) return 0;
    const hs = comps.map((c) => c.mask.h);
    const spread = Math.max(...hs) - Math.min(...hs);
    if (spread > h * 0.25) return 0;
    let fill = 0;
    for (const c of comps) fill += c.area / Math.max(1, c.mask.w * c.mask.h);
    fill /= comps.length;
    return comps.length - fill * 0.5;
  }

  function label(V, w, h, isOn) {
    const on = new Uint8Array(w * h);
    for (let i = 0; i < V.length; i++) on[i] = isOn(V[i]) ? 1 : 0;

    const lbl = new Int32Array(w * h);
    const out = [];
    const stack = [];
    let n = 0;
    for (let i0 = 0; i0 < w * h; i0++) {
      if (!on[i0] || lbl[i0]) continue;
      n++; lbl[i0] = n; stack.length = 0; stack.push(i0);
      let x0 = w, x1 = -1, y0 = h, y1 = -1, area = 0;
      while (stack.length) {
        const p = stack.pop();
        const px = p % w, py = (p - px) / w;
        area++;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px > 0)     { const q = p - 1; if (on[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
        if (px < w - 1) { const q = p + 1; if (on[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
        if (py > 0)     { const q = p - w; if (on[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
        if (py < h - 1) { const q = p + w; if (on[q] && !lbl[q]) { lbl[q] = n; stack.push(q); } }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // Scale-free filters only. Sizing a glyph as a FRACTION of the crop was wrong: it
      // works on a tight crop and rejects every real digit on a generous one, which is
      // exactly the crop a user-dragged calibration produces. So bound the shape, not
      // the proportion, and let the clustering below throw out whatever is left.
      if (area < MIN_PX) continue;
      if (bh < 7 || bh > h * 0.9) continue;
      if (bw > bh * 1.4) continue;          // digits are taller than wide
      if (bw < 2) continue;                 // a 1px column is the caret or a border
      const mask = new Uint8Array(bw * bh);
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++)
          if (lbl[yy * w + xx] === n) mask[(yy - y0) * bw + (xx - x0)] = 1;
      out.push({ mask: { data: mask, w: bw, h: bh }, x: x0, y: y0, area });
    }
    out.sort((a, b) => a.x - b.x);
    return cluster(out);
  }

  // Keep only the biggest run of components that share a height and a baseline. In a
  // generous crop the field border, the currency icon and bits of the modal frame all
  // survive labelling; the digits are the ones that line up with each other.
  function cluster(comps) {
    if (comps.length < 2) return comps;
    let best = [];
    for (let i = 0; i < comps.length; i++) {
      const seed = comps[i];
      const group = comps.filter((c) => {
        const hOk = Math.abs(c.mask.h - seed.mask.h) <= Math.max(2, seed.mask.h * 0.25);
        const yOk = Math.abs(c.y - seed.y) <= Math.max(2, seed.mask.h * 0.35);
        return hOk && yOk;
      });
      if (group.length > best.length) best = group;
    }
    return best.length >= 1 ? best : comps;
  }

  // Read the digits by WALKING the templates across the strip, instead of cutting it into
  // glyphs first.
  //
  // Segmentation is the fragile step. At the sizes the game draws, neighbouring digits
  // touch - "12345" comes back as one blob and reads as nothing, or matches the most
  // filled template and reads as a confident 8 - while a thin "0" ring breaks into two
  // pieces and reads as 1. Splitting blobs by their thinnest column just shreds them.
  //
  // Walking sidesteps it: take the tallest ink as the text height, then from the left edge
  // ask which template best explains the next few columns, step over exactly that
  // template's width, and repeat. Touching digits are no harder than separated ones,
  // because the boundary is decided by what matched rather than by a gap.
  function walk(on, w, h, templates, minScore) {
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!on[y * w + x]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0 || y1 < 0) return null;
    const textH = y1 - y0 + 1;
    const span = x1 - x0 + 1;
    if (textH < 5 || span < 2) return null;

    const chars = Object.keys(templates);
    if (!chars.length) return null;
    const ths = chars.map((c) => templates[c].h).sort((a, b) => a - b);
    const th = ths[Math.floor(ths.length / 2)];
    const scale = textH / th;

    const slice = (x, cw) => {
      const data = new Uint8Array(cw * textH);
      for (let yy = 0; yy < textH; yy++) {
        for (let xx = 0; xx < cw; xx++) {
          const sx = x + xx;
          if (sx >= 0 && sx < w && on[(y0 + yy) * w + sx]) data[yy * cw + xx] = 1;
        }
      }
      return { data, w: cw, h: textH };
    };

    // Score every (template, width) that could start at each column, once.
    const MAXN = 7;
    const at = [];
    for (let i = 0; i < span; i++) {
      const here = [];
      for (const ch of chars) {
        const t = templates[ch];
        const base = Math.max(2, Math.round(t.w * scale));
        for (const cw of [base - 1, base, base + 1]) {
          if (cw < 2 || i + cw > span + 1) continue;
          const sc = iouFlat(resizeMask(slice(x0 + i, cw), t.w, t.h), t.data);
          if (sc >= minScore) here.push({ ch, cw, sc });
        }
      }
      at.push(here);
    }

    // Best TILING of the strip, not a greedy walk.
    //
    // Greedy fails on the only cases that matter here. Every digit starts with a vertical
    // stroke, so the first few columns of a 4 or a 0 match "1" better than the whole glyph
    // matches itself - greedy takes the 1, advances three pixels into the middle of a
    // digit, and every step after that is garbage. "12345" came back as 11111 and "0" as 1.
    //
    // Choosing the whole sequence at once fixes it: a tiling has to account for EVERY
    // column of ink, so reading a 0 as a 1 leaves four columns that nothing explains, and
    // the honest tiling wins. Scored by mean rather than total, or a reading with more
    // digits would always beat a better one with fewer.
    const NEG = -1;
    const bestSum = [];   // bestSum[i][n] - total score covering i columns with n glyphs
    const from = [];
    for (let i = 0; i <= span + 1; i++) {
      bestSum.push(new Array(MAXN + 1).fill(NEG));
      from.push(new Array(MAXN + 1).fill(null));
    }
    bestSum[0][0] = 0;

    for (let i = 0; i < span; i++) {
      for (let n = 0; n < MAXN; n++) {
        if (bestSum[i][n] === NEG) continue;
        for (const c of at[i]) {
          const j = i + c.cw;
          if (j > span + 1) continue;
          const sum = bestSum[i][n] + c.sc;
          if (sum > bestSum[j][n + 1]) {
            bestSum[j][n + 1] = sum;
            from[j][n + 1] = { i, n, ch: c.ch };
          }
        }
      }
    }

    // The tiling must reach the end of the ink - a pixel short or over is rounding.
    let endI = -1, endN = -1, best = -1;
    // Exactly the ink, or a pixel over from rounding - never SHORT. Allowing one column
    // of slack let "0" be tiled as two 1s covering six of its seven columns, which scored
    // better than reading it honestly.
    for (const i of [span, span + 1]) {
      if (i < 0 || i > span + 1) continue;
      for (let n = 1; n <= MAXN; n++) {
        if (bestSum[i][n] === NEG) continue;
        const mean = bestSum[i][n] / n;
        if (mean > best) { best = mean; endI = i; endN = n; }
      }
    }
    if (endI < 0) return null;

    const out = [];
    let ci = endI, cn = endN;
    while (cn > 0) {
      const step = from[ci][cn];
      if (!step) return null;
      out.push(step.ch);
      ci = step.i; cn = step.n;
    }
    out.reverse();
    const text = out.join('');
    if (!text || !/^\d{1,7}$/.test(text)) return null;
    return { value: parseInt(text, 10), text, scores: [best] };
  }

  // Nearest-neighbour resample of a binary mask, so a glyph can be compared against a
  // template cut at a slightly different size.
  function resizeMask(m, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(m.h - 1, Math.floor(y * m.h / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(m.w - 1, Math.floor(x * m.w / w));
        out[y * w + x] = m.data[sy * m.w + sx];
      }
    }
    return out;
  }

  function iouFlat(a, b) {
    let inter = 0, uni = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x & y) inter++;
      if (x | y) uni++;
    }
    return uni > 0 ? inter / uni : 0;
  }

  // IoU allowing the glyph to be a pixel out of register with the template.
  //
  // These strokes are one to two pixels wide, so a single pixel of offset makes them miss
  // each other entirely and the score collapses. A real "4" captured 8px wide against a
  // 7px template - the same shape, shifted one column by the resample - scored 0.33 and
  // was rejected, which is what turned "240" into 11111. Nudging by a pixel and keeping
  // the best costs nine comparisons on a mask of a hundred-odd pixels.
  function iouAligned(a, b, w, h) {
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let inter = 0, uni = 0;
        for (let y = 0; y < h; y++) {
          const sy = y + dy;
          for (let x = 0; x < w; x++) {
            const sx = x + dx;
            const p = (sx >= 0 && sx < w && sy >= 0 && sy < h) ? a[sy * w + sx] : 0;
            const q = b[y * w + x];
            if (p & q) inter++;
            if (p | q) uni++;
          }
        }
        const s = uni > 0 ? inter / uni : 0;
        if (s > best) best = s;
      }
    }
    return best;
  }

  // Best template for one glyph mask. Aspect ratio is checked first: a "1" and an "8"
  // resampled to the same box can score deceptively well otherwise.
  function classify(mask, templates) {
    let bestCh = null, bestScore = 0;
    for (const ch of Object.keys(templates)) {
      const t = templates[ch];
      const ar = (mask.w / mask.h) / (t.w / t.h);
      if (ar < 0.6 || ar > 1.66) continue;
      const s = iouAligned(resizeMask(mask, t.w, t.h), t.data, t.w, t.h);
      if (s > bestScore) { bestScore = s; bestCh = ch; }
    }
    return { ch: bestCh, score: bestScore };
  }

  /**
   * @param {{data:number[]|Uint8ClampedArray, w:number, h:number}} shot  RGBA crop of the price box
   * @param {object} templates  char -> {w,h,data} binary masks
   * @param {number} minScore   reject a glyph below this IoU (0..1)
   * @returns {{value:number|null, text:string, scores:number[]}}
   */
  function read(shot, templates, minScore) {
    minScore = minScore == null ? 0.55 : minScore;
    if (!shot || !shot.w || !shot.h || !templates) return { value: null, text: '', scores: [] };
    const rgba = shot.data instanceof Uint8ClampedArray ? shot.data : Uint8ClampedArray.from(shot.data);
    const V = valueChannel(rgba, shot.w, shot.h);

    // The tiling search, over both plausible thresholds.
    const byWalk = () => {
      const t1 = DR.otsu(V);
      const upper = V.filter((v) => v > t1);
      const t2 = upper.length > 16 ? DR.otsu(upper) : t1;
      let best = null;
      for (const cut of [t2, t1]) {
        const on = new Uint8Array(V.length);
        for (let i = 0; i < V.length; i++) on[i] = V[i] > cut ? 1 : 0;
        const r = walk(on, shot.w, shot.h, templates, minScore);
        if (r && (!best || r.scores[0] > best.scores[0])) best = r;
      }
      return best;
    };

    // Cutting the strip into glyphs first.
    const bySegment = () => {
      const comps = glyphs(V, shot.w, shot.h);
      if (!comps.length) return null;
      let text = '';
      const scores = [];
      for (const c of comps) {
        const { ch, score } = classify(c.mask, templates);
        // One unreadable glyph invalidates the whole number. "9?" could be 9 or 95, and
        // pasting either would be a guess at the user's money.
        if (!ch || score < minScore) return null;
        text += ch;
        scores.push(score);
      }
      if (!/^\d{1,7}$/.test(text)) return null;
      // WHERE the digits were found, in crop pixels - the caller uses the offset to place
      // the currency icon, which slides with the number when the dialog resizes.
      const x0 = Math.min(...comps.map((c) => c.x));
      const last = comps[comps.length - 1];
      return {
        value: parseInt(text, 10), text, scores,
        box: { x0, x1: last.x + last.mask.w - 1, y0: Math.min(...comps.map((c) => c.y)) },
      };
    };

    // Run BOTH and let the better one win, rather than treating the walk as a fallback.
    //
    // Falling back only on failure was worse than useless: segmentation does not fail
    // loudly on the cases that matter. A "0" whose ring breaks reads as a confident "1",
    // and five touching digits read as "11111" - both parse, both look fine, and the
    // fallback never ran. Scoring them against each other is what catches that, because a
    // tiling has to account for every column of ink and a wrong reading cannot.
    const a = bySegment(), b = byWalk();
    const mean = (r) => (r && r.scores.length ? r.scores.reduce((x, y) => x + y, 0) / r.scores.length : -1);
    if (!a && !b) return { value: null, text: '', scores: [] };
    if (!a) return b;
    if (!b) return a;
    return mean(b) > mean(a) ? b : a;
  }

  return { read, glyphs, classify, valueChannel, resizeMask, MIN_PX };
});
