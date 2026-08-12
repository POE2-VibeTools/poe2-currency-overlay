'use strict';
// Crop and magnify part of a capture, so a detail can actually be looked at.
//
//   npx electron dev/crop.js <file.png> <x> <y> <w> <h> [zoom]
//
// Writes dev/crop-out.png.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const a = process.argv.slice(2).filter((v) => !v.endsWith('electron.exe') && !v.endsWith('crop.js'));
const [file, X, Y, W, H, Z] = [a[0], +a[1], +a[2], +a[3], +a[4], +(a[5] || 4)];

app.whenReady().then(() => {
  const src = file.includes(path.sep) || file.includes('/') ? file : path.join(__dirname, 'dialog-captures', file);
  const img = nativeImage.createFromPath(src);
  const s = img.getSize();
  if (!s.width) { console.log('could not read ' + src); return app.exit(1); }
  const bgra = img.toBitmap();
  const ow = W * Z, oh = H * Z;
  const out = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(s.width - 1, X + Math.floor(x / Z));
      const sy = Math.min(s.height - 1, Y + Math.floor(y / Z));
      const q = (sy * s.width + sx) * 4, p = (y * ow + x) * 4;
      out[p] = bgra[q]; out[p + 1] = bgra[q + 1]; out[p + 2] = bgra[q + 2]; out[p + 3] = 255;
    }
  }
  const dst = path.join(__dirname, 'crop-out.png');
  fs.writeFileSync(dst, nativeImage.createFromBuffer(out, { width: ow, height: oh }).toPNG());
  console.log('source ' + s.width + 'x' + s.height + '  crop ' + W + 'x' + H + ' at ' + X + ',' + Y + ' x' + Z);
  console.log(dst);
  app.exit(0);
});
