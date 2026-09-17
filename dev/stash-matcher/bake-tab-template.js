'use strict';
// Re-bake ONE tab's panel signature in renderer/stash/tab-templates.json from a live
// capture. GGG re-lays-out these tabs between patches (0.5.5 turned Soul Cores from
// 30 slots into 47), and a stale signature does not fail loudly - it quietly matches
// some OTHER tab, which is how Soul Cores started reading as Ancient Augments.
//
//   node_modules/electron/dist/electron.exe dev/stash-matcher/bake-tab-template.js \
//     --tab soulcore --img <full-game-window.png> [--box x,y,w,h] [--write]
//
// The box must be the same panel content box the reader detects (REF_BOX in main.js at
// reference resolution). Without --write it only reports what the new signature would
// score against every existing template, which is the check that matters: the target
// tab must win by a clear margin, and no other tab may lose its own identity.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const TD = require(path.join(ROOT, 'renderer', 'stash', 'tab-detect.js'));
const TT_PATH = path.join(ROOT, 'renderer', 'stash', 'tab-templates.json');
const TT = JSON.parse(fs.readFileSync(TT_PATH, 'utf8'));

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TAB = arg('tab');
const IMG = arg('img');
const WRITE = process.argv.includes('--write');
const BOX = arg('box') ? (() => { const [x, y, w, h] = arg('box').split(',').map(Number); return { x, y, w, h }; })() : TT.box;

if (!TAB || !IMG) { console.error('need --tab and --img'); process.exit(1); }

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(IMG);
  const { width: W, height: H } = img.getSize();
  if (!W) { console.error('could not read ' + IMG); app.exit(1); return; }
  const buf = img.toBitmap();
  console.log('image ' + W + 'x' + H + '   box ' + JSON.stringify(BOX));

  const sig = TD.panelSignature(buf, W, H, BOX, TT.tw, TT.th);

  console.log('\nthis capture scored against the CURRENT templates:');
  const before = TD.detect(buf, W, H, BOX, TT);
  const ranked = Object.keys(TT.templates).map((tab) => {
    const t = TT.templates[tab];
    const tf = new Float64Array(t.length); let ss = 0;
    for (let i = 0; i < t.length; i++) { tf[i] = t[i]; ss += t[i] * t[i]; }
    const n = Math.sqrt(ss) || 1; for (let i = 0; i < tf.length; i++) tf[i] /= n;
    let s = 0; for (let i = 0; i < sig.length; i++) s += sig[i] * tf[i];
    return { tab, score: s };
  }).sort((a, b) => b.score - a.score);
  ranked.slice(0, 5).forEach((r) => console.log('   ' + (r.tab === TAB ? '*' : ' ') + r.tab.padEnd(18) + r.score.toFixed(3)));
  console.log('  => detected as "' + before.tab + '" (' + before.score.toFixed(3) + ')');

  // int-scale the new signature the way the file stores them
  const baked = Array.from(sig, (v) => Math.round(v * TT.scale));
  const next = JSON.parse(JSON.stringify(TT));
  next.templates[TAB] = baked;

  const after = TD.detect(buf, W, H, BOX, next);
  console.log('\nwith the re-baked "' + TAB + '" template:');
  console.log('  => detected as "' + after.tab + '" (' + after.score.toFixed(3) + '), runner-up ' + after.runnerUp + ' (' + after.runnerScore.toFixed(3) + ')');

  if (!WRITE) { console.log('\n(dry run - pass --write to save)'); app.exit(0); return; }
  fs.writeFileSync(TT_PATH, JSON.stringify(next));
  console.log('\nwrote ' + TT_PATH);
  app.exit(0);
});
