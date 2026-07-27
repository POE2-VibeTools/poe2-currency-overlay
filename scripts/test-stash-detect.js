// Live detect + read + value from a SCREEN capture, using the real template-match path
// (tab-detect) + full-catalog pricing - mirrors the reader worker + main pricing.
//   npx electron scripts/test-stash-detect.js   (game open on any supported tab)
const { app, desktopCapturer, screen } = require('electron');
const path = require('path');
const R = path.join(__dirname, '..', 'renderer', 'stash');
const DR = require(path.join(R, 'digit-reader'));
const TD = require(path.join(R, 'tab-detect'));
const TT = require(path.join(R, 'tab-templates.json'));
const TABS = {
  currency: require(path.join(R, 'currency-tab-map')),
  abyss: require(path.join(R, 'abyss-tab-map')),
  essence: require(path.join(R, 'essence-tab-map')),
  runes: require(path.join(R, 'runes-tab-map')),
  'runes-kalguuran': require(path.join(R, 'runes-kalguuran-tab-map')),
  ritual: require(path.join(R, 'ritual-tab-map')),
  soulcore: require(path.join(R, 'soulcore-tab-map')),
  idol: require(path.join(R, 'idol-tab-map')),
  'ancient-augment': require(path.join(R, 'ancient-augment-tab-map')),
  delirium: require(path.join(R, 'delirium-tab-map')),
  breach: require(path.join(R, 'breach-tab-map')),
};
const DIGITS = DR.templatesFromJSON(require(path.join(R, 'digit-templates.json')));
const paramsFor = (m) => m && m.readParams ? Object.assign({}, DR.DEFAULTS, m.readParams) : DR.DEFAULTS;
const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 1 });

async function priceMap() {
  const B = `https://api.poe2scout.com/poe2/Leagues/${encodeURIComponent('Runes of Aldur')}`;
  const map = {}; let cats = [];
  try { const cd = await (await fetch(`${B}/Items/Categories`)).json(); cats = cd.CurrencyCategories.map((c) => c.ApiId); } catch (e) {}
  for (const c of cats) {
    try { const j = await (await fetch(`${B}/Currencies/ByCategory?category=${encodeURIComponent(c)}&perPage=250`)).json();
      for (const it of (j.Items || [])) if (map[it.ApiId] == null) map[it.ApiId] = { ex: it.CurrentPrice, name: it.Text }; } catch (e) {}
  }
  // GGG CX-feed fallback for items poe2scout doesn't index (mirrors main.js getStashPriceMap)
  const CX_FALLBACK = { 'raven-s-reflection': { name: "Raven's Reflection" } };
  try {
    const cxFeed = require(path.join(__dirname, '..', 'cx-feed'));
    const cx = await cxFeed.getCxPairMap('Runes of Aldur');
    const rate = (a, b) => { if (a === b) return 1; const pd = cx[[a, b].sort().join('|')]; return (!pd || !(pd[a] > 0) || !(pd[b] > 0)) ? null : pd[a] / pd[b]; };
    const valueEx = (id) => { const d = rate(id, 'exalted'); if (d != null) return d; for (const h of ['chaos', 'divine']) { const r1 = rate(id, h), r2 = rate(h, 'exalted'); if (r1 != null && r2 != null) return r1 * r2; } return null; };
    for (const [id, cfg] of Object.entries(CX_FALLBACK)) if (map[id] == null) { const px = valueEx(id); if (px != null) map[id] = { ex: px, name: cfg.name }; }
  } catch (e) {}
  return map;
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const W0 = Math.round(d.size.width * d.scaleFactor), H0 = Math.round(d.size.height * d.scaleFactor);
  const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W0, height: H0 } })).find((s) => s.id.startsWith('screen'));
  if (!src) { console.log('no screen source'); return app.exit(1); }
  const img = src.thumbnail; const { width: W, height: H } = img.getSize(); const buf = img.toBitmap();
  console.log(`screen capture ${W}x${H}`);

  const det = TD.detect(buf, W, H, TT.box, TT);
  console.log(`detect: ${det ? det.tab + ' ' + det.score.toFixed(2) + ' (2nd ' + det.runnerUp + ' ' + det.runnerScore.toFixed(2) + ')' : 'none'}`);
  if (!det || det.score < 0.3) { console.log('no tab recognized'); return app.exit(0); }
  const map = TABS[det.tab];
  if (!map) { console.log(`recognized ${det.tab} but no read map yet`); return app.exit(0); }

  const V = DR.valueChannelDesatMax(buf, W, H); const P = paramsFor(map);
  const prices = await priceMap();
  let total = 0; const rows = []; const flags = [];
  for (const s of map.STATIC_SLOTS) {
    const pos = TD.scalePos(s.cx, s.cy, TT.box, TT.box);
    const raw = DR.readCell(V, W, H, pos.cx, pos.cy, DIGITS, P);
    if (raw === '?') continue;
    const info = prices[s.apiId] || {}; const nm = info.name || s.apiId; const px = info.ex;
    if (px == null) { flags.push(nm); rows.push([nm, raw, 0]); continue; }
    const line = parseInt(raw, 10) * px; total += line; rows.push([nm, raw, line]);
  }
  rows.sort((a, b) => b[2] - a[2]);
  for (const [nm, cnt, val] of rows) console.log('  ' + String(nm).padEnd(34) + String(cnt).padStart(5) + fmt(val).padStart(12) + ' ex');
  const div = prices['divine'] ? prices['divine'].ex : null;
  console.log(`\n${det.tab} total: ${fmt(total)} ex${div ? `  (~${fmt(total / div)} div)` : ''}`);
  console.log(`read ${rows.length}/${map.STATIC_SLOTS.length}  no-price: ${flags.join(', ') || 'none'}`);
  app.exit(0);
});
