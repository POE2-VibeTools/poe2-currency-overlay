// Does widening the count strip fix the wide-4-digit drops (1084 -> 108, 1608 -> 160)
// without breaking anything? Leave the templates alone; sweep P.stripWidth over the
// ground-truthed captures and count exact-match slots per width.
//
//   npx electron dev/stash-matcher/stripwidth-eval.js
const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:/Users/dbatc/Documents/Overlay App';
const DR = require(ROOT + '/renderer/stash/digit-reader');
const TD = require(ROOT + '/renderer/stash/tab-detect');
const PF = require(ROOT + '/renderer/stash/panel-finder');
const TT = require(ROOT + '/renderer/stash/tab-templates.json');
const MAP = require(ROOT + '/renderer/stash/currency-tab-map');
const { bank: DIGITS, unmap: UNMAP } = DR.bankFromJSON(require(ROOT + '/renderer/stash/digit-templates.json'));
const refBox = TT.box;

const OLD = 'C:/Users/dbatc/AppData/Local/Temp/claude/C--Users-dbatc-Documents-Overlay-App/4de79558-d22b-447d-8064-6bf878b1d5db/scratchpad';
const CORPUS = OLD + '/corpus';

// ground truths carried over from bake-templates-eval.js + today's windowed capture
const T_A = { transmute:'249','greater-orb-of-transmutation':'77','perfect-orb-of-transmutation':'10',alch:'133',vaal:'24',annul:'5','lesser-jewellers-orb':'74','greater-jewellers-orb':'7','perfect-jewellers-orb':'8',aug:'154','greater-orb-of-augmentation':'90','perfect-orb-of-augmentation':'14',chance:'19','fracturing-orb':'',divine:'31',artificers:'61',regal:'166','greater-regal-orb':'12','perfect-regal-orb':'1',etcher:'53',scrap:'163',whetstone:'107',exalted:'175','greater-exalted-orb':'6','perfect-exalted-orb':'',bauble:'6',gcp:'10',chaos:'74','greater-chaos-orb':'1','perfect-chaos-orb':'',wisdom:'185','transmutation-shard':'1','regal-shard':'2','chance-shard':'7','artificers-shard':'4' };
const T_B = { transmute:'247','greater-orb-of-transmutation':'157','perfect-orb-of-transmutation':'29',alch:'301',vaal:'120',annul:'33','lesser-jewellers-orb':'140','greater-jewellers-orb':'26','perfect-jewellers-orb':'2',aug:'33','greater-orb-of-augmentation':'366','perfect-orb-of-augmentation':'57',chance:'60','fracturing-orb':'',divine:'596',artificers:'188',regal:'663','greater-regal-orb':'59','perfect-regal-orb':'5',etcher:'107',scrap:'459',whetstone:'386',exalted:'403','greater-exalted-orb':'36','perfect-exalted-orb':'4',bauble:'43',gcp:'72',chaos:'652','greater-chaos-orb':'41','perfect-chaos-orb':'5','transmutation-shard':'4','regal-shard':'6','chance-shard':'5' };
const T_C = (() => { try { return JSON.parse(fs.readFileSync(OLD + '/truths.json', 'utf8')).T_C; } catch { return null; } })();
// today's windowed 1080 capture - counts verified by eye against the stash screenshot;
// slots whose tiles could not be read with certainty are omitted rather than guessed
const T_TODAY = { transmute:'195','greater-orb-of-transmutation':'707','perfect-orb-of-transmutation':'69',alch:'556',vaal:'486',annul:'1','lesser-jewellers-orb':'39','greater-jewellers-orb':'114','perfect-jewellers-orb':'16',aug:'45','greater-orb-of-augmentation':'605','perfect-orb-of-augmentation':'100',chance:'62',divine:'1084',artificers:'160',regal:'1608','greater-regal-orb':'151','perfect-regal-orb':'19',etcher:'204',scrap:'252',whetstone:'529',exalted:'4112','greater-exalted-orb':'39','perfect-exalted-orb':'9',bauble:'118',gcp:'300',chaos:'1763','greater-chaos-orb':'72','perfect-chaos-orb':'8',wisdom:'161','transmutation-shard':'9','regal-shard':'4','artificers-shard':'7' };

// capture file -> truth (files named by the old session's corpus + today's)
// corpus entries are PANEL CROPS (the old eval's convention), full frames carry a box
const T_UW = { transmute:'107','greater-orb-of-transmutation':'138','perfect-orb-of-transmutation':'31',alch:'251',vaal:'2','lesser-jewellers-orb':'78','greater-jewellers-orb':'55','perfect-jewellers-orb':'5',aug:'91','greater-orb-of-augmentation':'424','perfect-orb-of-augmentation':'7',chance:'16',divine:'18',artificers:'108',regal:'11','greater-regal-orb':'68','perfect-regal-orb':'4',etcher:'97',scrap:'139',whetstone:'62',exalted:'91','greater-exalted-orb':'16',bauble:'48',gcp:'89',chaos:'13' };
const CASES = [
  ['ultrawide', ROOT + '/screenshots/ultra wide example.png', T_UW, null, false],
  ['A', CORPUS + '/2026-08-06_deeb27b8-790f-4c3a-addc-e56e2f71e641.png', T_A, null, true],
  ['B', CORPUS + '/2026-08-06_5820193d-cc93-4d6e-96d0-64641c4996dd.png', T_B, null, true],
  ['C', CORPUS + '/2026-08-05_204267c7-2440-4dcd-8237-24d6171f0197.png', T_C, null, true],
  ['today', ROOT + '/dev/dialog-captures/networth-windowed-1080.png', T_TODAY, { x: 18, y: 168, w: 582, h: 606 }, false],
  // same stash, captured minutes later in true windowed-fullscreen: same truth
  ['native', ROOT + '/dev/dialog-captures/networth-native-1080.png', T_TODAY, null, false],
];

function loadRGBA(f) {
  const img = nativeImage.createFromPath(f);
  const s = img.getSize();
  if (!s.width) return null;
  const b = img.toBitmap();
  const rgba = new Uint8ClampedArray(b.length);
  for (let i = 0; i < b.length; i += 4) {
    rgba[i] = b[i + 2]; rgba[i + 1] = b[i + 1]; rgba[i + 2] = b[i]; rgba[i + 3] = b[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

function readAll(im, calBox, isCrop, P) {
  // mirror bake-templates-eval: crops read as their own panel; full frames use the
  // panel finder (or the given calibration box) + scalePos, no normalisation pass
  let box;
  if (isCrop) box = PF.frameToContent({ x: 0, y: 0, w: im.w, h: im.h });
  else if (calBox) box = calBox;
  else {
    const f = PF.findPanel(Buffer.from(im.rgba.buffer, im.rgba.byteOffset, im.rgba.byteLength), im.w, im.h);
    box = PF.frameToContent(f);
  }
  const V = DR.valueChannelDesatMax(im.rgba, im.w, im.h);
  const out = {};
  for (const s of MAP.STATIC_SLOTS) {
    const p = TD.scalePos(s.cx, s.cy, refBox, box);
    const r = DR.readCellAdaptive(V, im.w, im.h, p.cx, p.cy, DIGITS, P, 1);
    out[s.apiId] = r.text === '?' ? '' : UNMAP(r.text);
  }
  return out;
}

app.whenReady().then(() => {
  for (const sw of [17]) {
    const P = Object.assign({}, DR.DEFAULTS, { stripWidth: sw });
    let okT = 0, badT = 0;
    const lines = [];
    for (const [name, file, truth, cal, isCrop] of CASES) {
      if (!truth) { lines.push('  ' + name + ': no truth, skipped'); continue; }
      const im = loadRGBA(file);
      if (!im) { lines.push('  ' + name + ': missing file'); continue; }
      const reads = readAll(im, cal || null, !!isCrop, P);
      let ok = 0, bad = 0;
      const misses = [];
      for (const [id, want] of Object.entries(truth)) {
        if (want === '' || want == null) continue;
        const got = reads[id] || '';
        if (got === String(want)) ok++;
        else { bad++; misses.push(id + ' ' + want + '->' + (got || '?')); }
      }
      okT += ok; badT += bad;
      lines.push('  ' + name + ': ' + ok + ' ok, ' + bad + ' wrong' + (misses.length ? '   [' + misses.slice(0, 6).join(', ') + ']' : ''));
    }
    console.log('stripWidth ' + sw + ':  TOTAL ' + okT + ' ok, ' + badT + ' wrong');
    for (const l of lines) console.log(l);
  }
  app.exit(0);
});
