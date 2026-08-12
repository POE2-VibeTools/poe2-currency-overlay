'use strict';
// Render a captured crop next to a baked template at the same size, so a mismatch can be
// SEEN instead of inferred from a correlation number.
//
//   npx electron dev/compare-icon.js <family> [cropFile]
//
// Writes dev/icon-compare.png: capture on the left, template on the right, both scaled to
// the same box. If the two look like the same picture, the problem is the scoring; if they
// do not, the problem is the art or the framing.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-icons.json'));

const DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'poe2-price-overlay', 'icon-diag');
const OUT = path.join(__dirname, 'icon-compare.png');
const FAM = process.argv[2] && !process.argv[2].endsWith('.js') ? process.argv[2] : 'divine';
const CELL = 160;

function load(file) {
  const img = nativeImage.createFromPath(file);
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { data: rgba, w: s.width, h: s.height };
}

app.whenReady().then(() => {
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort() : [];
  const pick = process.argv[3] || files[files.length - 1];
  if (!pick) { console.log('no crop to compare'); return app.exit(1); }
  const cap = load(path.join(DIR, pick));
  const icon = bank.icons.find((i) => i.family === FAM);
  if (!icon) { console.log('no such family: ' + FAM); return app.exit(1); }
  const N = bank.n;

  const W = CELL * 2, H = CELL;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      let r, g, b;
      if (x < CELL) {                                  // left: the capture
        const sx = Math.min(cap.w - 1, Math.floor(x * cap.w / CELL));
        const sy = Math.min(cap.h - 1, Math.floor(y * cap.h / CELL));
        const q = (sy * cap.w + sx) * 4;
        r = cap.data[q]; g = cap.data[q + 1]; b = cap.data[q + 2];
      } else {                                         // right: the template, over the same dark field
        const gx = Math.min(N - 1, Math.floor((x - CELL) * N / CELL));
        const gy = Math.min(N - 1, Math.floor(y * N / CELL));
        const gi = gy * N + gx, a = icon.cov[gi] / 255;
        r = icon.rgb[gi * 3] * a + 26 * (1 - a);
        g = icon.rgb[gi * 3 + 1] * a + 22 * (1 - a);
        b = icon.rgb[gi * 3 + 2] * a + 18 * (1 - a);
      }
      out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
    }
  }
  // nativeImage wants BGRA
  const bgra = Buffer.alloc(W * H * 4);
  for (let i = 0; i < out.length; i += 4) {
    bgra[i] = out[i + 2]; bgra[i + 1] = out[i + 1]; bgra[i + 2] = out[i]; bgra[i + 3] = 255;
  }
  fs.writeFileSync(OUT, nativeImage.createFromBuffer(bgra, { width: W, height: H }).toPNG());
  console.log('capture ' + cap.w + 'x' + cap.h + ' (' + pick + ')  vs  ' + icon.members[0]);
  console.log(OUT);
  app.exit(0);
});
