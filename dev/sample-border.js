'use strict';
// Print the actual colours along the field border in an auto-miss crop.
//
//   npx electron dev/sample-border.js <stamp_auto-miss> <x> <y> <w> <h>
//
// x,y,w,h bound the field roughly, in crop pixels; rows above/below and the columns are
// scanned for the brightest line, and its colours printed.
const { app, nativeImage } = require('electron');
const path = require('path');
const os = require('os');

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('sample-border.js'));
const dir = path.join(process.env.APPDATA || os.homedir(), 'poe2-price-overlay', 'read-diag');
const [base, X, Y, W, H] = [a[0], +a[1], +a[2], +a[3], +a[4]];

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(path.join(dir, base + '.png'));
  const s = img.getSize();
  const bb = img.toBitmap();
  const px = (x, y) => {
    const p = (y * s.width + x) * 4;
    return [bb[p + 2], bb[p + 1], bb[p]];   // BGRA -> RGB
  };
  // brightest row in the strip above the top edge
  for (let y = Y - 4; y <= Y + 4; y++) {
    const mid = px(Math.round(X + W / 2), y);
    console.log('row y' + y + '  mid rgb(' + mid.join(',') + ')');
  }
  console.log('---');
  for (let x = X - 4; x <= X + 4; x++) {
    const mid = px(x, Math.round(Y + H / 2));
    console.log('col x' + x + '  mid rgb(' + mid.join(',') + ')');
  }
  app.exit(0);
});
