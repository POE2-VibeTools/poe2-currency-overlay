'use strict';
// Replay a REAL captured icon crop through the matcher and print the ranking.
//
//   npx electron dev/tune-icon-match.js [expectedFamily]
//
// Reads every PNG in %APPDATA%/poe2-price-overlay/icon-diag (written by the Test read
// button while ICONDIAG is compiled in). This is the only honest test of whether the CDN
// art matches how the game actually draws it - the synthetic test in
// dev/test-currency-icons.js composites the art with itself and so can never catch a
// mismatch between the two.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CR = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-reader.js'));
const bank = require(path.join(__dirname, '..', 'renderer', 'stash', 'currency-icons.json'));

const DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'poe2-price-overlay', 'icon-diag');
const EXPECT = process.argv[process.argv.length - 1].endsWith('.js') ? null : process.argv[process.argv.length - 1];

function load(file) {
  const img = nativeImage.createFromPath(file);
  const s = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { data: rgba, w: s.width, h: s.height };
}

app.whenReady().then(() => {
  if (!fs.existsSync(DIR)) { console.log('no icon-diag directory - press Test read first'); return app.exit(1); }
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) { console.log('no crops in ' + DIR); return app.exit(1); }

  for (const f of files) {
    const shot = load(path.join(DIR, f));
    const r = CR.identify(shot, bank);
    console.log('\n=== ' + f + '   ' + shot.w + 'x' + shot.h);
    console.log('    verdict: ' + (r.family || 'NO MATCH')
      + '   score ' + r.score.toFixed(3) + '   margin ' + r.margin.toFixed(3));
    for (const a of r.all) console.log('      ' + a.score.toFixed(3) + '  ' + a.name);
    if (EXPECT) {
      // where did the RIGHT answer actually land? A correct icon ranked 9th is a very
      // different bug from one ranked 2nd.
      const all = [];
      for (const ic of bank.icons) {
        let best = 0;
        for (const box of [{ x: 0, y: 0, w: shot.w, h: shot.h }]) {
          const sig = CR.signature(shot.data, shot.w, shot.h, box, bank.n);
          best = Math.max(best, CR.ncc(sig, ic.rgb, ic.cov));
        }
        all.push({ family: ic.family, name: ic.members[0], s: best });
      }
      all.sort((x, y) => y.s - x.s);
      const at = all.findIndex((x) => x.family === EXPECT);
      console.log('    expected "' + EXPECT + '" ranks #' + (at + 1) + ' of ' + all.length
        + (at >= 0 ? ' at ' + all[at].s.toFixed(3) : ''));
    }
  }
  app.exit(0);
});
