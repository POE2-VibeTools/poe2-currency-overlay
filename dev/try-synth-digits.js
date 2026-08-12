'use strict';
// Can digit templates be RENDERED instead of captured?
//
//   npx electron dev/try-synth-digits.js
//
// The glyphs are vector outlines rasterised at whatever pixel size the UI is drawn at, so
// in principle they can be reproduced at any scale rather than collected one resolution at
// a time. The obstacle is hinting: a rasteriser snaps stems to the pixel grid, so a glyph
// at 10px is not a scaled copy of the same glyph at 11px. Reproducing the game's bitmap
// therefore needs the right typeface AND a rasteriser that agrees with the game's.
//
// This scores rendered digits against the templates cut from real captures, which are
// known correct. A high score means synthesis is on the table; a low one means the corpus
// stays.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digit-sets.json'));

// Serif faces present on a stock Windows box, plus the ones PoE's UI is usually said to
// resemble. Fontin is the family Grinding Gear used in PoE1 and is not installed by
// default - if it scores best, that tells us what to go and get.
const FONTS = ['Fontin', 'Fontin Sans', 'Georgia', 'Times New Roman', 'Garamond',
  'Palatino Linotype', 'Book Antiqua', 'Constantia', 'Cambria', 'Bookman Old Style',
  'Baskerville Old Face', 'Perpetua', 'Sylfaen', 'Trajan Pro'];
const SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

function iou(a, aw, ah, b, bw, bh) {
  // compare at the template's own box
  let inter = 0, uni = 0;
  for (let y = 0; y < bh; y++) {
    const sy = Math.min(ah - 1, Math.floor(y * ah / bh));
    for (let x = 0; x < bw; x++) {
      const sx = Math.min(aw - 1, Math.floor(x * aw / bw));
      const p = a[sy * aw + sx], q = b[y * bw + x];
      if (p & q) inter++;
      if (p | q) uni++;
    }
  }
  return uni ? inter / uni : 0;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 200,
    webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');

  // Render each digit, threshold it, trim to ink - the same shape the templates are in.
  const render = async (font, size) => win.webContents.executeJavaScript(`
    (() => {
      const out = {};
      for (const ch of '0123456789') {
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#fff';
        g.font = '${size}px "${font}"';
        g.textBaseline = 'alphabetic';
        g.fillText(ch, 8, 48);
        const d = g.getImageData(0, 0, 64, 64).data;
        let x0 = 64, y0 = 64, x1 = -1, y1 = -1;
        const on = new Uint8Array(64 * 64);
        for (let p = 0, i = 0; p < 64 * 64; p++, i += 4) {
          if (d[i] > 128) {
            on[p] = 1;
            const x = p % 64, y = (p - x) / 64;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        if (x1 < 0) { out[ch] = null; continue; }
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const m = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.push(on[(y + y0) * 64 + (x + x0)]);
        out[ch] = { w, h, data: m };
      }
      return out;
    })()
  `, true);

  for (const set of bank.sets) {
    console.log('\n=== against the real set at block h' + set.blockH);
    const rows = [];
    for (const font of FONTS) {
      for (const size of SIZES) {
        const got = await render(font, size);
        let sum = 0, n = 0;
        for (const ch of Object.keys(set.glyphs)) {
          const t = set.glyphs[ch], r = got[ch];
          if (!r) continue;
          sum += iou(Uint8Array.from(r.data), r.w, r.h, Uint8Array.from(t.data), t.w, t.h);
          n++;
        }
        if (n) rows.push({ font, size, score: sum / n });
      }
    }
    rows.sort((a, b) => b.score - a.score);
    for (const r of rows.slice(0, 6)) {
      console.log('   ' + r.score.toFixed(3) + '  ' + r.font + ' @ ' + r.size + 'px');
    }
  }

  // For reference: how well does the REAL other set score against this one? That is the
  // bar synthesis has to clear - it is what resampling a genuine capture achieves, and it
  // was not good enough.
  if (bank.sets.length > 1) {
    const [a, b] = bank.sets;
    let sum = 0, n = 0;
    for (const ch of Object.keys(a.glyphs)) {
      if (!b.glyphs[ch]) continue;
      const p = a.glyphs[ch], q = b.glyphs[ch];
      sum += iou(Uint8Array.from(p.data), p.w, p.h, Uint8Array.from(q.data), q.w, q.h);
      n++;
    }
    console.log('\nreal h' + a.blockH + ' vs real h' + b.blockH + ': ' + (sum / n).toFixed(3)
      + '   <- resampling a genuine capture, which reads 12345 as 888');
  }
  app.exit(0);
});
