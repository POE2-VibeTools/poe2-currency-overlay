'use strict';
// Panel-finder box for one capture, fed BGRA (what the worker gets) vs RGBA (what my
// eval used) - the two paths read the same frame differently, so the box is suspect.
const { app, nativeImage } = require('electron');
const path = require('path');
const PF = require(path.join(__dirname, '..', 'renderer', 'stash', 'panel-finder.js'));
const TT = require(path.join(__dirname, '..', 'renderer', 'stash', 'tab-templates.json'));

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(process.argv[process.argv.length-1]);
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  const fB = PF.findPanel(bgra, s.width, s.height);
  const fR = PF.findPanel(rgba, s.width, s.height);
  console.log('refBox :', JSON.stringify(TT.box));
  console.log('BGRA   :', JSON.stringify(fB));
  console.log('RGBA   :', JSON.stringify(fR));
  if (fB) console.log('BGRA content:', JSON.stringify(PF.frameToContent(fB)));
  if (fR) console.log('RGBA content:', JSON.stringify(PF.frameToContent(fR)));
  app.exit(0);
});
