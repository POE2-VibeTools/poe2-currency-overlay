// Extract digit exemplars from the RUNES tab capture. A glyph is a glyph - the digits are
// the same font in every tab - so any capture with known counts is a template source, not
// just the currency tab. This one carries 45 blue-rune slots, more than currency's 35.
const { app, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/dbatc/Documents/Overlay App';
const DR = require(ROOT + '/renderer/stash/digit-reader');
const TD = require(ROOT + '/renderer/stash/tab-detect');
const PF = require(ROOT + '/renderer/stash/panel-finder');
const TT = require(ROOT + '/renderer/stash/tab-templates.json');
const MAP = require(ROOT + '/renderer/stash/runes-tab-map');
const P = DR.DEFAULTS, refBox = TT.box;
const CORPUS = 'C:/Users/dbatc/AppData/Local/Temp/claude/C--Users-dbatc-Documents-Overlay-App/4de79558-d22b-447d-8064-6bf878b1d5db/scratchpad/corpus';
const FILE = '2026-08-06_c73045c9-119c-4177-aeeb-f54232add17a.png';

// transcribed by eye, row-major, matching the map's own row/column order.
// '' = empty slot. Only the BLUE section (cy 255-506) is used: the purple section below
// has decorative gaps that are easy to mis-pair, and a mis-paired glyph poisons a template.
const GRID = {
  255: ['5', '1', '36', '3', '3', '20', '6', '4', '28'],
  318: ['8', '1', '25', '4', '2', '13', '4', '3', '17'],
  381: ['', '2', '16', '4', '1', '14', '2', '1', '25'],
  444: ['1', '4', '13', '1', '2', '8', '', '', '9'],
  506: ['2', '', '12', '1', '1', '1', '', '9'], // 8 wide: no lesser-charging slot
};

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(path.join(CORPUS, FILE));
  const { width: W, height: H } = img.getSize();
  const buf = img.toBitmap();
  const box = PF.frameToContent({ x: 0, y: 0, w: W, h: H }); // submitted crop IS the frame
  const V = DR.valueChannelDesatMax(buf, W, H);

  // rebuild the map's rows so transcription pairs positionally
  const rows = {};
  for (const s of MAP.STATIC_SLOTS) (rows[s.cy] = rows[s.cy] || []).push(s);
  for (const cy of Object.keys(rows)) rows[cy].sort((a, b) => a.cx - b.cx);

  const gt = [];
  let paired = 0, mismatch = 0;
  for (const [cy, counts] of Object.entries(GRID)) {
    const slots = rows[cy];
    if (!slots || slots.length !== counts.length) {
      console.log(`ROW ${cy}: map has ${slots ? slots.length : 0} slots, transcription has ${counts.length} - SKIPPED`);
      mismatch++;
      continue;
    }
    slots.forEach((s, i) => {
      if (!counts[i]) return;
      const p = TD.scalePos(s.cx, s.cy, refBox, box);
      gt.push([p.cx, p.cy, counts[i]]);
      paired++;
    });
  }
  console.log(`paired ${paired} counts across ${Object.keys(GRID).length - mismatch} rows`);

  const ex = DR.extractTemplates(V, W, H, gt, P);
  console.log('glyphs extracted:', Object.keys(ex.templates).sort().join(','));
  console.log('exemplars per digit:', JSON.stringify(ex.counts));

  // verify the transcription by reading those same cells back
  let ok = 0, tot = 0; const bad = [];
  for (const [cx, cy, want] of gt) {
    tot++;
    const got = DR.readCellAdaptive(V, W, H, cx, cy, DR.templatesFromJSON(require(ROOT + '/renderer/stash/digit-templates.json')), P, 1).text;
    if (got === want) ok++; else bad.push(`${want}->${got}`);
  }
  console.log(`\nsanity: current reader agrees with my transcription on ${ok}/${tot}`);
  console.log('disagreements:', bad.slice(0, 12).join('  '));

  const out = {};
  for (const ch of Object.keys(ex.templates)) out[ch] = { w: ex.templates[ch].w, h: ex.templates[ch].h, data: Array.from(ex.templates[ch].data) };
  fs.writeFileSync(path.join(CORPUS, '..', 'runes-variant.json'), JSON.stringify({ source: 'runes-1920x1080', templates: out }));
  console.log('\nwrote runes-variant.json');
  app.quit();
});
