'use strict';
// What happens at a resolution we have no templates for.
//
//   npx electron dev/test-offscale-guard.js
//
// There are more resolutions than anyone can sit down and capture, so the behaviour that
// matters is what happens at one we have never seen. Measured: the 1080p set reads a
// windowed "12345" as "888" - it does not fail, it succeeds wrongly, and a wrong number
// goes on the clipboard and into a real listing.
//
// The read is NOT blocked - nobody can capture every resolution, and refusing would turn
// "we have not tested your monitor" into "the feature is broken" for people we never hear
// from. The badge shows the number before anything is pasted, so a bad read is visible.
//
// What this pins down is that the mismatch is DETECTED, so those crops can be collected
// the way the Net Worth panel samples were. It records what the wrong-scale set actually
// says, which is the evidence for why detection matters at all.
const { app, nativeImage } = require('electron');
const path = require('path');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));
const RR = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-reader.js'));
const DR = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js'));
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digit-sets.json'));

const DIR = path.join(__dirname, 'dialog-captures');
const RP_SCALE_TOL = 0.06;
const RP_OFFSCALE_MIN = 0.82;

// capture -> the price actually on screen, and the set that does NOT belong to it
const CASES = [
  ['digits-1440-12345.png', 12345, 21],
  ['digits-1440-6789.png', 6789, 21],
  ['digits-1600-12345.png', 12345, 21],
  ['short-highlighted.png', 23, 19],
];

function load(f) {
  const img = nativeImage.createFromPath(path.join(DIR, f));
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

function cut(im, r, pad) {
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  const w = Math.min(im.w - x, r.w + pad * 2), h = Math.min(im.h - y, r.h + pad * 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy++) {
    const src = ((y + yy) * im.w + x) * 4;
    out.set(im.rgba.subarray(src, src + w * 4), yy * w * 4);
  }
  return { data: out, w, h };
}

app.whenReady().then(() => {
  let pass = 0, fail = 0;
  for (const [file, truth, wrongSetH] of CASES) {
    const im = load(file);
    const hit = F.find(im.rgba, im.w, im.h);
    if (!hit) { console.log('  no dialog in ' + file); fail++; continue; }
    const shot = cut(im, hit.block, 3);
    const entry = bank.sets.find((s) => s.blockH === wrongSetH);
    if (!entry) { console.log('  no set h' + wrongSetH); fail++; continue; }
    const templates = DR.templatesFromJSON({ templates: entry.glyphs });

    // what the mismatched set says at the normal floor
    const naive = RR.read(shot, templates, 0.55);
    // ...and with the guard applied, because the block height matches no cut scale
    const known = Math.abs(entry.blockH - hit.block.h) / hit.block.h <= RP_SCALE_TOL;
    const guarded = RR.read(shot, templates, known ? 0.55 : RP_OFFSCALE_MIN);

    const naiveTxt = naive.value == null ? 'nothing' : String(naive.value);
    const guardTxt = guarded.value == null ? 'nothing' : String(guarded.value);
    // The check is on DETECTION, not on the answer: an off-scale read is allowed through,
    // but it has to be known to be off-scale.
    const ok = !known;
    console.log((ok ? '  ok   ' : '  FAIL ') + file.padEnd(26)
      + 'truth ' + String(truth).padStart(5)
      + '   block h' + hit.block.h + ' vs set h' + entry.blockH + (known ? ' (in range)' : ' (off scale)')
      + '   reads ' + naiveTxt.padStart(7)
      + '   ' + (known ? 'TRUSTED' : 'flagged for collection'));
    ok ? pass++ : fail++;
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  app.exit(fail ? 1 : 0);
});
