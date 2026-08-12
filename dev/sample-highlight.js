'use strict';
// Print the dominant colours inside a rectangle of a capture, so the selection
// highlight's actual RGB is measured rather than guessed at from a screenshot.
//
//   npx electron dev/sample-highlight.js <file.png> <x> <y> <w> <h>
const { app, nativeImage } = require('electron');
const path = require('path');

const a = process.argv.slice(2).filter((v) => !v.endsWith('electron.exe') && !v.endsWith('sample-highlight.js'));
const [file, X, Y, W, H] = [a[0], +a[1], +a[2], +a[3], +a[4]];

app.whenReady().then(() => {
  const src = path.join(__dirname, 'dialog-captures', file);
  const img = nativeImage.createFromPath(src);
  const s = img.getSize();
  const bgra = img.toBitmap();
  const bucket = new Map();
  for (let y = Y; y < Y + H && y < s.height; y++) {
    for (let x = X; x < X + W && x < s.width; x++) {
      const q = (y * s.width + x) * 4;
      const r = bgra[q + 2], g = bgra[q + 1], b = bgra[q];
      // quantise so near-identical shades group together
      const k = (r >> 3) + ',' + (g >> 3) + ',' + (b >> 3);
      const e = bucket.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      bucket.set(k, e);
    }
  }
  const rows = [...bucket.values()].sort((p, q) => q.n - p.n).slice(0, 8);
  console.log(file + '  rect ' + W + 'x' + H + ' at ' + X + ',' + Y);
  for (const e of rows) {
    const r = Math.round(e.r / e.n), g = Math.round(e.g / e.n), b = Math.round(e.b / e.n);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    console.log('  ' + String(e.n).padStart(5) + 'px  rgb(' + r + ',' + g + ',' + b + ')'
      + '   sat ' + sat.toFixed(2) + '  warm(r>b) ' + (r - b));
  }
  app.exit(0);
});
