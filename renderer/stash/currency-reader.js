'use strict';
// Identify which currency is selected in the Set Item Price dropdown, from a grab of the
// icon beside the name.
//
// The icon gives the FAMILY, not the currency. GGG draws Chaos, Greater Chaos and Perfect
// Chaos with the same art, and likewise for Exalted, Regal, Augmentation and
// Transmutation - so a family of three collapses to one image and the tier has to come
// from the word next to it. That split is deliberate: matching a picture is reliable,
// matching one letter is reliable, and reading a whole word is neither.
//
// Matching is done at a fixed 24x24 box, so it does not care how large the game draws the
// icon. GGG appears to size these against resolution rather than to a fixed pixel count,
// which would otherwise make templates cut at one resolution useless at another.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CurrencyReader = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // A match below this is reported as "no idea" rather than as a guess. Pricing against
  // the wrong currency is worse than not knowing the currency.
  //
  // Calibrated against REAL captures, not against the art matched with itself. The game
  // draws these at around 28px over a lit background; a correct icon lands near 0.5, not
  // near the 0.9 the synthetic test produces. A floor set from synthetic scores rejected
  // every genuine read.
  const MIN_SCORE = 0.35;
  // Separation is what actually identifies an icon, so it carries more weight than the
  // absolute score: the runner-up must be beaten both by a flat amount and by a clear
  // fraction. Two orbs at 0.71 and 0.70 are not an identification however high they look,
  // and 0.50 against 0.34 is one however modest.
  const MIN_MARGIN = 0.06;
  const MIN_RATIO = 1.15;

  // Area-average a sub-rectangle of an RGBA buffer into an n x n RGB grid. Must match the
  // baker's downsample, or the two sides are not comparable.
  function signature(rgba, w, h, box, n) {
    const rgb = new Float64Array(n * n * 3);
    for (let gy = 0; gy < n; gy++) {
      const sy0 = box.y + Math.floor(gy * box.h / n);
      const sy1 = box.y + Math.max(Math.floor((gy + 1) * box.h / n), Math.floor(gy * box.h / n) + 1);
      for (let gx = 0; gx < n; gx++) {
        const sx0 = box.x + Math.floor(gx * box.w / n);
        const sx1 = box.x + Math.max(Math.floor((gx + 1) * box.w / n), Math.floor(gx * box.w / n) + 1);
        let r = 0, g = 0, b = 0, cnt = 0;
        for (let y = sy0; y < Math.min(sy1, h); y++) {
          for (let x = sx0; x < Math.min(sx1, w); x++) {
            const p = (y * w + x) * 4;
            r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; cnt++;
          }
        }
        const gi = gy * n + gx;
        if (cnt) { rgb[gi * 3] = r / cnt; rgb[gi * 3 + 1] = g / cnt; rgb[gi * 3 + 2] = b / cnt; }
      }
    }
    return rgb;
  }

  // Coverage-weighted, zero-mean normalised cross-correlation, per channel.
  //
  // Zero-mean and normalised because the game's icon is not the source art: it is drawn
  // over a lit background at some brightness we do not control, so absolute pixel values
  // will not agree even on a perfect match. What survives is the PATTERN.
  //
  // Weighted by the template's alpha so the dropdown's background, which fills the corners
  // of any square crop of a round orb, contributes nothing.
  // Only pixels the art paints SOLIDLY are compared. A half-transparent pixel takes half
  // its colour from whatever is behind it, which on a live screen is the dropdown, not the
  // orb - so soft edges carry background, not signal. Including them made Hinekora's Lock,
  // which is mostly soft edge, fail to match even against itself.
  const SOLID = 0.5;

  function ncc(a, b, cov) {
    let out = 0;
    for (let c = 0; c < 3; c++) {
      let wsum = 0, ma = 0, mb = 0;
      for (let i = 0; i < cov.length; i++) {
        const t = cov[i] / 255;
        if (t < SOLID) continue;
        const wt = t * t;   // fully opaque pixels dominate the ones merely past the line
        wsum += wt; ma += wt * a[i * 3 + c]; mb += wt * b[i * 3 + c];
      }
      if (wsum <= 0) return 0;
      ma /= wsum; mb /= wsum;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < cov.length; i++) {
        const t = cov[i] / 255;
        if (t < SOLID) continue;
        const wt = t * t;
        const x = a[i * 3 + c] - ma, y = b[i * 3 + c] - mb;
        num += wt * x * y; da += wt * x * x; db += wt * y * y;
      }
      out += (da > 0 && db > 0) ? num / Math.sqrt(da * db) : 0;
    }
    return out / 3;
  }

  // Find the icon inside the crop and return its bounding box.
  //
  // The templates are alpha-TRIMMED: the art is cut down to the pixels it actually paints,
  // then stretched to fill the comparison box. So the capture has to be trimmed the same
  // way or the two are not describing the same thing. A hand-dragged box typically leaves
  // the icon filling about half its width, and comparing that against a template that
  // fills the whole box lines the icon's face up against the template's background - which
  // scores like noise, indistinguishable from a wrong icon.
  //
  // There is no alpha here, so the icon is separated from the dropdown behind it by
  // brightness: sample the border for the background level, then keep whatever is
  // clearly above it.
  function trim(rgba, w, h) {
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
      lum[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
    // background = median of the one-pixel border, which a sane box is all background
    const edge = [];
    for (let x = 0; x < w; x++) { edge.push(lum[x]); edge.push(lum[(h - 1) * w + x]); }
    for (let y = 0; y < h; y++) { edge.push(lum[y * w]); edge.push(lum[y * w + w - 1]); }
    edge.sort((a, b) => a - b);
    const bg = edge[edge.length >> 1];

    // Spread of the whole crop decides how far above the background counts as "the icon".
    // A fixed offset would swallow a dim icon or clip a bright one.
    let max = 0;
    for (let p = 0; p < lum.length; p++) if (lum[p] > max) max = lum[p];
    const cut = bg + Math.max(10, (max - bg) * 0.22);

    let x0 = w, y0 = h, x1 = -1, y1 = -1, on = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (lum[y * w + x] >= cut) {
          on++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    // Too little found, or so much that the "background" was not background - fall back to
    // the whole crop rather than trusting a nonsense box.
    if (on < 12 || x1 < 0 || (x1 - x0 + 1) < w * 0.15 || (y1 - y0 + 1) < h * 0.15) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // Candidate framings, best guess first. The trimmed box is what should work; the insets
  // stay as a fallback for a crop where the brightness split does not separate cleanly.
  function crops(rgba, w, h) {
    const out = [];
    const t = trim(rgba, w, h);
    if (t) {
      out.push(t);
      // a pixel or two of slack each way, since the trim edge is a threshold not a fact
      for (const d of [1, 2]) {
        out.push({
          x: Math.max(0, t.x - d), y: Math.max(0, t.y - d),
          w: Math.min(w - Math.max(0, t.x - d), t.w + d * 2),
          h: Math.min(h - Math.max(0, t.y - d), t.h + d * 2),
        });
      }
    }
    for (const inset of [0, 0.12, 0.24]) {
      const dx = Math.round(w * inset), dy = Math.round(h * inset);
      const cw = w - dx * 2, ch = h - dy * 2;
      if (cw < 6 || ch < 6) continue;
      out.push({ x: dx, y: dy, w: cw, h: ch });
    }
    return out;
  }

  /**
   * @param {{data:number[]|Uint8ClampedArray, w:number, h:number}} shot  RGBA crop of the icon
   * @param {{n:number, icons:Array}} bank  parsed currency-icons.json
   * @returns {{family:string|null, members:string[], score:number, margin:number, all:Array}}
   */
  function identify(shot, bank) {
    const none = { family: null, members: [], score: 0, margin: 0, all: [] };
    if (!shot || !shot.w || !shot.h || !bank || !bank.icons || !bank.icons.length) return none;
    const rgba = shot.data instanceof Uint8ClampedArray ? shot.data : Uint8ClampedArray.from(shot.data);
    const n = bank.n || 24;

    const best = new Map(); // family -> best score across all crops
    for (const box of crops(rgba, shot.w, shot.h)) {
      const sig = signature(rgba, shot.w, shot.h, box, n);
      for (const ic of bank.icons) {
        const s = ncc(sig, ic.rgb, ic.cov);
        const prev = best.get(ic.family);
        if (!prev || s > prev.score) best.set(ic.family, { icon: ic, score: s });
      }
    }

    const ranked = [...best.values()].sort((a, b) => b.score - a.score);
    if (!ranked.length) return none;
    const top = ranked[0], second = ranked[1];
    const margin = second ? top.score - second.score : 1;
    const all = ranked.slice(0, 5).map((r) => ({ family: r.icon.family, name: r.icon.members[0], score: r.score }));
    const clear = !second || (margin >= MIN_MARGIN && top.score >= second.score * MIN_RATIO);
    if (top.score < MIN_SCORE || !clear) {
      return { family: null, members: [], score: top.score, margin, all };
    }
    return { family: top.icon.family, members: top.icon.members, score: top.score, margin, all };
  }

  /**
   * Resolve a family to one currency using the tier word read beside it.
   * families with one member need no word at all.
   * @param {string[]} members  every currency drawn with this icon
   * @param {string|null} tier  'greater' | 'perfect' | null (base tier)
   */
  function resolveTier(members, tier) {
    if (!members || !members.length) return null;
    if (members.length === 1) return members[0];
    const want = tier ? String(tier).toLowerCase() : null;
    const base = members.filter((m) => !/^(greater|perfect|lesser)\b/i.test(m));
    if (!want) return base.length === 1 ? base[0] : null;
    const hit = members.filter((m) => new RegExp('^' + want + '\\b', 'i').test(m));
    return hit.length === 1 ? hit[0] : null;
  }

  return { identify, resolveTier, signature, ncc, MIN_SCORE, MIN_MARGIN };
});
