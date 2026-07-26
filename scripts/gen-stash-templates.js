// Extract the 0-9 digit templates from the reference currency-tab capture and
// serialize them, so the runtime reader can match WITHOUT ground truth.
// Font/UI-scale is consistent at a given resolution, so one baked set works for
// every same-resolution capture. Run: npx electron scripts/gen-stash-templates.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const DR = require('../renderer/stash/digit-reader');

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
const OUT = path.join(__dirname, '..', 'renderer', 'stash', 'digit-templates.json');

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(process.env.IMG || IMG);
  const { width: W, height: H } = img.getSize();
  const V = DR.valueChannelDesatMax(img.toBitmap(), W, H); // flat-white isolation
  const { templates, counts } = DR.extractTemplates(V, W, H, GT, DR.DEFAULTS);
  // serialize: char -> { w, h, data:[0/1,...] }
  const out = { res: `${W}x${H}`, params: DR.DEFAULTS, templates: {} };
  for (const ch of Object.keys(templates)) {
    const t = templates[ch];
    out.templates[ch] = { w: t.w, h: t.h, data: Array.from(t.data) };
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('wrote', OUT);
  console.log('digit coverage:', JSON.stringify(counts));
  console.log('templates:', Object.keys(out.templates).sort().join(''));
  app.exit(0);
});
