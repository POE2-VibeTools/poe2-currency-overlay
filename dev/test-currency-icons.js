'use strict';
// Confusion check for the baked currency icons.
//
// Run:  npx electron dev/test-currency-icons.js
//
// Composites each icon from its ORIGINAL art - not from the baked 24x24 template - over a
// dropdown-ish background at several sizes, then asks the matcher to name it. Building the
// fake grab from the template instead was the first version of this test, and it was
// unfair: it resampled 24px art up and back down, so the matcher was scored against
// detail no real capture would have lost.
//
// This still does not prove the CDN art matches how the game draws it. Only a live capture
// proves that. What it bounds is the ceiling - two icons that cannot be separated here will
// never be separated on screen.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const CR = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-reader.js'));
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-icons.json'));
const SRC = path.join(__dirname, 'currency-icons');

let seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

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

function alphaBox(im, on) {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    if (im.px[(y * im.w + x) * 4 + 3] >= on) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { x0: 0, y0: 0, x1: im.w - 1, y1: im.h - 1 } : { x0, y0, x1, y1 };
}

// Draw the real art, scaled to `size`, over a dark background with `pad` around it.
function fakeGrab(im, box, size, pad, noise) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const w = size + pad * 2, h = size + pad * 2;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    let r = 26, g = 22, b = 18;                 // the dropdown behind the icon
    const ix = x - pad, iy = y - pad;
    if (ix >= 0 && iy >= 0 && ix < size && iy < size) {
      // area-average the source region falling in this output pixel
      const sx0 = box.x0 + Math.floor(ix * bw / size), sx1 = box.x0 + Math.max(Math.floor((ix + 1) * bw / size), Math.floor(ix * bw / size) + 1);
      const sy0 = box.y0 + Math.floor(iy * bh / size), sy1 = box.y0 + Math.max(Math.floor((iy + 1) * bh / size), Math.floor(iy * bh / size) + 1);
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let yy = sy0; yy < Math.min(sy1, im.h); yy++) for (let xx = sx0; xx < Math.min(sx1, im.w); xx++) {
        const q = (yy * im.w + xx) * 4, al = im.px[q + 3] / 255;
        sr += im.px[q] * al; sg += im.px[q + 1] * al; sb += im.px[q + 2] * al; sa += al; n++;
      }
      if (n) {
        const a = sa / n;
        r = (sr / n) + r * (1 - a); g = (sg / n) + g * (1 - a); b = (sb / n) + b * (1 - a);
      }
    }
    const nz = noise ? (rnd() - 0.5) * noise : 0;
    px[p] = r + nz; px[p + 1] = g + nz; px[p + 2] = b + nz; px[p + 3] = 255;
  }
  return { data: px, w, h };
}

const CASES = [
  { label: 'tiny    16px, tight',     size: 16, pad: 0, noise: 0 },
  { label: 'small   24px, padded',    size: 24, pad: 4, noise: 0 },
  { label: 'medium  32px, padded',    size: 32, pad: 5, noise: 0 },
  { label: 'large   48px, padded',    size: 48, pad: 8, noise: 0 },
  { label: 'noisy   32px, pad+noise', size: 32, pad: 5, noise: 24 },
  { label: 'loose   32px, big pad',   size: 32, pad: 14, noise: 12 },
];

app.whenReady().then(() => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const fileFor = new Map();
  for (const m of manifest) if (!fileFor.has(m.url)) fileFor.set(m.url, m.file);

  // family -> decoded source art
  const art = [];
  for (const ic of bank.icons) {
    const entry = manifest.find((m) => m.key === ic.family);
    if (!entry) continue;
    const im = decode(path.join(SRC, entry.file));
    if (im) art.push({ ic, im, box: alphaBox(im, bank.alphaOn || 96) });
  }

  let hardFails = 0, wrongName = 0;
  for (const cs of CASES) {
    let ok = 0; const fail = [];
    let worst = { m: 9, name: '' };
    for (const a of art) {
      const shot = fakeGrab(a.im, a.box, cs.size, cs.pad, cs.noise);
      const r = CR.identify(shot, bank);
      if (r.family === a.ic.family) {
        ok++;
        if (r.margin < worst.m) worst = { m: r.margin, name: a.ic.members[0] };
      } else {
        const named = r.family ? r.all[0].name : 'no match';
        if (r.family) wrongName++;
        fail.push(a.ic.members[0] + ' -> ' + named + ' (' + r.score.toFixed(2) + ')');
        hardFails++;
      }
    }
    console.log(cs.label.padEnd(26) + ok + '/' + art.length
      + '   tightest margin ' + worst.m.toFixed(3) + ' on ' + worst.name);
    for (const f of fail) console.log('      MISS  ' + f);
  }

  console.log('\nclosest pairs:');
  const pairs = [];
  for (let i = 0; i < bank.icons.length; i++) for (let j = i + 1; j < bank.icons.length; j++) {
    pairs.push({ s: CR.ncc(bank.icons[i].rgb, bank.icons[j].rgb, bank.icons[i].cov),
      a: bank.icons[i].members[0], b: bank.icons[j].members[0] });
  }
  pairs.sort((x, y) => y.s - x.s);
  for (const p of pairs.slice(0, 5)) console.log('  ' + p.s.toFixed(3) + '  ' + p.a + '  vs  ' + p.b);

  console.log('\n' + (hardFails ? hardFails + ' missed (' + wrongName + ' named the WRONG currency)' : 'all identified'));
  app.exit(wrongName ? 1 : 0);
});
