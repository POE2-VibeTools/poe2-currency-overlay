'use strict';
// End to end, with NO calibration: find the dialog on a full-screen capture, read the
// number out of the highlighted field, and identify the currency from the icon beside it.
//
//   npx electron dev/test-dialog-finder.js
//
// These are real screenshots of the game, chosen to differ in the ways that move the
// dialog - a short item against a tall one, two digits against one, and one frame where
// the field is NOT selected, which must come back empty rather than confident.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));
const RR = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-reader.js'));
const CR = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-reader.js'));
const DR = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js'));
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-icons.json'));
const digits = DR.templatesFromJSON(require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digits.json')));

const DIR = path.join(__dirname, 'dialog-captures');
// what each capture should produce; null means "must find nothing"
const EXPECT = {
  'short-highlighted.png': { value: 23, currency: 'divine' },
  'tall-highlighted.png': { value: 60, currency: 'divine' },
  'single-digit.png': { value: 1, currency: 'divine' },
  'short.png': null,
};

function load(file) {
  const img = nativeImage.createFromPath(file);
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

function cut(im, r, pad) {
  const p = pad || 0;
  const x = Math.max(0, r.x - p), y = Math.max(0, r.y - p);
  const w = Math.min(im.w - x, r.w + p * 2), h = Math.min(im.h - y, r.h + p * 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy++) {
    const src = ((y + yy) * im.w + x) * 4;
    out.set(im.rgba.subarray(src, src + w * 4), yy * w * 4);
  }
  return { data: out, w, h };
}

app.whenReady().then(() => {
  let pass = 0, fail = 0;
  for (const file of Object.keys(EXPECT)) {
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) { console.log('missing ' + file); continue; }
    const im = load(full);
    const hit = F.find(im.rgba, im.w, im.h);
    const want = EXPECT[file];

    if (!hit) {
      const ok = want === null;
      console.log((ok ? '  ok   ' : '  FAIL ') + file.padEnd(26) + 'found nothing');
      ok ? pass++ : fail++;
      continue;
    }
    if (want === null) {
      console.log('  FAIL ' + file.padEnd(26) + 'found a block at '
        + hit.block.x + ',' + hit.block.y + ' but the field was not selected');
      fail++;
      continue;
    }

    // the digits sit ON the block, so the block IS the number's box
    const numShot = cut(im, hit.block, 3);
    const r = RR.read({ data: numShot.data, w: numShot.w, h: numShot.h }, digits, 0.55);
    const iconShot = cut(im, hit.icon, 0);
    const m = CR.identify({ data: iconShot.data, w: iconShot.w, h: iconShot.h }, bank);

    const okNum = r.value === want.value;
    const okCur = m.family === want.currency;
    const ok = okNum && okCur;
    console.log((ok ? '  ok   ' : '  FAIL ') + file.padEnd(26)
      + 'block ' + String(hit.block.w).padStart(3) + 'x' + hit.block.h
      + ' at ' + String(hit.block.x).padStart(4) + ',' + String(hit.block.y).padStart(4)
      + '   read ' + String(r.value == null ? 'none' : r.value).padStart(5)
      + '   currency ' + (m.family || 'none').padEnd(9)
      + ' (' + m.score.toFixed(2) + ')'
      + '   ' + hit.candidates + ' candidate(s)');
    if (!okNum) console.log('         wanted ' + want.value + ', text "' + r.text + '"');
    if (!okCur) console.log('         wanted ' + want.currency + ', top: '
      + m.all.map((a) => a.family + ' ' + a.score.toFixed(2)).join(', '));
    ok ? pass++ : fail++;
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  app.exit(fail ? 1 : 0);
});
