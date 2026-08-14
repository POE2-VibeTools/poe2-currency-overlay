'use strict';
// Cut the three example shots for the reprice sample-submission UI out of the 1440x900
// digit-corpus captures. These ship with the app: each shows the Set Item Price dialog
// with the wanted number typed and highlighted, which is exactly what a submitted shot
// has to look like.
//
//   npx electron dev/make-reprice-examples.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'dialog-captures');
const OUT = path.join(__dirname, '..', 'renderer', 'reprice-examples');
// one rect fits all three: the dialog is centred and these captures share one item
const RECT = { x: 440, y: 330, width: 580, height: 390 };
const CUTS = [
  ['digits-1440-12345.png', '12345.png'],
  ['digits-1440-6789.png', '6789.png'],
  ['digits-1440-0.png', '0.png'],
];

app.whenReady().then(() => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [src, dst] of CUTS) {
    const img = nativeImage.createFromPath(path.join(DIR, src));
    if (!img.getSize().width) { console.log('missing ' + src); continue; }
    // downscaled: it is a visual example, not a template source, and three full-res
    // crops of scenery cost ~900KB of installer for nothing
    const png = img.crop(RECT).resize({ width: 420, quality: 'good' }).toPNG();
    fs.writeFileSync(path.join(OUT, dst), png);
    console.log(dst + '  ' + (png.length / 1024).toFixed(0) + ' KB');
  }
  app.exit(0);
});
