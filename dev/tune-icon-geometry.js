'use strict';
// Sweep the icon box's offset and size against every real capture at once.
//
//   npx electron dev/tune-icon-geometry.js
//
// The box is derived from the highlight block, so one pair of numbers has to work at
// every resolution. Tuning it against a single capture is how it ended up right at 1080p
// fullscreen and wrong in a 1600x1200 window.
const { app, nativeImage } = require('electron');
const path = require('path');
const CR = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-reader.js'));
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-icons.json'));

const DIR = path.join(__dirname, 'dialog-captures');
const CASES = [
  ['short-highlighted.png', 'divine'],
  ['tall-highlighted.png', 'divine'],
  ['single-digit.png', 'divine'],
  ['res1600-tall-single.png', 'divine'],
  ['res1440-offcenter.png', 'divine'],
  ['digits-1440-12345.png', 'divine'],
  ['digits-1440-6789.png', 'divine'],
  ['digits-1440-0.png', 'divine'],
  ['digits-1600-12345.png', 'divine'],
  ['digits-1600-6789.png', 'divine'],
  ['digits-1600-0.png', 'divine'],
];

function load(file) {
  const img = nativeImage.createFromPath(path.join(DIR, file));
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

function cut(im, r) {
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  const w = Math.min(im.w - x, r.w), h = Math.min(im.h - y, r.h);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy++) {
    const src = ((y + yy) * im.w + x) * 4;
    out.set(im.rgba.subarray(src, src + w * 4), yy * w * 4);
  }
  return { data: out, w, h };
}

app.whenReady().then(() => {
  const frames = CASES.map(([f, want]) => ({ f, want, im: load(f) }));
  for (const fr of frames) fr.hit = F.find(fr.im.rgba, fr.im.w, fr.im.h);

  const results = [];
  for (let cx = 2.7; cx <= 3.3; cx += 0.06) {
    for (let size = 0.8; size <= 1.4; size += 0.05) {
      let ok = 0; let worst = 9; const detail = [];
      for (const fr of frames) {
        if (!fr.hit) continue;
        const b = fr.hit.block;
        const sz = Math.round(size * b.h);
        const r = {
          x: Math.round(b.x + cx * b.h - sz / 2),
          y: Math.round(b.y + b.h / 2 - sz / 2),
          w: sz, h: sz,
        };
        const shot = cut(fr.im, r);
        const m = CR.identify(shot, bank);
        const good = m.family === fr.want;
        if (good) { ok++; worst = Math.min(worst, m.score); }
        detail.push((good ? '' : '!') + (m.family || 'none'));
      }
      results.push({ cx, size, ok, worst: ok === frames.length ? worst : 0, detail });
    }
  }
  results.sort((a, b) => (b.ok - a.ok) || (b.worst - a.worst));
  console.log('cx    size   passes  weakest   ');
  for (const r of results.slice(0, 12)) {
    console.log('  ' + r.cx.toFixed(2) + '  ' + r.size.toFixed(2)
      + '    ' + r.ok + '/' + frames.length
      + '    ' + (r.worst ? r.worst.toFixed(3) : '  -  ')
      + '   ' + r.detail.join(' '));
  }
  app.exit(0);
});
