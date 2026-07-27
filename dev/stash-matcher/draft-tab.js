// Reusable tab drafter: detect a tab's filled slots, matcher-draft each item's
// apiId against its poe2scout category pool, and emit a draft map + a numbered
// overlay for Drew to correct. Then bake into renderer/stash/<tab>-tab-map.js.
//   IMG="screenshots/breach tab.png" CAT=breach npx electron dev/stash-matcher/draft-tab.js
//   CAT can be comma-separated (e.g. breach,fragments) to widen the pool.
const { app, nativeImage } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const REPO = 'C:/Users/dbatc/Documents/Overlay App';
const DR = require(REPO + '/renderer/stash/digit-reader');
const IM = require(REPO + '/renderer/stash/icon-matcher');
const TEMPLATES = require(REPO + '/renderer/stash/digit-templates.json');
const IMG = process.env.IMG || (REPO + '/screenshots/breach tab.png');
const CATS = (process.env.CAT || 'breach').split(',');
const LEAGUE = process.env.LEAGUE || 'Runes of Aldur';
const S = 40;

function toArr(img, rgba) {
  const r = img.resize({ width: S, height: S, quality: 'best' }).toBitmap(); const out = [];
  for (let i = 0; i < S * S; i++) { const p = i * 4; out.push(r[p + 2], r[p + 1], r[p + 0]); if (rgba) out.push(r[p + 3]); }
  return out;
}

// number-cluster detection (from detect-positions.js): left stash panel region
function detect(img, W, H) {
  const b = img.toBitmap();
  const R = (i) => b[i * 4 + 2], G = (i) => b[i * 4 + 1], B = (i) => b[i * 4 + 0];
  const X0 = 20, X1 = 600, Y0 = 195, Y1 = 760;
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
  boxes.sort((a, b) => (Math.round(a.cy / 20) - Math.round(b.cy / 20)) || (a.cx - b.cx));
  return boxes;
}

app.whenReady().then(async () => {
  const cands = [];
  for (const cat of CATS) {
    const url = `https://api.poe2scout.com/poe2/Leagues/${encodeURIComponent(LEAGUE)}/Currencies/ByCategory?category=${cat}&perPage=250`;
    const j = await (await fetch(url)).json();
    for (const it of (j.Items || [])) {
      let iconUrl = it.IconUrl; if (!iconUrl) continue; iconUrl = iconUrl.replace('poecdn.com//', 'poecdn.com/');
      try { const buf = Buffer.from(await (await fetch(iconUrl)).arrayBuffer()); const im = nativeImage.createFromBuffer(buf); if (im.isEmpty()) continue;
        cands.push({ apiId: it.ApiId, name: it.Text, cat, f: IM.prepCandidate(Uint8Array.from(toArr(im, true)), { size: S }) }); } catch (e) {}
    }
  }
  const byId = {}; cands.forEach((c) => { byId[c.apiId] = c; });

  const img = nativeImage.createFromPath(IMG); const { width: W, height: H } = img.getSize();
  const V = DR.valueChannelDesatMax(img.toBitmap(), W, H); const T = DR.templatesFromJSON(TEMPLATES);
  const positions = detect(img, W, H);
  const draft = [];
  console.log(`pool: ${cands.length} candidates from [${CATS.join(',')}] | ${positions.length} slots detected | ${W}x${H}\n`);
  positions.forEach((p, i) => {
    const count = DR.readCell(V, W, H, p.cx, p.cy, T, DR.DEFAULTS);
    const cell = img.crop({ x: Math.max(0, p.cx - 17), y: Math.max(0, p.cy - 12), width: 52, height: 52 });
    const { ranked } = IM.match(Uint8Array.from(toArr(cell, false)), cands, { size: S });
    const t = ranked.slice(0, 3);
    draft.push({ i: i + 1, cx: p.cx, cy: p.cy, count: count === '?' ? null : parseInt(count, 10), apiId: t[0].apiId, score: Math.round(t[0].score) });
    console.log(`${String(i + 1).padStart(2)} (${String(p.cx).padStart(3)},${p.cy}) count=${String(count).padEnd(4)} -> ${t.map((x) => `${byId[x.apiId].name}(${x.score.toFixed(0)})`).join('  |  ')}`);
  });
  const out = os.tmpdir().replace(/\\/g, '/') + '/draft-tab.json';
  fs.writeFileSync(out, JSON.stringify({ img: IMG, cats: CATS, positions: draft }, null, 1));
  console.log(`\ndraft -> ${out}`);
  app.exit(0);
});
