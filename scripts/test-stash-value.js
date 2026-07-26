// End-to-end offline valuation of the Currency tab: decode screenshot ->
// read every static slot's count -> price via the static map -> tab total.
// Run:  npx electron scripts/test-stash-value.js
// Fixtures (gitignored): screenshots/currency tab.png
const { app, nativeImage } = require('electron');
const path = require('path');
const DR = require('../renderer/stash/digit-reader');
const MAP = require('../renderer/stash/currency-tab-map');
const PRICES = require('../renderer/stash/currency-prices.sample.json');

// Ground truth positions used ONLY to extract digit templates from game glyphs.
// (Runtime will load a bundled template set instead — see notes.)
const GT = [
  [164,209,"69"],[240,208,"582"],[550,208,"16"],[50,209,"194"],[108,209,"707"],
  [301,209,"451"],[438,209,"39"],[495,209,"114"],[47,271,"58"],[107,271,"605"],
  [161,272,"96"],[242,272,"58"],[300,272,"7"],[368,271,"1383"],[554,271,"160"],
  [51,334,"1611"],[104,334,"151"],[159,334,"16"],[429,354,"204"],[491,353,"252"],
  [555,354,"529"],[54,397,"4822"],[106,397,"31"],[163,397,"8"],[489,416,"118"],
  [556,416,"300"],[157,460,"8"],[53,460,"1550"],[101,461,"71"],[553,498,"201"],
  [264,580,"6"],[200,581,"7"],[328,581,"9"],[390,581,"7"],[127,651,"17"],
  [184,650,"18"],[241,650,"18"],[299,650,"33"],[353,651,"4"],[412,651,"34"],
  [468,650,"18"],[128,706,"16"],[181,706,"3"],[240,706,"13"],[297,706,"21"],
  [355,707,"14"],[413,706,"30"],[473,706,"26"],[378,209,"67"],
];

const IMG = path.join(__dirname, '..', 'screenshots', 'currency tab.png');
const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 1 });

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(process.env.IMG || IMG);
  const { width: W, height: H } = img.getSize();
  const buf = img.toBitmap();
  const V = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    let m = buf[p]; if (buf[p + 1] > m) m = buf[p + 1]; if (buf[p + 2] > m) m = buf[p + 2];
    V[i] = m;
  }

  const { templates } = DR.extractTemplates(V, W, H, GT, DR.DEFAULTS);
  const items = PRICES.items, divPx = PRICES.divine_price_ex;

  let total = 0; const flags = []; const rows = [];
  for (const slot of MAP.STATIC_SLOTS) {
    const raw = DR.readCell(V, W, H, slot.cx, slot.cy, templates, DR.DEFAULTS);
    const price = items[slot.apiId] ? items[slot.apiId].ex : null;
    const name = items[slot.apiId] ? items[slot.apiId].name : slot.apiId;
    if (raw === '?') { flags.push(`${name} @(${slot.cx},${slot.cy}): unreadable count`); rows.push([name, '?', price, null]); continue; }
    if (price == null) { flags.push(`${name}: no price in catalog`); rows.push([name, raw, null, null]); continue; }
    const line = parseInt(raw, 10) * price;
    total += line; rows.push([name, raw, price, line]);
  }

  console.log(`\nCurrency tab valuation  (${PRICES.league})  ${W}x${H}\n`);
  console.log('  ' + 'Currency'.padEnd(26) + 'Count'.padStart(7) + 'Unit(ex)'.padStart(11) + 'Value(ex)'.padStart(13));
  console.log('  ' + '-'.repeat(56));
  for (const [name, cnt, px, val] of rows) {
    console.log('  ' + name.padEnd(26) + String(cnt).padStart(7) + (px == null ? '—' : fmt(px)).padStart(11) + (val == null ? '—' : fmt(val)).padStart(13));
  }
  console.log('  ' + '-'.repeat(56));
  console.log('  ' + 'TOTAL (static slots)'.padEnd(33) + `${fmt(total)} ex`.padStart(20));
  console.log('  ' + ''.padEnd(33) + `${fmt(total / divPx)} div`.padStart(20));
  console.log(`\n  slots read: ${MAP.STATIC_SLOTS.length}   flagged: ${flags.length}   dynamic rows (not valued): ${MAP.DYNAMIC_ROWS.reduce((a, r) => a + r.xs.length, 0)}`);
  if (flags.length) { console.log('\n  FLAGS (no silent misses):'); for (const f of flags) console.log('   - ' + f); }
  app.exit(0);
});
