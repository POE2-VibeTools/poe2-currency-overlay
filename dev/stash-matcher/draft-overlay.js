// Draft a dense (no-tier) rune subtab for Drew to CORRECT:
//   1) detect filled slots, 2) matcher top-3 per slot vs the rune pool,
//   3) render a NUMBERED overlay PNG, 4) print a numbered guess-list.
// Drew scans the image + list and only fixes the wrong ones.
//   IMG=<frame.png> CAT=runes npx electron dev/stash-matcher/draft-overlay.js
const { app, nativeImage, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const REPO = 'C:/Users/dbatc/Documents/Overlay App';
const DR = require(REPO + '/renderer/stash/digit-reader');
const IM = require(REPO + '/renderer/stash/icon-matcher');
const TEMPLATES = require(REPO + '/renderer/stash/digit-templates.json');
const IMG = process.env.IMG || path.join(os.tmpdir(), 'poe2-screen-capture.png');
const CATS = (process.env.CAT || 'runes').split(',');
const LEAGUE = process.env.LEAGUE || 'Runes of Aldur';
const S = 40;
const CROP = { x: 20, y: 180, w: 600, h: 880 };

function toArr(img, rgba) {
  const r = img.resize({ width: S, height: S, quality: 'best' }).toBitmap(); const out = [];
  for (let i = 0; i < S * S; i++) { const p = i * 4; out.push(r[p + 2], r[p + 1], r[p + 0]); if (rgba) out.push(r[p + 3]); }
  return out;
}
function detect(img, W, H) {
  const b = img.toBitmap(); const R = (i) => b[i * 4 + 2], G = (i) => b[i * 4 + 1], B = (i) => b[i * 4 + 0];
  const X0 = 20, X1 = 600, Y0 = 225, Y1 = 1060;
  const dark = (x, y) => { const i = y * W + x; return Math.max(R(i), G(i), B(i)) <= 80; };
  const mask = new Uint8Array(W * H);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = y * W + x, r = R(i), g = G(i), bb = B(i), mn = Math.min(r, g, bb);
    if (mn < 150 || (Math.max(r, g, bb) - mn) > 60) continue;
    let near = false; for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (dark(x + dx, y + dy)) { near = true; break; }
    if (near) mask[i] = 1;
  }
  const dil = new Uint8Array(W * H);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { if (!mask[y * W + x]) continue; for (let dx = -5; dx <= 5; dx++) { const xx = x + dx; if (xx >= X0 && xx < X1) dil[y * W + xx] = 1; } }
  const lbl = new Int32Array(W * H); const st = []; let n = 0; const boxes = [];
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i0 = y * W + x; if (!dil[i0] || lbl[i0]) continue; n++; lbl[i0] = n; st.length = 0; st.push(i0);
    let x0 = x, x1 = x, y0 = y, y1 = y, cnt = 0;
    while (st.length) { const p = st.pop(); const px = p % W, py = (p - px) / W; cnt++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && dil[q] && !lbl[q]) { lbl[q] = n; st.push(q); } }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (h >= 7 && h <= 16 && w >= 4 && w <= 48 && cnt >= 10) boxes.push({ cx: Math.round((x0 + x1) / 2), cy: Math.round((y0 + y1) / 2) });
  }
  // dedupe near-duplicates (within 22px)
  const uniq = [];
  for (const b of boxes.sort((a, c) => a.cy - c.cy || a.cx - c.cx)) if (!uniq.some((u) => Math.abs(u.cx - b.cx) < 22 && Math.abs(u.cy - b.cy) < 22)) uniq.push(b);
  uniq.sort((a, c) => (Math.round(a.cy / 30) - Math.round(c.cy / 30)) || (a.cx - c.cx));
  return uniq;
}

app.whenReady().then(async () => {
  const cands = [];
  for (const cat of CATS) {
    const j = await (await fetch(`https://api.poe2scout.com/poe2/Leagues/${encodeURIComponent(LEAGUE)}/Currencies/ByCategory?category=${cat}&perPage=250`)).json();
    for (const it of (j.Items || [])) {
      let u = it.IconUrl; if (!u) continue; u = u.replace('poecdn.com//', 'poecdn.com/');
      try { const buf = Buffer.from(await (await fetch(u)).arrayBuffer()); const im = nativeImage.createFromBuffer(buf); if (im.isEmpty()) continue; cands.push({ apiId: it.ApiId, name: it.Text, f: IM.prepCandidate(Uint8Array.from(toArr(im, true)), { size: S }) }); } catch (e) {}
    }
  }
  const img = nativeImage.createFromPath(IMG); const { width: W, height: H } = img.getSize();
  const pos = detect(img, W, H);
  const draft = [];
  pos.forEach((p, i) => {
    const cell = img.crop({ x: Math.max(0, p.cx - 17), y: Math.max(0, p.cy - 12), width: 52, height: 52 });
    const { ranked } = IM.match(Uint8Array.from(toArr(cell, false)), cands, { size: S });
    const t = ranked.slice(0, 3);
    draft.push({ n: i + 1, cx: p.cx, cy: p.cy, top: t.map((x) => ({ name: x.name, apiId: x.apiId, s: Math.round(x.score) })) });
    console.log(`${String(i + 1).padStart(2)}  ${t.map((x) => `${x.name}(${x.score.toFixed(0)})`).join('  |  ')}`);
  });
  fs.writeFileSync(path.join(os.tmpdir(), 'draft-overlay.json'), JSON.stringify(draft, null, 1));

  // render numbered overlay (write files; data-URL too big for loadURL)
  const cropPath = path.join(os.tmpdir(), '_crop.png');
  const htmlPath = path.join(os.tmpdir(), '_overlay.html');
  fs.writeFileSync(cropPath, img.crop(CROP).toPNG());
  const badges = draft.map((d) => `<div class="b" style="left:${d.cx - CROP.x - 2}px;top:${d.cy - CROP.y - 4}px">${d.n}</div>`).join('');
  const html = `<html><head><style>*{margin:0}body{width:${CROP.w}px;height:${CROP.h}px;position:relative}
    img{position:absolute;left:0;top:0}
    .b{position:absolute;background:#ff3b30;color:#fff;font:bold 13px monospace;padding:0 3px;border-radius:3px;box-shadow:0 0 2px #000}</style></head>
    <body><img src="file:///${cropPath.replace(/\\/g, '/')}">${badges}</body></html>`;
  fs.writeFileSync(htmlPath, html);
  const out = path.join(os.tmpdir(), 'draft-overlay.png');
  const win = new BrowserWindow({ width: CROP.w, height: CROP.h, show: false, webPreferences: { webSecurity: false } });
  const done = (code) => { try { win.destroy(); } catch (e) {} app.exit(code); };
  setTimeout(() => { console.log('render timeout'); done(1); }, 20000); // hard safety
  await win.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 900));
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(out, shot.toPNG());
  console.log(`\noverlay -> ${out}  (${draft.length} slots)`);
  done(0);
});
