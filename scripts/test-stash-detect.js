// Live multi-tab detect + value from a SCREEN capture. Unlike test-stash-capture
// (currency-only), this runs the real reader-worker detection across ALL registered
// tab maps, picks the best-matching layout, reads it, and prices via live poe2scout.
// Run with the game open on any supported tab:  npx electron scripts/test-stash-detect.js
const { app, desktopCapturer, screen } = require('electron');
const path = require('path'); const fs = require('fs'); const os = require('os');
const DR = require('../renderer/stash/digit-reader');
const TEMPLATES = require('../renderer/stash/digit-templates.json');
const TABS = {
  currency: require('../renderer/stash/currency-tab-map'),
  abyss: require('../renderer/stash/abyss-tab-map'),
  essence: require('../renderer/stash/essence-tab-map'),
  runes: require('../renderer/stash/runes-tab-map'),
  'runes-kalguuran': require('../renderer/stash/runes-kalguuran-tab-map'),
  ritual: require('../renderer/stash/ritual-tab-map'),
};
const T = DR.templatesFromJSON(TEMPLATES);
const paramsFor = (m) => m && m.readParams ? Object.assign({}, DR.DEFAULTS, m.readParams) : DR.DEFAULTS;
const OUT = path.join(os.tmpdir(), 'poe2-screen-capture.png');
const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 1 });

function countAt(V, W, H, slots, dx, dy, P) { let n = 0; for (const s of slots) if (DR.readCell(V, W, H, s.cx + dx, s.cy + dy, T, P) !== '?') n++; return n; }
function anchorsOf(m) { const s = m.STATIC_SLOTS; if (s.length <= 8) return s; return [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((f) => s[Math.min(s.length - 1, Math.round(f * (s.length - 1)))]); }
function searchOffset(m, V, W, H) {
  const anc = anchorsOf(m); const P = paramsFor(m); const pick = (best, dx, dy) => { const n = countAt(V, W, H, anc, dx, dy, P); return (!best || n > best.n || (n === best.n && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) ? { dx, dy, n } : best; };
  let best = null; for (let dy = -6; dy <= 10; dy += 3) for (let dx = -6; dx <= 8; dx += 3) best = pick(best, dx, dy);
  let fine = null; for (let dy = best.dy - 2; dy <= best.dy + 2; dy++) for (let dx = best.dx - 2; dx <= best.dx + 2; dx++) fine = pick(fine, dx, dy);
  return fine;
}
async function priceMap() {
  const cats = ['runes', 'currency', 'essences', 'fragments', 'ultimatum', 'idol', 'ritual', 'abyss'];
  const map = {};
  for (const c of cats) {
    try {
      const j = await (await fetch(`https://api.poe2scout.com/poe2/Leagues/${encodeURIComponent('Runes of Aldur')}/Currencies/ByCategory?category=${c}&perPage=250`)).json();
      for (const it of (j.Items || [])) if (map[it.ApiId] == null) map[it.ApiId] = { ex: it.CurrentPrice, name: it.Text };
    } catch (e) {}
  }
  return map;
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const W0 = Math.round(d.size.width * d.scaleFactor), H0 = Math.round(d.size.height * d.scaleFactor);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W0, height: H0 } });
  const src = sources.find((s) => s.id.startsWith('screen')) || sources[0];
  if (!src) { console.log('no screen source'); return app.exit(1); }
  fs.writeFileSync(OUT, src.thumbnail.toPNG());
  const { width: W, height: H } = src.thumbnail.getSize();
  const V = DR.valueChannelDesatMax(src.thumbnail.toBitmap(), W, H);
  console.log(`screen capture ${W}x${H}  (saved ${OUT})`);

  let detected = null;
  for (const id of Object.keys(TABS)) {
    const m = TABS[id]; const a = searchOffset(m, V, W, H); const frac = a.n / anchorsOf(m).length;
    console.log(`  ${id.padEnd(9)} anchors ${a.n}/${anchorsOf(m).length}  off(${a.dx},${a.dy})  frac ${frac.toFixed(2)}`);
    if (!detected || frac > detected.frac) detected = { id, map: m, align: a, frac };
  }
  if (!detected || detected.frac < 0.34) { console.log(`\nNo supported tab detected (best ${detected && detected.id} @ ${detected && detected.frac.toFixed(2)})`); return app.exit(0); }
  console.log(`\nDETECTED: ${detected.id}  (offset ${detected.align.dx},${detected.align.dy})\n`);

  const prices = await priceMap();
  const { map, align } = detected; let total = 0; const flags = []; const rows = [];
  const RP = paramsFor(map);
  for (const s of map.STATIC_SLOTS) {
    const raw = DR.readCell(V, W, H, s.cx + align.dx, s.cy + align.dy, T, RP);
    const nm = prices[s.apiId] ? prices[s.apiId].name : s.apiId; const px = prices[s.apiId] ? prices[s.apiId].ex : null;
    if (raw === '?') continue;
    if (px == null) { flags.push(`${nm}: no price`); rows.push([nm, raw, 0]); continue; }
    const line = parseInt(raw, 10) * px; total += line; rows.push([nm, raw, line]);
  }
  rows.sort((a, b) => b[2] - a[2]);
  for (const [nm, cnt, val] of rows) console.log('  ' + String(nm).padEnd(34) + String(cnt).padStart(5) + fmt(val).padStart(12) + ' ex');
  const div = prices['divine'] ? prices['divine'].ex : null;
  console.log(`\n${detected.id} total: ${fmt(total)} ex${div ? `  (~${fmt(total / div)} div)` : ''}`);
  console.log(`read ${rows.length}/${map.STATIC_SLOTS.length}  no-price flags: ${flags.join(', ') || 'none'}`);
  app.exit(0);
});
