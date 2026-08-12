'use strict';
// Show, for one capture, exactly what the digit reader is looking at and what each
// template scores against it.
//
//   npx electron dev/debug-read.js <capture.png>
const { app, nativeImage } = require('electron');
const path = require('path');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));
const RR = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-reader.js'));
const DR = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js'));
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digit-sets.json'));

const file = process.argv.slice(2).find((a) => a.endsWith('.png')) || 'digits-1440-0.png';

function load(f) {
  const img = nativeImage.createFromPath(path.join(__dirname, 'dialog-captures', f));
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

app.whenReady().then(() => {
  const im = load(file);
  const hit = F.find(im.rgba, im.w, im.h);
  if (!hit) { console.log('no dialog'); return app.exit(1); }
  const b = hit.block;
  const pad = 3;
  const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
  const crop = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy++) {
    const src = ((y + yy) * im.w + x) * 4;
    crop.set(im.rgba.subarray(src, src + w * 4), yy * w * 4);
  }
  console.log(file + '   block ' + b.w + 'x' + b.h + ' at ' + b.x + ',' + b.y + '   crop ' + w + 'x' + h);

  const V = RR.valueChannel(crop, w, h);
  const t1 = DR.otsu(V);
  const up = V.filter((v) => v > t1);
  const t2 = up.length > 16 ? DR.otsu(up) : t1;
  console.log('thresholds: t1=' + t1 + '  t2=' + t2);

  for (const [name, cut] of [['t2', t2], ['t1', t1]]) {
    console.log('\n--- mask at ' + name + ' (' + cut + ')');
    for (let yy = 0; yy < h; yy++) {
      let row = '';
      for (let xx = 0; xx < w; xx++) row += V[yy * w + xx] > cut ? '#' : '.';
      console.log('   ' + row);
    }
  }

  for (const set of bank.sets) {
    const templates = DR.templatesFromJSON({ templates: set.glyphs });
    const r = RR.read({ data: crop, w, h }, templates, 0.55);
    console.log('\nset h' + set.blockH + '  -> ' + (r.value == null ? 'none' : r.value)
      + '   scores ' + r.scores.map((s) => s.toFixed(2)).join(','));
    // what does each template score against the whole ink span, resized?
    const comps = RR.glyphs(V, w, h);
    console.log('  segmentation found ' + comps.length + ' component(s): '
      + comps.map((c) => c.mask.w + 'x' + c.mask.h + '@' + c.x).join(' '));
    for (const c of comps) {
      const row = Object.keys(templates).map((ch) => {
        const t = templates[ch];
        const ar = (c.mask.w / c.mask.h) / (t.w / t.h);
        if (ar < 0.6 || ar > 1.66) return ch + ':--';
        const s = RR.classify(c.mask, { [ch]: t });
        return ch + ':' + s.score.toFixed(2);
      }).join('  ');
      console.log('    glyph ' + c.mask.w + 'x' + c.mask.h + '   ' + row);
    }
  }
  app.exit(0);
});
