'use strict';
// How far the field's border colour drifts in a LIVE video frame, measured along the
// top and bottom edges. This is the number the finder's tolerance has to cover.
//
//   npx electron dev/measure-border-spread.js <stamp_auto-miss> <x> <y> <w> <h>
const { app, nativeImage } = require('electron');
const path = require('path');
const os = require('os');

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('measure-border-spread.js'));
const dir = path.join(process.env.APPDATA || os.homedir(), 'poe2-price-overlay', 'read-diag');
const [base, X, Y, W, H] = [a[0], +a[1], +a[2], +a[3], +a[4]];
const REF = { r: 182, g: 169, b: 138 };

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(path.join(dir, base + '.png'));
  const s = img.getSize();
  const bb = img.toBitmap();
  const px = (x, y) => {
    const p = (y * s.width + x) * 4;
    return [bb[p + 2], bb[p + 1], bb[p]];
  };
  // For each edge row, scan a couple of pixels vertically for the brightest, since the
  // border may not sit on one exact row across its whole width.
  const scanRow = (yc, label) => {
    let maxDr = 0, maxDg = 0, maxDb = 0, n = 0, miss = 0;
    for (let x = X + 2; x <= X + W - 2; x++) {
      let bestL = -1, best = null;
      for (let y = yc - 1; y <= yc + 1; y++) {
        const c = px(x, y);
        const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        if (l > bestL) { bestL = l; best = c; }
      }
      const dr = Math.abs(best[0] - REF.r), dg = Math.abs(best[1] - REF.g), db = Math.abs(best[2] - REF.b);
      if (dr > maxDr) maxDr = dr;
      if (dg > maxDg) maxDg = dg;
      if (db > maxDb) maxDb = db;
      if (dr > 16 || dg > 16 || db > 16) miss++;
      n++;
    }
    console.log(label + ': ' + n + ' columns, worst dr ' + maxDr + ' dg ' + maxDg + ' db ' + maxDb
      + ', ' + miss + ' fail TOL 16');
  };
  scanRow(Y, 'top edge   ');
  scanRow(Y + H - 1, 'bottom edge');
  // and the verticals
  const scanCol = (xc, label) => {
    let maxDr = 0, maxDg = 0, maxDb = 0, n = 0, miss = 0;
    for (let y = Y + 2; y <= Y + H - 2; y++) {
      let bestL = -1, best = null;
      for (let x = xc - 1; x <= xc + 1; x++) {
        const c = px(x, y);
        const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        if (l > bestL) { bestL = l; best = c; }
      }
      const dr = Math.abs(best[0] - REF.r), dg = Math.abs(best[1] - REF.g), db = Math.abs(best[2] - REF.b);
      if (dr > maxDr) maxDr = dr;
      if (dg > maxDg) maxDg = dg;
      if (db > maxDb) maxDb = db;
      if (dr > 16 || dg > 16 || db > 16) miss++;
      n++;
    }
    console.log(label + ': ' + n + ' rows, worst dr ' + maxDr + ' dg ' + maxDg + ' db ' + maxDb
      + ', ' + miss + ' fail TOL 16');
  };
  scanCol(X, 'left edge  ');
  scanCol(X + W - 1, 'right edge ');
  app.exit(0);
});
