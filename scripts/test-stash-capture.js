// Live capture probe: grab the Path of Exile 2 window via desktopCapturer,
// report its resolution, save the frame, and — if it matches the reference
// 1920x1032 layout — read + value the currency tab from the LIVE grab.
//
// Run with the game open on the Currency tab:  npx electron scripts/test-stash-capture.js
// NOTE: use Windowed or Windowed-Fullscreen (exclusive fullscreen captures black).
const { app, desktopCapturer, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const DR = require('../renderer/stash/digit-reader');
const MAP = require('../renderer/stash/currency-tab-map');
const PRICES = require('../renderer/stash/currency-prices.sample.json');
const TEMPLATES = require('../renderer/stash/digit-templates.json');

const OUT = path.join(require('os').tmpdir(), 'poe2-live-capture.png');
const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 1 });

function valueChannel(img) {
  const { width: W, height: H } = img.getSize();
  const buf = img.toBitmap();
  const V = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    let m = buf[p]; if (buf[p + 1] > m) m = buf[p + 1]; if (buf[p + 2] > m) m = buf[p + 2];
    V[i] = m;
  }
  return { V, W, H };
}

app.whenReady().then(async () => {
  const disp = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = disp.size;
  const scale = disp.scaleFactor;
  console.log(`primary display: ${sw}x${sh} @ ${scale}x scale`);

  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: Math.round(sw * scale), height: Math.round(sh * scale) },
  });
  console.log('\nsources:');
  for (const s of sources) console.log(`  [${s.id}] ${s.name}  (${s.thumbnail.getSize().width}x${s.thumbnail.getSize().height})`);

  let src = sources.find((s) => /path of exile/i.test(s.name));
  if (!src) { console.log('\nNo "Path of Exile" window found — falling back to primary screen.'); src = sources.find((s) => s.id.startsWith('screen')); }
  if (!src) { console.log('No capturable source.'); return app.exit(1); }

  const img = src.thumbnail;
  fs.writeFileSync(OUT, img.toPNG());
  const { V, W, H } = valueChannel(img);
  console.log(`\ncaptured "${src.name}" -> ${W}x${H}  saved: ${OUT}`);

  if (W !== MAP.captureSize.w || H !== MAP.captureSize.h) {
    console.log(`\n[calibration needed] capture ${W}x${H} != reference ${MAP.captureSize.w}x${MAP.captureSize.h}.`);
    console.log('Open the saved PNG so we can map the grid for this resolution.');
    return app.exit(0);
  }

  const templates = DR.templatesFromJSON(TEMPLATES);
  const items = PRICES.items, divPx = PRICES.divine_price_ex;
  let total = 0, read = 0, flagged = 0;
  for (const slot of MAP.STATIC_SLOTS) {
    const raw = DR.readCell(V, W, H, slot.cx, slot.cy, templates, DR.DEFAULTS);
    if (raw === '?') { flagged++; continue; }
    const px = items[slot.apiId] ? items[slot.apiId].ex : 0;
    total += parseInt(raw, 10) * px; read++;
  }
  console.log(`\nLIVE currency-tab total: ${fmt(total)} ex  (~${fmt(total / divPx)} div)`);
  console.log(`slots read: ${read}/${MAP.STATIC_SLOTS.length}  flagged: ${flagged}`);
  app.exit(0);
});
