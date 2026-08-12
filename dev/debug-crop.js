'use strict';
// Run the digit reader over a crop the app itself saved, and show its working.
//
//   npx electron dev/debug-crop.js <path-to-crop.png>
//
// The crops in %APPDATA%/poe2-price-overlay/read-diag are exactly what the reader was
// handed, so this reproduces a misread without needing the game open.
const { app, nativeImage } = require('electron');
const path = require('path');
const RR = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-reader.js'));
const DR = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js'));
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digit-sets.json'));

const file = process.argv.slice(2).find((a) => a.endsWith('.png'));

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(file);
  const s = img.getSize();
  if (!s.width) { console.log('could not read ' + file); return app.exit(1); }
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  const w = s.width, h = s.height;
  // the crop is the block plus 3px of padding on every side
  console.log(path.basename(file) + '   crop ' + w + 'x' + h + '   implied block h' + (h - 6));

  const V = RR.valueChannel(rgba, w, h);
  const t1 = DR.otsu(V);
  const up = V.filter((v) => v > t1);
  const t2 = up.length > 16 ? DR.otsu(up) : t1;
  console.log('thresholds t1=' + t1 + ' t2=' + t2 + '\n');
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += V[y * w + x] > t2 ? '#' : '.';
    console.log('   ' + row);
  }

  const comps = RR.glyphs(V, w, h);
  console.log('\nsegmentation: ' + comps.length + ' component(s) '
    + comps.map((c) => c.mask.w + 'x' + c.mask.h + '@' + c.x).join(' '));

  for (const set of bank.sets) {
    const templates = DR.templatesFromJSON({ templates: set.glyphs });
    const r = RR.read({ data: rgba, w, h }, templates, 0.55);
    console.log('  set h' + set.blockH + ' -> ' + (r.value == null ? 'none' : r.value)
      + '   scores ' + r.scores.map((v) => v.toFixed(2)).join(','));
    for (const c of comps) {
      const best = RR.classify(c.mask, templates);
      console.log('      glyph ' + c.mask.w + 'x' + c.mask.h + ' -> ' + best.ch + ' ' + best.score.toFixed(2));
      // Print the captured glyph beside the template it should have matched. A number
      // says a match failed; seeing both says why.
      if (best.score < 0.55 && process.env.SHOW) {
        const t = templates[process.env.SHOW];
        if (t) {
          const rows = Math.max(c.mask.h, t.h);
          console.log('        captured            template "' + process.env.SHOW + '"');
          for (let y = 0; y < rows; y++) {
            let a = '', b = '';
            for (let x = 0; x < c.mask.w; x++) a += (y < c.mask.h && c.mask.data[y * c.mask.w + x]) ? '#' : '.';
            for (let x = 0; x < t.w; x++) b += (y < t.h && t.data[y * t.w + x]) ? '#' : '.';
            console.log('        ' + a.padEnd(20) + b);
          }
        }
      }
    }
  }
  app.exit(0);
});
