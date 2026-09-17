'use strict';
// Every tab's reference capture must still detect as ITSELF. Run after any
// tab-templates.json re-bake: a new template that wins its own tab but steals
// another one is the failure mode that turned Soul Cores into Ancient Augments.
//   node_modules/electron/dist/electron.exe dev/stash-matcher/detect-regression.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const TD = require(path.join(ROOT, 'renderer', 'stash', 'tab-detect.js'));
const TT = require(path.join(ROOT, 'renderer', 'stash', 'tab-templates.json'));
const REFS = path.join(__dirname, 'refs');
// a reference whose panel is not at TT.box records its own box (refs/boxes.json)
const BOXES = (() => { try { return JSON.parse(fs.readFileSync(path.join(REFS, 'boxes.json'), 'utf8')); } catch { return {}; } })();

app.whenReady().then(() => {
  let fails = 0, n = 0;
  for (const file of fs.readdirSync(REFS).filter((f) => f.endsWith('.png'))) {
    const want = file.replace(/\.png$/, '');
    const img = nativeImage.createFromPath(path.join(REFS, file));
    const { width: W, height: H } = img.getSize();
    if (!W) { console.log('SKIP ' + file + ' (unreadable)'); continue; }
    const box = BOXES[want] || TT.box;
    const det = TD.detect(img.toBitmap(), W, H, box, TT);
    n++;
    const ok = det && det.tab === want;
    if (!ok) fails++;
    console.log((ok ? 'ok   ' : 'FAIL ') + want.padEnd(18)
      + ' -> ' + (det ? det.tab.padEnd(18) + det.score.toFixed(3) : 'null')
      + (det ? '   runner-up ' + det.runnerUp + ' ' + det.runnerScore.toFixed(3) : ''));
  }
  console.log('\n' + n + ' tabs, ' + fails + ' failures');
  app.exit(fails ? 1 : 0);
});
