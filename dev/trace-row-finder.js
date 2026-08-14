'use strict';
// Re-run the row finder's gates one at a time on an auto-miss dump and count what
// survives each, so the gate that killed a real field names itself.
//
//   npx electron dev/trace-row-finder.js <stamp_auto-miss>
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('trace-row-finder.js'));
const dir = path.join(process.env.APPDATA || os.homedir(), 'poe2-price-overlay', 'read-diag');
const base = a[0];

// mirror of price-row-finder.js constants
const BORDER = { r: 182, g: 169, b: 138 };
const TOL = 16;
const BAND = { x0: 0.20, x1: 0.54, y0: 0.44, y1: 0.90 };
const MIN_W = 18, MAX_W = 140, MIN_H = 12, MAX_H = 64;
const ASPECT_LO = 1.28, ASPECT_HI = 1.85;
const SIDE_FRAC = 0.6;
const DARK_INSIDE = 165;
const SURROUND = { r: 44, g: 38, b: 30 };
const SURROUND_TOL = 26, SURROUND_SD = 24;

app.whenReady().then(() => {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, base + '.json'), 'utf8'));
  const img = nativeImage.createFromPath(path.join(dir, base + '.png'));
  const s = img.getSize();
  const bb = img.toBitmap();
  const rgba = new Uint8ClampedArray(bb.length);
  for (let i = 0; i < bb.length; i += 4) {
    rgba[i] = bb[i + 2]; rgba[i + 1] = bb[i + 1]; rgba[i + 2] = bb[i]; rgba[i + 3] = bb[i + 3];
  }
  const w = s.width, h = s.height;
  const W = meta.streamW, H = meta.streamH;
  const grf = meta.gameRect;
  const gr = grf && grf.w > 0
    ? { x: grf.x * W, y: grf.y * H, w: grf.w * W, h: grf.h * H }
    : { x: 0, y: 0, w: W, h: H };
  const g = { x: gr.x - meta.sx, y: gr.y - meta.sy, w: gr.w, h: gr.h };

  const bx0 = Math.max(1, Math.round(g.x + g.w * BAND.x0));
  const bx1 = Math.min(w - 2, Math.round(g.x + g.w * BAND.x1));
  const by0 = Math.max(1, Math.round(g.y + g.h * BAND.y0));
  const by1 = Math.min(h - 2, Math.round(g.y + g.h * BAND.y1));
  console.log('band x ' + bx0 + '..' + bx1 + '  y ' + by0 + '..' + by1 + '  (crop ' + w + 'x' + h + ')');

  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const M = new Uint8Array(bw * bh);
  const L = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const p = ((y + by0) * w + (x + bx0)) * 4;
      const isB = Math.abs(rgba[p] - BORDER.r) <= TOL
        && Math.abs(rgba[p + 1] - BORDER.g) <= TOL
        && Math.abs(rgba[p + 2] - BORDER.b) <= TOL;
      M[y * bw + x] = isB ? 1 : 0;
      L[y * bw + x] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
  }
  let border = 0;
  for (let i = 0; i < M.length; i++) border += M[i];
  console.log('border-coloured pixels in band: ' + border);

  const rows = [];
  for (let y = 0; y < bh; y++) {
    let start = -1;
    const list = [];
    for (let x = 0; x <= bw; x++) {
      const on = x < bw && M[y * bw + x];
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        const len = x - start;
        if (len >= MIN_W && len <= MAX_W) list.push({ x0: start, x1: x - 1 });
        start = -1;
      }
    }
    rows.push(list);
  }
  const runCount = rows.reduce((n, l) => n + l.length, 0);
  console.log('horizontal runs 18..140 px: ' + runCount);

  let pairs = 0, aspectOk = 0, sideOk = 0, darkOk = 0, panelOk = 0;
  const survivors = [];
  for (let y = 0; y < bh; y++) {
    for (const top of rows[y]) {
      for (let dy = MIN_H; dy <= MAX_H && y + dy < bh; dy++) {
        const match = rows[y + dy].find((r) => Math.abs(r.x0 - top.x0) <= 2 && Math.abs(r.x1 - top.x1) <= 2);
        if (!match) continue;
        pairs++;
        const boxW = top.x1 - top.x0 + 1, boxH = dy + 1;
        const aspect = boxW / boxH;
        if (aspect < ASPECT_LO || aspect > ASPECT_HI) continue;
        aspectOk++;
        const col = (xx, yy) => (xx > 0 && xx < bw - 1)
          && (M[yy * bw + xx] || M[yy * bw + xx - 1] || M[yy * bw + xx + 1]);
        let lc = 0, rc = 0;
        for (let yy = y; yy <= y + dy; yy++) {
          if (col(top.x0, yy)) lc++;
          if (col(top.x1, yy)) rc++;
        }
        if (Math.max(lc, rc) < boxH * SIDE_FRAC) continue;
        sideOk++;
        let ssum = 0, n = 0;
        for (let yy = y + 3; yy < y + dy - 2; yy += 2) {
          for (let xx = top.x0 + 3; xx < top.x1 - 2; xx += 2) { ssum += L[yy * bw + xx]; n++; }
        }
        if (!n || ssum / n > DARK_INSIDE) continue;
        darkOk++;
        // onPanel
        let pn = 0, sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0;
        const b = { x: top.x0 + bx0, y: y + by0, w: boxW, h: boxH };
        const take = (x, yy) => {
          if (x < 0 || yy < 0 || x >= w || yy >= h) return;
          const p = (yy * w + x) * 4;
          const r = rgba[p], gg = rgba[p + 1], bl = rgba[p + 2];
          sr += r; sg += gg; sb += bl; qr += r * r; qg += gg * gg; qb += bl * bl; pn++;
        };
        for (let d = 3; d <= 7; d++) {
          for (let x = b.x - d; x <= b.x + b.w + d; x += 2) { take(x, b.y - d); take(x, b.y + b.h + d); }
        }
        let pass = false, why = '';
        if (pn < 40) why = 'ring off-frame';
        else {
          const mr = sr / pn, mg = sg / pn, mb = sb / pn;
          const sd = (q, m) => Math.sqrt(Math.max(0, q / pn - m * m));
          if (Math.abs(mr - SURROUND.r) > SURROUND_TOL || Math.abs(mg - SURROUND.g) > SURROUND_TOL
            || Math.abs(mb - SURROUND.b) > SURROUND_TOL) {
            why = 'ring mean ' + [mr, mg, mb].map((v) => v.toFixed(0)).join(',');
          } else if (sd(qr, mr) > SURROUND_SD || sd(qg, mg) > SURROUND_SD || sd(qb, mb) > SURROUND_SD) {
            why = 'ring sd ' + [sd(qr, mr), sd(qg, mg), sd(qb, mb)].map((v) => v.toFixed(0)).join(',');
          } else pass = true;
        }
        if (pass) { panelOk++; survivors.push(b); }
        else if (boxW > 40) {
          console.log('  near miss ' + boxW + 'x' + boxH + ' at ' + b.x + ',' + b.y + ' - ' + why);
        }
      }
    }
  }
  console.log('pairs ' + pairs + ' -> aspect ' + aspectOk + ' -> side ' + sideOk
    + ' -> dark ' + darkOk + ' -> panel ' + panelOk);
  for (const b of survivors.slice(0, 5)) console.log('  survivor ' + JSON.stringify(b));
  app.exit(0);
});
