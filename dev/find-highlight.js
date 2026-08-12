'use strict';
// Find the selected-quantity highlight anywhere on a full-screen capture, and report every
// competing blob of the same colour.
//
//   npx electron dev/find-highlight.js [file.png ...]
//
// The point is not just "can it find the highlight" - it is "is this colour unique on a
// screen full of brown fantasy UI". A detector that works on a two-digit price and then
// latches onto a wall texture when the price is a single "1" is worse than no detector.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'dialog-captures');

// Measured off real captures: the selection block behind the quantity. Identical value in
// every capture so far, so the tolerance is for capture noise, not for variation.
const HL = { r: 149, g: 100, b: 57 };
const TOL = 26;

function load(file) {
  const img = nativeImage.createFromPath(file);
  const s = img.getSize();
  const bgra = img.toBitmap();
  return { bgra, w: s.width, h: s.height };
}

function isHL(bgra, q) {
  return Math.abs(bgra[q + 2] - HL.r) <= TOL
    && Math.abs(bgra[q + 1] - HL.g) <= TOL
    && Math.abs(bgra[q] - HL.b) <= TOL;
}

// Grow the mask by RAD pixels, then shrink it back. The digits sit ON TOP of the
// selection block and punch holes straight through it, so raw connected components split
// one highlight into slivers - a two-digit price fragmented into a 4x8 crumb that ranked
// below a wall texture. Closing the holes first makes the block a block again.
function close(on, w, h, RAD) {
  const grow = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on[y * w + x]) continue;
      for (let dy = -RAD; dy <= RAD; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -RAD; dx <= RAD; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) grow[yy * w + xx] = 1;
        }
      }
    }
  }
  return grow;
}

// 4-connected blobs of highlight-coloured pixels.
function blobs(im) {
  const { bgra, w, h } = im;
  const raw = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (isHL(bgra, p * 4)) raw[p] = 1;
  const on = close(raw, w, h, 2);
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let i0 = 0; i0 < w * h; i0++) {
    if (!on[i0] || seen[i0]) continue;
    seen[i0] = 1; stack.length = 0; stack.push(i0);
    let x0 = w, x1 = -1, y0 = h, y1 = -1, area = 0;
    while (stack.length) {
      const p = stack.pop();
      const px = p % w, py = (p - px) / w;
      area++;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (px > 0 && on[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (px < w - 1 && on[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (py > 0 && on[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (py < h - 1 && on[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return out;
}

app.whenReady().then(() => {
  const files = process.argv.slice(2).filter((v) => v.endsWith('.png') && !v.includes('electron'));
  const list = files.length ? files : fs.readdirSync(DIR).filter((f) => f.endsWith('.png'));
  for (const f of list) {
    const im = load(path.join(DIR, f));
    const all = blobs(im).sort((a, b) => b.area - a.area);
    // A selection block is a solid horizontal bar roughly the height of a line of text.
    // Solidity is the discriminator, not size. After closing, the selection block is a
    // perfect rectangle - the game fills it. Brown scenery and UI trim that happen to
    // share the colour close into ragged shapes and sit at 0.55-0.85.
    const plausible = all.filter((b) => b.h >= 10 && b.h <= 34 && b.w >= 3 && b.w <= 220
      && b.area >= b.w * b.h * 0.97);
    console.log('\n=== ' + f);
    console.log('  ' + all.length + ' blobs of the highlight colour, '
      + plausible.length + ' shaped like a selection bar');
    for (const b of plausible.slice(0, 8)) {
      console.log('    ' + String(b.w).padStart(4) + 'x' + String(b.h).padStart(3)
        + ' at ' + String(b.x).padStart(5) + ',' + String(b.y).padStart(4)
        + '   fill ' + (b.area / (b.w * b.h)).toFixed(2));
    }
    const big = all.filter((b) => b.area > 40 && !plausible.includes(b)).slice(0, 4);
    if (big.length) {
      console.log('  other blobs over 40px (would compete with a narrow "1"):');
      for (const b of big) {
        console.log('    ' + String(b.w).padStart(4) + 'x' + String(b.h).padStart(3)
          + ' at ' + String(b.x).padStart(5) + ',' + String(b.y).padStart(4) + '  area ' + b.area);
      }
    }
  }
  app.exit(0);
});
