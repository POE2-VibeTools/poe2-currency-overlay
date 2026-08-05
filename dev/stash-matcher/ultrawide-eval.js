// Score the Net Worth digit reader against a REAL user capture, not the reference image
// the templates were cut from. Run:  npx electron dev/stash-matcher/ultrawide-eval.js
//
// Why this exists: the reader scores ~0.98 on screenshots/currency tab.png and 0.60-0.79
// on any genuinely different client rendering. Tuning against the reference image is what
// created that. Score here before believing any reader change.
// Background: dev-docs/2.6.1-HANDOFF-RATIONALE.md
const { app, nativeImage } = require('electron');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DR = require(path.join(ROOT, 'renderer/stash/digit-reader'));
const TD = require(path.join(ROOT, 'renderer/stash/tab-detect'));
const TAB_TEMPLATES = require(path.join(ROOT, 'renderer/stash/tab-templates.json'));
const MAP = require(path.join(ROOT, 'renderer/stash/currency-tab-map'));
const DIGITS = DR.templatesFromJSON(require(path.join(ROOT, 'renderer/stash/digit-templates.json')));
const refBox = TAB_TEMPLATES.box;
const P = DR.DEFAULTS;

// 3840x1078 community capture. Panel box found by grid-searching the tab detector;
// panel scale 1.079. Note the 1078 height - this fails at essentially REFERENCE scale,
// which is why "it's a resolution bug" was the wrong diagnosis.
const FIXTURE = path.join(ROOT, 'screenshots', 'ultra wide example.png');
const BOX = { x: 16, y: 118, w: 629, h: 654 };

// Read off the image by eye. '' = empty slot. Expensive to re-derive - edit only if you
// have re-verified against the picture.
const TRUTH = {
  transmute: '107', 'greater-orb-of-transmutation': '138', 'perfect-orb-of-transmutation': '31',
  alch: '251', vaal: '2', annul: '',
  'lesser-jewellers-orb': '78', 'greater-jewellers-orb': '55', 'perfect-jewellers-orb': '5',
  aug: '91', 'greater-orb-of-augmentation': '424', 'perfect-orb-of-augmentation': '7',
  chance: '16', 'fracturing-orb': '', divine: '18', artificers: '108',
  regal: '11', 'greater-regal-orb': '68', 'perfect-regal-orb': '4',
  etcher: '97', scrap: '139', whetstone: '62',
  exalted: '91', 'greater-exalted-orb': '16', 'perfect-exalted-orb': '',
  bauble: '48', gcp: '89', chaos: '13',
};

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(FIXTURE);
  const { width: W, height: H } = img.getSize();
  if (!W) { console.error(`fixture missing: ${FIXTURE}`); return app.quit(); }
  const buf = img.toBitmap();
  const scale = BOX.h / refBox.h;

  const det = TD.detect(buf, W, H, BOX, TAB_TEMPLATES);
  console.log(`fixture ${W}x${H}   panel scale ${scale.toFixed(3)}   detect ${det.tab} ${det.score.toFixed(3)} (runner-up ${det.runnerUp} ${det.runnerScore.toFixed(3)})\n`);

  // A) pre-2.6.1: rescale every cell
  const Vnat = DR.valueChannelDesatMax(buf, W, H);
  const readOld = (s) => {
    const p = TD.scalePos(s.cx, s.cy, refBox, BOX);
    return DR.readCellEx(Vnat, W, H, p.cx, p.cy, DIGITS, P, scale).text;
  };

  // B) current: normalise the panel once, then read at reference scale
  const M = 24, kx = BOX.w / refBox.w, ky = BOX.h / refBox.h;
  const W2 = Math.round(refBox.w + 2 * M), H2 = Math.round(refBox.h + 2 * M);
  const norm = DR.resampleRGBA(buf, W, H, BOX.x - M * kx, BOX.y - M * ky,
    (refBox.w + 2 * M) * kx, (refBox.h + 2 * M) * ky, W2, H2);
  const Vn = DR.valueChannelDesatMax(norm, W2, H2);
  const readNew = (s) => DR.readCellEx(Vn, W2, H2, s.cx - (refBox.x - M), s.cy - (refBox.y - M), DIGITS, P, 1).text;

  const clean = (t) => (t === '?' ? '' : t);
  let a = 0, b = 0, n = 0;
  console.log('slot'.padEnd(30) + 'truth'.padEnd(9) + 'per-cell'.padEnd(11) + 'normalised');
  console.log('-'.repeat(62));
  for (const s of MAP.STATIC_SLOTS) {
    if (!(s.apiId in TRUTH)) continue;
    const t = TRUTH[s.apiId], ra = clean(readOld(s)), rb = clean(readNew(s));
    n++; if (ra === t) a++; if (rb === t) b++;
    const mk = (r) => (r === t ? '' : ' x');
    console.log(s.apiId.padEnd(30) + (t || '(empty)').padEnd(9)
      + ((ra || '-') + mk(ra)).padEnd(11) + ((rb || '-') + mk(rb)));
  }
  console.log(`\nper-cell rescale (pre-2.6.1)  ${a}/${n}`);
  console.log(`normalise-once   (current)    ${b}/${n}`);
  console.log('\nBar for calling the reader fixed: 24/28. Anything less is not a fix.');
  app.quit();
});
