'use strict';
// What the two finders make of one capture.
//
//   npx electron dev/probe-frame.js <file.png>
//
// Answers the only question that matters when a read fails on a real screen: did the row
// finder locate the field at all, and if it did, did the dialog finder get a selection
// block and an icon out of it.
const { app, nativeImage } = require('electron');
const path = require('path');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));
const RF = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-row-finder.js'));

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('probe-frame.js'));
const file = a[0];

app.whenReady().then(() => {
  const src = file.includes('/') || file.includes('\\') ? file
    : path.join(__dirname, 'dialog-captures', file);
  const img = nativeImage.createFromPath(src);
  const s = img.getSize();
  if (!s.width) { console.log('could not read ' + src); return app.exit(1); }
  const b = img.toBitmap();
  const rgba = new Uint8ClampedArray(b.length);
  for (let i = 0; i < b.length; i += 4) {
    rgba[i] = b[i + 2]; rgba[i + 1] = b[i + 1]; rgba[i + 2] = b[i]; rgba[i + 3] = b[i + 3];
  }
  console.log(s.width + 'x' + s.height);
  const row = RF.find(rgba, s.width, s.height);
  console.log('  row finder   : ' + (row ? JSON.stringify(row.quantity) : 'NOTHING'));
  const hit = F.find(rgba, s.width, s.height);
  console.log('  dialog finder: ' + (hit
    ? 'box ' + JSON.stringify(hit.quantity) + '  block ' + JSON.stringify(hit.block)
      + '  icon ' + JSON.stringify(hit.icon)
    : 'NOTHING'));
  app.exit(0);
});
