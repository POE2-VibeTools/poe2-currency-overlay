'use strict';
// Print pixel colours along a row and a column of any PNG.
//
//   npx electron dev/sample-file-colors.js <file> <x0> <x1> <y0> <y1> <rowY> <colX>
const { app, nativeImage } = require('electron');
const path = require('path');

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('sample-file-colors.js'));
const [file, X0, X1, Y0, Y1, ROWY, COLX] = [a[0], +a[1], +a[2], +a[3], +a[4], +a[5], +a[6]];

app.whenReady().then(() => {
  const src = file.includes('/') || file.includes('\\') ? file : path.join(__dirname, 'dialog-captures', file);
  const img = nativeImage.createFromPath(src);
  const s = img.getSize();
  const bb = img.toBitmap();
  const px = (x, y) => {
    const p = (y * s.width + x) * 4;
    return 'rgb(' + [bb[p + 2], bb[p + 1], bb[p]].join(',') + ')';
  };
  console.log(s.width + 'x' + s.height);
  console.log('-- row y=' + ROWY);
  for (let x = X0; x <= X1; x += 2) console.log('  x' + x + ' ' + px(x, ROWY));
  console.log('-- col x=' + COLX);
  for (let y = Y0; y <= Y1; y++) console.log('  y' + y + ' ' + px(COLX, y));
  app.exit(0);
});
