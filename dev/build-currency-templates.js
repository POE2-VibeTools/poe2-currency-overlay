'use strict';
// Turn the downloaded currency art into the small baked file the app matches against.
//
// Run:  npx electron dev/build-currency-templates.js
// (Electron, not plain node - nativeImage is the PNG decoder.)
//
// Three things make the baked form matchable against a live screen grab:
//
//   1. ALPHA-TRIMMED. Source art is padded with transparency; the game draws the visible
//      orb. Trim to the alpha bounding box so both sides frame the same thing.
//   2. SCALE-NORMALISED to a fixed box. GGG appears to size these relative to resolution,
//      so absolute pixel size is not something to depend on. Everything is compared at
//      one size and the capture is resampled to meet it.
//   3. MASKED. Only pixels the art actually paints are compared, so whatever the dropdown
//      draws behind the orb does not enter the score.
//
// Output: renderer/stash/currency-icons.json
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'currency-icons');
const OUT = path.join(__dirname, '..', 'renderer', 'stash', 'currency-icons.json');
const N = 24;             // comparison box, in pixels
const ALPHA_ON = 96;      // below this the source art is treated as background

function decode(file) {
  const img = nativeImage.createFromPath(file);
  const { width: w, height: h } = img.getSize();
  if (!w || !h) return null;
  const bgra = img.toBitmap();
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < bgra.length; i += 4) {
    px[i] = bgra[i + 2]; px[i + 1] = bgra[i + 1]; px[i + 2] = bgra[i]; px[i + 3] = bgra[i + 3];
  }
  return { px, w, h };
}

function alphaBox(im) {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < im.w; x++) {
      if (im.px[(y * im.w + x) * 4 + 3] >= ALPHA_ON) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? { x0: 0, y0: 0, x1: im.w - 1, y1: im.h - 1 } : { x0, y0, x1, y1 };
}

// Area-average downsample of the trimmed region into an N x N RGB + coverage grid.
// Averaging rather than nearest-neighbour matters: these are 60-90px orbs going to 24px,
// and point sampling would keep specular noise instead of the shape.
function signature(im, box) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const rgb = new Float64Array(N * N * 3);
  const cov = new Float64Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    const sy0 = box.y0 + Math.floor(gy * bh / N), sy1 = box.y0 + Math.max(Math.floor((gy + 1) * bh / N), Math.floor(gy * bh / N) + 1);
    for (let gx = 0; gx < N; gx++) {
      const sx0 = box.x0 + Math.floor(gx * bw / N), sx1 = box.x0 + Math.max(Math.floor((gx + 1) * bw / N), Math.floor(gx * bw / N) + 1);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = sy0; y < Math.min(sy1, im.h); y++) {
        for (let x = sx0; x < Math.min(sx1, im.w); x++) {
          const p = (y * im.w + x) * 4, al = im.px[p + 3] / 255;
          r += im.px[p] * al; g += im.px[p + 1] * al; b += im.px[p + 2] * al; a += al; n++;
        }
      }
      const gi = gy * N + gx;
      cov[gi] = n ? a / n : 0;
      // premultiplied average, un-premultiplied back to a colour
      if (a > 0.001) { rgb[gi * 3] = r / a; rgb[gi * 3 + 1] = g / a; rgb[gi * 3 + 2] = b / a; }
    }
  }
  return { rgb, cov };
}

app.whenReady().then(() => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

  // Several currencies legitimately share one art file (the tier families). Bake one
  // entry per DISTINCT image and list every name that wears it - the icon match returns
  // the family, and the tier word is read separately.
  //
  // Grouped by SOURCE URL, not by filename: the fetcher writes one file per currency key,
  // so Chaos/Greater Chaos/Perfect Chaos are three files holding identical bytes. Keying
  // on the filename baked them as three rivals with a correlation of exactly 1.000, which
  // meant they annihilated each other on the margin check and nothing in those families
  // could ever be identified.
  const byFile = new Map();
  for (const m of manifest) {
    const id = m.url || m.file;
    if (!byFile.has(id)) byFile.set(id, []);
    byFile.get(id).push({ key: m.key, text: m.text, file: m.file });
  }

  const out = { n: N, alphaOn: ALPHA_ON, icons: [] };
  let skipped = 0;
  for (const [, members] of byFile) {
    const full = path.join(SRC, members[0].file);
    if (!fs.existsSync(full)) { skipped++; continue; }
    const im = decode(full);
    if (!im) { console.log('  undecodable: ' + members[0].file); skipped++; continue; }
    // base tier first, so members[0] is the name to show when only the family is known
    const rank = (t) => (/^lesser\b/i.test(t) ? 1 : /^greater\b/i.test(t) ? 2 : /^perfect\b/i.test(t) ? 3 : 0);
    members.sort((a, b) => rank(a.text) - rank(b.text));
    const box = alphaBox(im);
    const sig = signature(im, box);

    // Quantise to bytes. Full float precision buys nothing against a screen grab and
    // would triple the file.
    out.icons.push({
      family: members[0].key,
      members: members.map((m) => m.text),
      rgb: Array.from(sig.rgb, (v) => Math.max(0, Math.min(255, Math.round(v)))),
      cov: Array.from(sig.cov, (v) => Math.round(v * 255)),
    });
    const tag = members.length > 1 ? '[' + members.map((m) => m.text.split(' ')[0]).join('/') + ']' : '';
    console.log('  ' + members[0].text.padEnd(32) + (box.x1 - box.x0 + 1) + 'x' + (box.y1 - box.y0 + 1) + '  ' + tag);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('\n' + out.icons.length + ' distinct icons covering '
    + out.icons.reduce((a, i) => a + i.members.length, 0) + ' currencies'
    + (skipped ? ', ' + skipped + ' skipped' : ''));
  console.log(OUT + '  (' + kb + ' KB)');
  app.quit();
});
