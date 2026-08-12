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
  const MIN_SCORE = 0.55;
  // ...and it has to beat the runner-up by this much. Two orbs scoring 0.71 and 0.70 is
  // not an identification, however high the numbers look.
  const MIN_MARGIN = 0.04;

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

  // Where in the crop the icon might be. A hand-dragged box will not frame the orb the way
  // the alpha trim framed the source art, so try a few insets and keep whichever agrees
  // best. Cheap: 24x24 against 26 templates.
  function crops(w, h) {
    const out = [];
    // Up to a third in from each edge. A box dragged generously round the icon can leave
    // it filling barely half the crop, and a search that stopped at 18% could not reach
    // it - every such case scored just under the bar and reported no match.
    for (const inset of [0, 0.06, 0.12, 0.18, 0.24, 0.30]) {
      const dx = Math.round(w * inset), dy = Math.round(h * inset);
      const cw = w - dx * 2, ch = h - dy * 2;
      if (cw < 6 || ch < 6) continue;
      // centred, plus a nudge each way - the box is usually off by a pixel or two
      for (const [ox, oy] of [[0, 0], [-dx, 0], [dx, 0], [0, -dy], [0, dy]]) {
        const x = Math.max(0, Math.min(w - cw, dx + ox));
        const y = Math.max(0, Math.min(h - ch, dy + oy));
        out.push({ x, y, w: cw, h: ch });
      }
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
    for (const box of crops(shot.w, shot.h)) {
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
    if (top.score < MIN_SCORE || margin < MIN_MARGIN) {
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
