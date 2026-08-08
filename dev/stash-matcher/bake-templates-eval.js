// Bake templates from THREE ground-truthed renderings and test whether a combined bank
// beats the single-rendering one on each. This is the "bake per rendering" plan at the
// smallest scale that can actually answer it: leave-one-out, so a capture is never read
// with templates cut from itself.
const { app, nativeImage } = require('electron');
const path = require('path');
const ROOT = 'C:/Users/dbatc/Documents/Overlay App';
const DR = require(ROOT + '/renderer/stash/digit-reader');
const TD = require(ROOT + '/renderer/stash/tab-detect');
const PF = require(ROOT + '/renderer/stash/panel-finder');
const TT = require(ROOT + '/renderer/stash/tab-templates.json');
const MAP = require(ROOT + '/renderer/stash/currency-tab-map');
const BASE = DR.templatesFromJSON(require(ROOT + '/renderer/stash/digit-templates.json'));
const refBox = TT.box, P = DR.DEFAULTS;
const CORPUS = 'C:/Users/dbatc/AppData/Local/Temp/claude/C--Users-dbatc-Documents-Overlay-App/4de79558-d22b-447d-8064-6bf878b1d5db/scratchpad/corpus';

const T_UW = { transmute:'107','greater-orb-of-transmutation':'138','perfect-orb-of-transmutation':'31',alch:'251',vaal:'2',annul:'','lesser-jewellers-orb':'78','greater-jewellers-orb':'55','perfect-jewellers-orb':'5',aug:'91','greater-orb-of-augmentation':'424','perfect-orb-of-augmentation':'7',chance:'16','fracturing-orb':'',divine:'18',artificers:'108',regal:'11','greater-regal-orb':'68','perfect-regal-orb':'4',etcher:'97',scrap:'139',whetstone:'62',exalted:'91','greater-exalted-orb':'16','perfect-exalted-orb':'',bauble:'48',gcp:'89',chaos:'13' };
const T_A = { transmute:'249','greater-orb-of-transmutation':'77','perfect-orb-of-transmutation':'10',alch:'133',vaal:'24',annul:'5','lesser-jewellers-orb':'74','greater-jewellers-orb':'7','perfect-jewellers-orb':'8',aug:'154','greater-orb-of-augmentation':'90','perfect-orb-of-augmentation':'14',chance:'19','fracturing-orb':'',divine:'31',artificers:'61',regal:'166','greater-regal-orb':'12','perfect-regal-orb':'1',etcher:'53',scrap:'163',whetstone:'107',exalted:'175','greater-exalted-orb':'6','perfect-exalted-orb':'',bauble:'6',gcp:'10',chaos:'74','greater-chaos-orb':'1','perfect-chaos-orb':'',wisdom:'185','transmutation-shard':'1','regal-shard':'2','chance-shard':'7','artificers-shard':'4' };
// transcribed from zoom-5820193d.png (1920x1080, panelScale 1.0693)
const T_C = JSON.parse(require('fs').readFileSync('C:/Users/dbatc/AppData/Local/Temp/claude/C--Users-dbatc-Documents-Overlay-App/4de79558-d22b-447d-8064-6bf878b1d5db/scratchpad/truths.json','utf8')).T_C;
const T_B = { transmute:'247','greater-orb-of-transmutation':'157','perfect-orb-of-transmutation':'29',alch:'301',vaal:'120',annul:'33','lesser-jewellers-orb':'140','greater-jewellers-orb':'26','perfect-jewellers-orb':'2',aug:'33','greater-orb-of-augmentation':'366','perfect-orb-of-augmentation':'57',chance:'60','fracturing-orb':'',divine:'596',artificers:'188',regal:'663','greater-regal-orb':'59','perfect-regal-orb':'5',etcher:'107',scrap:'459',whetstone:'386',exalted:'403','greater-exalted-orb':'36','perfect-exalted-orb':'4',bauble:'43',gcp:'72',chaos:'652','greater-chaos-orb':'41','perfect-chaos-orb':'5','transmutation-shard':'4','regal-shard':'6','chance-shard':'5' };

const KEYSETS = ['abcdefghij', 'klmnopqrst', 'ABCDEFGHIJ', 'KLMNOPQRST'];
const unmap = (t) => t.replace(/[a-tA-T]/g, (c) => {
  for (const ks of KEYSETS) { const i = ks.indexOf(c); if (i >= 0) return String(i); }
  return c;
});

function load(p, isCrop) {
  const i = nativeImage.createFromPath(p); const s = i.getSize(); const buf = i.toBitmap();
  const f = isCrop ? { x: 0, y: 0, w: s.width, h: s.height } : PF.findPanel(buf, s.width, s.height);
  return { buf, W: s.width, H: s.height, box: PF.frameToContent(f), V: DR.valueChannelDesatMax(buf, s.width, s.height) };
}
function gt(img, truth) {
  const out = [];
  for (const s of MAP.STATIC_SLOTS) {
    if (!(s.apiId in truth) || !truth[s.apiId]) continue;
    const p = TD.scalePos(s.cx, s.cy, refBox, img.box);
    out.push([p.cx, p.cy, truth[s.apiId]]);
  }
  return out;
}
function score(img, truth, bank) {
  let ok = 0, n = 0;
  for (const s of MAP.STATIC_SLOTS) {
    if (!(s.apiId in truth)) continue; n++;
    const p = TD.scalePos(s.cx, s.cy, refBox, img.box);
    let t = DR.readCellAdaptive(img.V, img.W, img.H, p.cx, p.cy, bank, P, 1).text;
    if (t === '?') t = '';
    if (unmap(t) === truth[s.apiId]) ok++;
  }
  return ok + '/' + n;
}

app.whenReady().then(() => {
  const caps = [
    { name: 'ultrawide', img: load(ROOT + '/screenshots/ultra wide example.png', false), truth: T_UW },
    { name: 'corpus-A', img: load(path.join(CORPUS, '2026-08-06_deeb27b8-790f-4c3a-addc-e56e2f71e641.png'), true), truth: T_A },
    { name: 'corpus-B', img: load(path.join(CORPUS, '2026-08-06_5820193d-cc93-4d6e-96d0-64641c4996dd.png'), true), truth: T_B },
    { name: 'corpus-C', img: load(path.join(CORPUS, '2026-08-05_204267c7-2440-4dcd-8237-24d6171f0197.png'), true), truth: T_C },
  ];
  // extract one exemplar set per capture
  caps.forEach((c, i) => {
    c.ex = DR.extractTemplates(c.img.V, c.img.W, c.img.H, gt(c.img, c.truth), P).templates;
    c.keys = KEYSETS[i];
    c.count = Object.keys(c.ex).length;
  });
  console.log('exemplars extracted per capture:', caps.map((c) => `${c.name}=${c.count}`).join('  '), '\n');

  console.log('capture'.padEnd(13) + 'shipped only'.padEnd(16) + 'LEAVE-ONE-OUT bank (others only)');
  console.log('-'.repeat(66));
  for (const c of caps) {
    const loo = Object.assign({}, BASE);
    for (const o of caps) {
      if (o === c) continue;                       // never read a capture with its own templates
      for (const ch of Object.keys(o.ex)) loo[o.keys[Number(ch)]] = o.ex[ch];
    }
    console.log(c.name.padEnd(13) + score(c.img, c.truth, BASE).padEnd(16) + score(c.img, c.truth, loo));
  }
  app.quit();
});
