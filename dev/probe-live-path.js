'use strict';
// Reproduce the LIVE reprice call exactly: the same centred crop __rpAutoGrab takes, the
// same win rectangle with negative offsets, handed to the same finder.
//
//   npx electron dev/probe-live-path.js <file.png>
//
// probe-frame.js runs the finder on the full frame, which is NOT what the app does - the
// app searches a crop covering the middle 50% x 60% of the game window and passes the
// window in crop coordinates. A failure that only happens live has to be reproduced
// through this path or it cannot be worked on.
const { app, nativeImage } = require('electron');
const path = require('path');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('probe-live-path.js'));
const file = a[0];

app.whenReady().then(() => {
  const src = file.includes('/') || file.includes('\\') ? file
    : path.join(__dirname, 'dialog-captures', file);
  const img = nativeImage.createFromPath(src);
  const s = img.getSize();
  if (!s.width) { console.log('could not read ' + src); return app.exit(1); }
  const b = img.toBitmap();
  const W = s.width, H = s.height;
  const full = new Uint8ClampedArray(b.length);
  for (let i = 0; i < b.length; i += 4) {
    full[i] = b[i + 2]; full[i + 1] = b[i + 1]; full[i + 2] = b[i]; full[i + 3] = b[i + 3];
  }

  // the game fullscreen on this display, exactly as main.js reports it
  const gr = { x: 0, y: 0, w: W, h: H };
  const fx = 0.5, fy = 0.6;
  const sx = Math.max(0, Math.round(gr.x + gr.w * (1 - fx) / 2));
  const sy = Math.max(0, Math.round(gr.y + gr.h * (1 - fy) / 2));
  const sw = Math.min(W - sx, Math.round(gr.w * fx));
  const sh = Math.min(H - sy, Math.round(gr.h * fy));
  console.log('crop ' + sw + 'x' + sh + ' at ' + sx + ',' + sy);

  const crop = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const p = ((y + sy) * W + (x + sx)) * 4, q = (y * sw + x) * 4;
      crop[q] = full[p]; crop[q + 1] = full[p + 1]; crop[q + 2] = full[p + 2]; crop[q + 3] = full[p + 3];
    }
  }

  const win = { x: gr.x - sx, y: gr.y - sy, w: gr.w, h: gr.h };
  const hit = F.find(crop, sw, sh, { win, screenH: H, exclude: [] });
  console.log(hit
    ? 'FOUND  block ' + JSON.stringify(hit.block) + '  icon ' + JSON.stringify(hit.icon)
    : 'NOTHING - the live path fails on this frame');
  app.exit(0);
});
