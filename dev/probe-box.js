'use strict';
// Can the BOX around the highlight be found by scanning outward from it?
//
//   npx electron dev/probe-box.js
//
// The highlight is located reliably by colour. What colour cannot do is tell a price field
// from a lump of brown scenery, or say where the currency icon is. Both of those are
// structure: the highlight sits INSIDE a bordered box, and the icon sits in the NEXT box
// along. This checks whether those borders can actually be found from the highlight.
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
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png') && f !== 'short.png').sort();
  for (const f of files) {
    const im = load(f);
    const hit = F.find(im.rgba, im.w, im.h);
    if (!hit) { console.log(f + ': no highlight'); continue; }
    const b = hit.block;
    const lum = (x, y) => {
      const p = (y * im.w + x) * 4;
      return 0.299 * im.rgba[p] + 0.587 * im.rgba[p + 1] + 0.114 * im.rgba[p + 2];
    };
    const cy = Math.round(b.y + b.h / 2);
    const cx = Math.round(b.x + b.w / 2);

    // Scan outward for the first sustained bright line in each direction. "Sustained"
    // means the pixel and its neighbours along the line are bright too - a single bright
    // pixel is noise, a border is continuous.
    const bright = (x, y) => lum(x, y) > 85;
    const colIsBorder = (x) => {
      let n = 0;
      for (let y = cy - Math.round(b.h * 0.4); y <= cy + Math.round(b.h * 0.4); y++) if (bright(x, y)) n++;
      return n >= b.h * 0.6;
    };
    const rowIsBorder = (y) => {
      let n = 0;
      for (let x = b.x; x <= b.x + b.w; x++) if (bright(x, y)) n++;
      return n >= b.w * 0.8;
    };

    let left = null, right = null, top = null, bottom = null;
    for (let d = 2; d < b.h * 4; d++) { if (colIsBorder(b.x - d)) { left = b.x - d; break; } }
    for (let d = 2; d < b.h * 6; d++) { if (colIsBorder(b.x + b.w + d)) { right = b.x + b.w + d; break; } }
    for (let d = 2; d < b.h * 2; d++) { if (rowIsBorder(b.y - d)) { top = b.y - d; break; } }
    for (let d = 2; d < b.h * 2; d++) { if (rowIsBorder(b.y + b.h + d)) { bottom = b.y + b.h + d; break; } }

    const box = (left != null && right != null && top != null && bottom != null)
      ? { x: left, y: top, w: right - left + 1, h: bottom - top + 1 } : null;

    // and the next vertical border to the right of that box - the dropdown's left edge
    let next = null;
    if (box) {
      for (let d = 2; d < box.h * 4; d++) {
        const x = box.x + box.w + d;
        if (x >= im.w) break;
        if (colIsBorder(x)) { next = x; break; }
      }
    }
    console.log(f.padEnd(26)
      + 'hl ' + String(b.w).padStart(3) + 'x' + b.h
      + '   box ' + (box ? String(box.w).padStart(3) + 'x' + box.h + ' at ' + box.x + ',' + box.y : 'NOT FOUND')
      + (box ? '   aspect ' + (box.w / box.h).toFixed(2) : '')
      + '   next border ' + (next != null ? '+' + (next - (box.x + box.w)) + 'px' : 'none'));
  }
  app.exit(0);
});
