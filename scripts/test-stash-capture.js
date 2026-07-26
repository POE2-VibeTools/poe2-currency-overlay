// Live currency-tab valuation from a SCREEN capture (crisp; window/DirectX grabs
// are soft). Uses the desat-max flat-white filter + baked templates + static map.
// Run with the game open on the Currency tab:  npx electron scripts/test-stash-capture.js
const { app, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const DR = require('../renderer/stash/digit-reader');
const MAP = require('../renderer/stash/currency-tab-map');
const PRICES = require('../renderer/stash/currency-prices.sample.json');
const TEMPLATES = require('../renderer/stash/digit-templates.json');

const OUT = path.join(require('os').tmpdir(), 'poe2-screen-capture.png');
const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 1 });

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

  const templates = DR.templatesFromJSON(TEMPLATES);
  const items = PRICES.items, divPx = PRICES.divine_price_ex;

  // Find the small offset that aligns the map (window at top-left ≈ reference).
  // With the desat-max channel, valid reads are trustworthy, so maximize them.
  const score = (dx, dy) => MAP.STATIC_SLOTS.reduce((a, s) =>
    a + (DR.readCell(V, W, H, s.cx + dx, s.cy + dy, templates, DR.DEFAULTS) !== '?' ? 1 : 0), 0);
  let best = { dx: 0, dy: 0, n: -1 };
  for (let dy = -6; dy <= 10; dy++) for (let dx = -6; dx <= 8; dx++) {
    const n = score(dx, dy);
    if (n > best.n || (n === best.n && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, n };
  }
  console.log(`alignment offset dx=${best.dx} dy=${best.dy}  (${best.n}/${MAP.STATIC_SLOTS.length} cells read)\n`);

  let total = 0; const flags = []; const rows = [];
  for (const s of MAP.STATIC_SLOTS) {
    const raw = DR.readCell(V, W, H, s.cx + best.dx, s.cy + best.dy, templates, DR.DEFAULTS);
    const name = items[s.apiId] ? items[s.apiId].name : s.apiId;
    const px = items[s.apiId] ? items[s.apiId].ex : null;
    if (raw === '?') { flags.push(`${name} @(${s.cx},${s.cy})`); continue; }
    if (px == null) { flags.push(`${name}: no price`); continue; }
    const line = parseInt(raw, 10) * px; total += line;
    rows.push([name, raw, line]);
  }
  rows.sort((a, b) => b[2] - a[2]);
  for (const [name, cnt, val] of rows.slice(0, 12)) console.log('  ' + name.padEnd(26) + String(cnt).padStart(6) + fmt(val).padStart(12) + ' ex');
  console.log(`\nLIVE currency-tab total: ${fmt(total)} ex  (~${fmt(total / divPx)} div)`);
  console.log(`read ${rows.length}/${MAP.STATIC_SLOTS.length}  flagged ${flags.length}: ${flags.join(', ') || 'none'}`);
  app.exit(0);
});
