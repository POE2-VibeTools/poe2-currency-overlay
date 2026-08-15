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
const SETS = (() => {
  try {
    const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digit-sets.json'));
    const only = process.env.ONLY_SET ? Number(process.env.ONLY_SET) : null;
    return (bank.sets || [])
      .filter((s) => only == null || s.blockH === only)
      .map((s) => ({ blockH: s.blockH, templates: DR.templatesFromJSON({ templates: s.glyphs }) }));
  } catch {
    return [{ blockH: 0, templates: DR.templatesFromJSON(require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digits.json'))) }];
  }
})();
// same rule as main: every set is tried and the most confident parse wins
function readDigits(shot) {
  let best = { value: null, text: '', scores: [], set: null }, bestScore = -1;
  for (const s of SETS) {
    const r = RR.read(shot, s.templates, 0.55);
    if (r.value == null || !r.scores.length) continue;
    const weakest = Math.min(...r.scores);
    if (weakest > bestScore) { bestScore = weakest; best = Object.assign({}, r, { set: s.blockH }); }
  }
  return best;
}

const DIR = path.join(__dirname, 'dialog-captures');
// what each capture should produce; null means "must find nothing"
const EXPECT = {
  'short-highlighted.png': { value: 23, currency: 'divine' },
  'tall-highlighted.png': { value: 60, currency: 'divine' },
  'single-digit.png': { value: 1, currency: 'divine' },
  // game windowed at 1600x1200 on a 1920x1080 desktop - a different game resolution AND
  // a dialog that is no longer centred on the screen
  'res1600-tall-single.png': { value: 1, currency: 'divine' },
  // game windowed at 1440x900 AND pushed off centre, so the dialog is nowhere near the
  // middle of the screen - this is what the full-frame fallback exists for
  'res1440-offcenter.png': { value: 1, currency: 'divine' },
  // the digit-corpus captures at 1440x900, which is where reads were failing
  'digits-1440-12345.png': { value: 12345, currency: 'divine' },
  'digits-1440-6789.png': { value: 6789, currency: 'divine' },
  "digits-1440-0.png": { value: 0, currency: "divine" },
  // same three prices again at 1600x1200 - a different game resolution that renders the
  // UI at the same physical size, so it exercises the same template set from new pixels
  'digits-1600-12345.png': { value: 12345, currency: 'divine' },
  'digits-1600-6789.png': { value: 6789, currency: 'divine' },
  'digits-1600-0.png': { value: 0, currency: 'divine' },
  // a 2560x1440 monitor running at 150% scaling. The UI is drawn half again as large
  // here - a 27px selection block against 19-21px everywhere else - and it is also the
  // display where the field's left border is simply not painted in the border colour.
  'digits-2560-12345.png': { value: 12345, currency: 'divine' },
  'digits-2560-6789.png': { value: 6789, currency: 'divine' },
  // this one was listed in Chaos, which makes it the only capture in the set that proves
  // the icon match is reading the icon rather than always answering "divine"
  'digits-2560-0.png': { value: 0, currency: 'chaos' },
  // The first REAL user-style submission, through the Settings flow itself: game
  // windowed at 1920x1039 (a taskbar's worth short of fullscreen), which shrinks the
  // UI enough that the field border resamples to ~55% brightness across two rows. The
  // finder's scaled-hue path and the 'w' template set both exist because of these.
  'sub-1039w-12345.png': { value: 12345, currency: 'chaos' },
  'sub-1039w-6789.png': { value: 6789, currency: 'chaos' },
  'sub-1039w-0.png': { value: 0, currency: 'chaos' },
  // true windowed-fullscreen 1920x1080 - all earlier captures were WINDOWED, which
  // renders the dialog smaller. Fullscreen is its own scale: block h23.
  'reprice-fullscreen-12345.png': { value: 12345, currency: 'chaos' },
  'reprice-fullscreen-6789.png': { value: 6789, currency: 'chaos' },
  'reprice-fullscreen-0.png': { value: 0, currency: 'chaos' },
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
    const r = readDigits({ data: numShot.data, w: numShot.w, h: numShot.h });
    // both candidate framings, best score wins - same as main
    let m = CR.identify(cut(im, hit.icon, 0), bank);
    if (hit.iconAlt) {
      const alt = CR.identify(cut(im, hit.iconAlt, 0), bank);
      if (alt.score > m.score) m = alt;
    }

    const okNum = r.value === want.value;
    const okCur = m.family === want.currency;
    const ok = okNum && okCur;
    console.log((ok ? '  ok   ' : '  FAIL ') + file.padEnd(26)
      + 'block ' + String(hit.block.w).padStart(3) + 'x' + hit.block.h
      + ' at ' + String(hit.block.x).padStart(4) + ',' + String(hit.block.y).padStart(4)
      + '   read ' + String(r.value == null ? 'none' : r.value).padStart(5)
      + ' [set h' + r.set + ']'
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
