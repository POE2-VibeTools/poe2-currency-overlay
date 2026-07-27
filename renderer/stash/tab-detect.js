'use strict';
// Template-match tab detector. Fill/darkness/resolution-robust: the user calibrates a
// box over the stash panel border once; we downsample that box to a fixed thumbnail,
// take its edge (frame) structure, and normalized-correlate against a baked template
// per tab. The tab whose layout matches wins - no per-cell detection at runtime.
// Cell read-positions are then just the matched tab's reference coords scaled into the
// live calibration box. Pure JS (typed arrays) so it runs in the reader worker thread.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).tabDetect = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Edge-structure signature of a panel box: box-downsample the region to TWxTH grayscale,
  // gradient magnitude, mean-subtract + L2-normalize. buf = RGBA/BGRA bitmap (order-agnostic
  // since we average all three). Returns Float64Array(TW*TH).
  function panelSignature(buf, W, H, box, TW, TH) {
    const gray = new Float64Array(TW * TH);
    for (let oy = 0; oy < TH; oy++) {
      const sy0 = Math.floor(box.y + oy * box.h / TH), sy1 = Math.max(sy0 + 1, Math.floor(box.y + (oy + 1) * box.h / TH));
      for (let ox = 0; ox < TW; ox++) {
        const sx0 = Math.floor(box.x + ox * box.w / TW), sx1 = Math.max(sx0 + 1, Math.floor(box.x + (ox + 1) * box.w / TW));
        let s = 0, n = 0;
        for (let y = sy0; y < sy1; y++) {
          if (y < 0 || y >= H) continue;
          for (let x = sx0; x < sx1; x++) {
            if (x < 0 || x >= W) continue;
            const p = (y * W + x) * 4; s += buf[p] + buf[p + 1] + buf[p + 2]; n++;
          }
        }
        gray[oy * TW + ox] = n ? s / (3 * n) : 0;
      }
    }
    const e = new Float64Array(TW * TH); let mean = 0;
    for (let y = 1; y < TH - 1; y++) for (let x = 1; x < TW - 1; x++) {
      const i = y * TW + x;
      e[i] = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + TW] - gray[i - TW]);
      mean += e[i];
    }
    mean /= (TW * TH);
    let ss = 0; for (let i = 0; i < e.length; i++) { e[i] -= mean; ss += e[i] * e[i]; }
    const norm = Math.sqrt(ss) || 1; for (let i = 0; i < e.length; i++) e[i] /= norm;
    return e;
  }

  function ncc(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // Detect which tab. `data` = the baked tab-templates.json (box, tw, th, scale, templates).
  // Returns { tab, score, runnerUp, runnerScore } or null.
  function detect(buf, W, H, calBox, data) {
    const sig = panelSignature(buf, W, H, calBox, data.tw, data.th);
    const ranked = [];
    for (const tab of Object.keys(data.templates)) {
      const t = data.templates[tab];
      // rehydrate int-scaled template to normalized floats
      const tf = new Float64Array(t.length); let ss = 0;
      for (let i = 0; i < t.length; i++) { tf[i] = t[i]; ss += t[i] * t[i]; }
      const nrm = Math.sqrt(ss) || 1; for (let i = 0; i < tf.length; i++) tf[i] /= nrm;
      ranked.push({ tab, score: ncc(sig, tf) });
    }
    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length) return null;
    return { tab: ranked[0].tab, score: ranked[0].score, runnerUp: ranked[1] && ranked[1].tab, runnerScore: ranked[1] ? ranked[1].score : 0 };
  }

  // Map a reference-space cell position into live coords given the calibration box.
  // refBox = the box templates were built in; calBox = the user's calibrated box.
  function scalePos(cx, cy, refBox, calBox) {
    return {
      cx: Math.round(calBox.x + (cx - refBox.x) * calBox.w / refBox.w),
      cy: Math.round(calBox.y + (cy - refBox.y) * calBox.h / refBox.h),
    };
  }

  return { panelSignature, ncc, detect, scalePos };
});
