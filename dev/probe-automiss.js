'use strict';
// Run the finder on an auto-miss dump: the very crop the live poll searched, framed by
// the very game rectangle it used.
//
//   npx electron dev/probe-automiss.js <stamp_auto-miss> (basename, no extension)
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('probe-automiss.js'));
const dir = path.join(process.env.APPDATA || os.homedir(), 'poe2-price-overlay', 'read-diag');
const base = a[0];

app.whenReady().then(() => {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, base + '.json'), 'utf8'));
  const img = nativeImage.createFromPath(path.join(dir, base + '.png'));
  const s = img.getSize();
  const b = img.toBitmap();
  const crop = new Uint8ClampedArray(b.length);
  for (let i = 0; i < b.length; i += 4) {
    crop[i] = b[i + 2]; crop[i + 1] = b[i + 1]; crop[i + 2] = b[i]; crop[i + 3] = b[i + 3];
  }
  const W = meta.streamW, H = meta.streamH;
  const gr = meta.gameRect && meta.gameRect.w > 0
    ? { x: meta.gameRect.x * W, y: meta.gameRect.y * H, w: meta.gameRect.w * W, h: meta.gameRect.h * H }
    : { x: 0, y: 0, w: W, h: H };
  const win = { x: gr.x - meta.sx, y: gr.y - meta.sy, w: gr.w, h: gr.h };
  console.log('crop ' + s.width + 'x' + s.height + '  win ' + JSON.stringify(win));
  const hit = F.find(crop, s.width, s.height, { win, screenH: H, exclude: [] });
  console.log(hit
    ? 'FOUND  block ' + JSON.stringify(hit.block) + '  icon ' + JSON.stringify(hit.icon)
    : 'NOTHING - reproduced the live failure');

  // ...and read the digits out of it, from the same smeared pixels the app would read
  if (hit) {
    const RR = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-reader.js'));
    const DR = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js'));
    const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digit-sets.json'));
    const pad = 3;
    const bx = hit.block.x - pad, by = hit.block.y - pad;
    const bw2 = hit.block.w + pad * 2, bh2 = hit.block.h + pad * 2;
    const cw = new Uint8ClampedArray(bw2 * bh2 * 4);
    for (let y = 0; y < bh2; y++) {
      for (let x = 0; x < bw2; x++) {
        const p = ((y + by) * s.width + (x + bx)) * 4, q = (y * bw2 + x) * 4;
        cw[q] = crop[p]; cw[q + 1] = crop[p + 1]; cw[q + 2] = crop[p + 2]; cw[q + 3] = 255;
      }
    }
    for (const set of bank.sets) {
      const templates = DR.templatesFromJSON({ templates: set.glyphs });
      const r = RR.read({ data: cw, w: bw2, h: bh2 }, templates, 0.55);
      console.log('  set h' + set.blockH + ' -> ' + (r.value == null ? 'none' : r.value)
        + '  scores ' + r.scores.map((v) => v.toFixed(2)).join(','));
    }
  }
  app.exit(0);
});
