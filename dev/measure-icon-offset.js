'use strict';
// Where is the currency icon, really, relative to the selection block?
//
//   npx electron dev/measure-icon-offset.js
//
// The icon box has been positioned by ratios guessed from one or two captures twice now,
// and been wrong at a third size both times. This measures it on every capture instead:
// find the block, look to its right, and report the icon's bounding box in units of the
// block's own height - which is the only unit that can survive a resolution change.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));

const DIR = path.join(__dirname, 'dialog-captures');

function load(f) {
  const img = nativeImage.createFromPath(path.join(DIR, f));
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

app.whenReady().then(() => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png') && f !== 'short.png');
  for (const f of files) {
    const im = load(f);
    const hit = F.find(im.rgba, im.w, im.h);
    if (!hit) continue;
    const b = hit.block, H = b.h;

    // Look along the row the block sits on, out to six block-heights right of it.
    const y0 = Math.max(0, Math.round(b.y + H / 2 - H));
    const y1 = Math.min(im.h - 1, Math.round(b.y + H / 2 + H));
    const xa = b.x, xb = Math.min(im.w - 1, Math.round(b.x + 6 * H));

    // Per column: how much of it is clearly brighter than the dropdown's dark interior.
    // The icon is a solid run of such columns; the name text after it is a run too, but a
    // gap separates them.
    const cols = [];
    for (let x = xa; x <= xb; x++) {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        const p = (y * im.w + x) * 4;
        const lum = 0.299 * im.rgba[p] + 0.587 * im.rgba[p + 1] + 0.114 * im.rgba[p + 2];
        if (lum > 60) n++;
      }
      cols.push(n);
    }
    let row = '';
    for (const n of cols) row += n === 0 ? '.' : (n < 4 ? ':' : (n < 10 ? '+' : '#'));
    console.log('\n=== ' + f + '   block ' + b.w + 'x' + H + ' at ' + b.x + ',' + b.y);
    console.log('   ' + row);
    // ruler in block-heights from the block's left edge
    let ruler = '';
    for (let i = 0; i < cols.length; i++) {
      const u = i / H;
      ruler += (Math.abs(u - Math.round(u)) < 0.5 / H) ? String(Math.round(u) % 10) : ' ';
    }
    console.log('   ' + ruler);
  }
  app.exit(0);
});
