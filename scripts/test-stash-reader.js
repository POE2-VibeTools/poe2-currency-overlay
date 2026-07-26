// Electron main-process harness: decode a stash-tab screenshot via nativeImage,
// run the JS digit reader against ground truth, print SCORE + misses.
// Run:  npx electron scripts/test-stash-reader.js
// Fixture (gitignored, ~3MB): screenshots/currency tab.png
const { app, nativeImage } = require('electron');
const path = require('path');
const DR = require('../renderer/stash/digit-reader');

// position-keyed ground truth (from recog.py GT_CURRENCY): [cx, cy, "value"]
const GT = [
  [164,209,"69"],[240,208,"582"],[550,208,"16"],[50,209,"194"],[108,209,"707"],
  [301,209,"451"],[438,209,"39"],[495,209,"114"],
  [47,271,"58"],[107,271,"605"],[161,272,"96"],[242,272,"58"],[300,272,"7"],
  [368,271,"1383"],[554,271,"160"],
  [51,334,"1611"],[104,334,"151"],[159,334,"16"],[429,354,"204"],[491,353,"252"],[555,354,"529"],
  [54,397,"4822"],[106,397,"31"],[163,397,"8"],[489,416,"118"],[556,416,"300"],
  [157,460,"8"],[53,460,"1550"],[101,461,"71"],[553,498,"201"],
  [264,580,"6"],[200,581,"7"],[328,581,"9"],[390,581,"7"],
  [127,651,"17"],[184,650,"18"],[241,650,"18"],[299,650,"33"],[353,651,"4"],[412,651,"34"],[468,650,"18"],
  [128,706,"16"],[181,706,"3"],[240,706,"13"],[297,706,"21"],[355,707,"14"],[413,706,"30"],[473,706,"26"],
  [378,209,"67"], // marble-face "67" (prototype returned "?")
];

const IMG = path.join(__dirname, '..', 'screenshots', 'currency tab.png');

app.whenReady().then(() => {
  const abs = process.env.IMG || IMG;
  const img = nativeImage.createFromPath(abs);
  const { width: W, height: H } = img.getSize();
  console.log(`image ${W}x${H}`);
  const V = DR.valueChannelDesatMax(img.toBitmap(), W, H); // flat-white isolation

  const P = DR.DEFAULTS;
  const { templates, counts } = DR.extractTemplates(V, W, H, GT, P);
  console.log('template coverage:', JSON.stringify(counts));

  let ok = 0; const misses = [];
  for (const [cx, cy, val] of GT) {
    const pred = DR.readCell(V, W, H, cx, cy, templates, P);
    if (pred === val) ok++; else misses.push([cx, cy, val, pred]);
  }
  console.log(`\nSCORE ${ok}/${GT.length}`);
  if (misses.length) {
    console.log(`Misses (${misses.length}):`);
    for (const [cx, cy, t, p] of misses) console.log(`  @(${cx},${cy}) truth=${t} pred=${p}`);
  }
  app.exit(0);
});
