'use strict';
// Dump the count strip of chosen currency slots from a stored capture, at every
// adaptive binarisation floor, plus what readCellEx returns at each - the divine
// "1084 -> 108 at conf 0.99" question, made visible.
//
//   CALBOX='{"x":..}' npx electron dev/dump-count-strips.js <capture.png> divine regal exalted
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.endsWith('.exe') && !a.endsWith('dump-count-strips.js'));
const file = args[0];
const wanted = args.slice(1);

const DR = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js'));
const TD = require(path.join(__dirname, '..', 'renderer', 'stash', 'tab-detect.js'));
const MAP = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-tab-map.js'));
const TAB_TEMPLATES = require(path.join(__dirname, '..', 'renderer', 'stash', 'tab-templates.json'));
const { bank: DIGIT_BANK, unmap: UNMAP } = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js')).bankFromJSON(require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-templates.json')));

app.whenReady().then(() => {
  const src = file.includes('/') || file.includes('\\') ? file : path.join(__dirname, 'dialog-captures', file);
  const img = nativeImage.createFromPath(src);
  const s = img.getSize();
  const bgra = img.toBitmap();
  const buf = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    buf[i] = bgra[i + 2]; buf[i + 1] = bgra[i + 1]; buf[i + 2] = bgra[i]; buf[i + 3] = bgra[i + 3];
  }
  const W = s.width, H = s.height;
  const refBox = TAB_TEMPLATES.box;
  const box = process.env.CALBOX ? JSON.parse(process.env.CALBOX) : refBox;

  // mirror reader-worker's normalisation exactly
  const scale = box.h / refBox.h;
  const M = 24;
  let V, W2, H2, originX, originY;
  if (Math.abs(scale - 1) > 0.005) {
    const kx = box.w / refBox.w, ky = box.h / refBox.h;
    W2 = Math.round(refBox.w + 2 * M); H2 = Math.round(refBox.h + 2 * M);
    const norm = DR.resampleRGBA(buf, W, H, box.x - M * kx, box.y - M * ky, (refBox.w + 2 * M) * kx, (refBox.h + 2 * M) * ky, W2, H2);
    V = DR.valueChannelDesatMax(norm, W2, H2);
    originX = refBox.x - M; originY = refBox.y - M;
  } else {
    V = DR.valueChannelDesatMax(buf, W, H); W2 = W; H2 = H;
    originX = 0; originY = 0;
  }
  console.log('panel box', JSON.stringify(box), 'scale', scale.toFixed(3));

  // pull the same constants readCellEx uses (exported? print what we can)
  console.log('exports:', Object.keys(DR).join(','));

  for (const id of wanted) {
    const slot = MAP.STATIC_SLOTS.find((x) => x.apiId === id);
    if (!slot) { console.log(id + ': not in map'); continue; }
    const cx = (originX || originY) ? slot.cx - originX : TD.scalePos(slot.cx, slot.cy, refBox, box).cx;
    const cy = (originX || originY) ? slot.cy - originY : TD.scalePos(slot.cx, slot.cy, refBox, box).cy;
    const r = DR.readCellAdaptive(V, W2, H2, cx, cy, DIGIT_BANK, Object.assign({}, DR.DEFAULTS, MAP.readParams || {}), 1);
    console.log(id.padEnd(10) + ' read "' + (r.text === '?' ? '?' : UNMAP(r.text)) + '" conf ' + (r.conf || 0).toFixed(2) + ' floor ' + r.floor);
    // dump the raw strip region as a scaled PNG for eyeballs: 44px wide, 16 tall around cx,cy
    const SW = 46, SH = 14;
    const x0 = Math.round(cx - 2), y0 = Math.round(cy - SH / 2);
    const canvas = Buffer.alloc(SW * SH * 4);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const v = V[(y0 + y) * W2 + (x0 + x)] || 0;
        const q = (y * SW + x) * 4;
        canvas[q] = canvas[q + 1] = canvas[q + 2] = v; canvas[q + 3] = 255;
      }
    }
    const im = nativeImage.createFromBitmap(canvas, { width: SW, height: SH })
      .resize({ width: SW * 8, quality: 'best' });
    const out = path.join(__dirname, 'strip-' + id + '.png');
    fs.writeFileSync(out, im.toPNG());
    console.log('  strip -> ' + out);
  }
  app.exit(0);
});
