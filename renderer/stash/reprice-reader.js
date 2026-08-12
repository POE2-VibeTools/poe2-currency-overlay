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
  function score(comps, h) {
    if (!comps.length || comps.length > 7) return 0;
    const hs = comps.map((c) => c.mask.h);
    const spread = Math.max(...hs) - Math.min(...hs);
    if (spread > h * 0.25) return 0;
    return comps.length;
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

  // Best template for one glyph mask. Aspect ratio is checked first: a "1" and an "8"
  // resampled to the same box can score deceptively well otherwise.
  function classify(mask, templates) {
    let bestCh = null, bestScore = 0;
    for (const ch of Object.keys(templates)) {
      const t = templates[ch];
      const ar = (mask.w / mask.h) / (t.w / t.h);
      if (ar < 0.6 || ar > 1.66) continue;
      const s = iouFlat(resizeMask(mask, t.w, t.h), t.data);
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
    const comps = glyphs(V, shot.w, shot.h);
    if (!comps.length) return { value: null, text: '', scores: [] };

    let text = '';
    const scores = [];
    for (const c of comps) {
      const { ch, score } = classify(c.mask, templates);
      // One unreadable glyph invalidates the whole number. "9?" could be 9 or 95, and
      // pasting either would be a guess at the user's money.
      if (!ch || score < minScore) return { value: null, text: '', scores };
      text += ch;
      scores.push(score);
    }
    if (!/^\d{1,7}$/.test(text)) return { value: null, text, scores };
    // WHERE the digits were found, in crop pixels. The price dialog is centred and sizes
    // itself to its contents, so a longer currency name widens it and slides the number
    // sideways. Reading from a wider band than the calibrated box and reporting the hit
    // position is what lets the caller work out that shift - and apply the same shift to
    // the currency icon, which moved with it.
    const x0 = Math.min(...comps.map((c) => c.x));
    const last = comps[comps.length - 1];
    const box = { x0, x1: last.x + last.mask.w - 1, y0: Math.min(...comps.map((c) => c.y)) };
    return { value: parseInt(text, 10), text, scores, box };
  }

  return { read, glyphs, classify, valueChannel, resizeMask, MIN_PX };
});
