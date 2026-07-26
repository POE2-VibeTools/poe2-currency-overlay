// Offline: identify + value the currency tab's 14 DYNAMIC bottom-row cells.
// Same extraction as the validated dataset (crop 52x52 at (cx-17,cy-12), resize
// 40, BGRA->RGB) + the ported icon-matcher against a BROAD currency-class pool
// (the dynamic slots hold bones/omens/fragments/currency, not just orbs).
//   npx electron dev/stash-matcher/match-dynamic-rows.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/dbatc/Documents/Overlay App';
const DR = require(REPO + '/renderer/stash/digit-reader');
const IM = require(REPO + '/renderer/stash/icon-matcher');
const MAP = require(REPO + '/renderer/stash/currency-tab-map');
const TEMPLATES = require(REPO + '/renderer/stash/digit-templates.json');

const SP = 'C:/Users/dbatc/AppData/Local/Temp/claude/C--Users-dbatc-Documents-Overlay-App/5d9c0f92-b114-42b4-abf5-f3d16da4caef/scratchpad/stash-reader-proto';
const ICONMATCH = process.env.ICONMATCH || (SP + '/iconmatch');
const PRICING = process.env.PRICING || (SP + '/pricing');
const IMG = REPO + '/screenshots/currency tab.png';
const S = 40;

function toArr(img, rgba) {
  const r = img.resize({ width: S, height: S, quality: 'best' }).toBitmap();
  const out = [];
  for (let i = 0; i < S * S; i++) { const p = i * 4; out.push(r[p + 2], r[p + 1], r[p + 0]); if (rgba) out.push(r[p + 3]); }
  return out;
}
function prep(p) { return IM.prepCandidate(Uint8Array.from(toArr(nativeImage.createFromPath(p), true)), { size: S }); }

app.whenReady().then(() => {
  const cands = [];
  // broad pool: abyss (bones/omens), ritual (omens), fragments (splinters/keys)
  for (const cat of ['abyss', 'ritual', 'fragments']) {
    const dir = path.join(ICONMATCH, cat);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'));
    for (const m of meta) {
      const p = path.join(dir, m.apiId + '.png');
      if (fs.existsSync(p)) cands.push({ apiId: m.apiId, name: m.name, cat, f: prep(p) });
    }
  }
  // + currency orbs
  const cmap = JSON.parse(fs.readFileSync(path.join(PRICING, 'currency_map.json'), 'utf8')).items;
  const iconDir = path.join(PRICING, 'icons');
  for (const f of fs.readdirSync(iconDir)) {
    if (!f.endsWith('.png')) continue;
    const apiId = f.replace(/\.png$/, '');
    cands.push({ apiId, name: (cmap[apiId] && cmap[apiId].name) || apiId, cat: 'currency', f: prep(path.join(iconDir, f)) });
  }
  const byId = {}; cands.forEach((c) => { byId[c.apiId] = c; });

  const img = nativeImage.createFromPath(IMG);
  const { width: W, height: H } = img.getSize();
  const V = DR.valueChannelDesatMax(img.toBitmap(), W, H);
  const T = DR.templatesFromJSON(TEMPLATES);

  console.log(`pool: ${cands.length} candidates (abyss+ritual+fragments+currency) | ${W}x${H}\n`);
  for (const row of MAP.DYNAMIC_ROWS) {
    for (const x of row.xs) {
      const y = row.y;
      const count = DR.readCell(V, W, H, x, y, T, DR.DEFAULTS);
      const cell = img.crop({ x: Math.max(0, x - 17), y: Math.max(0, y - 12), width: 52, height: 52 });
      const { ranked } = IM.match(Uint8Array.from(toArr(cell, false)), cands, { size: S });
      const top = ranked.slice(0, 3).map((r) => `${byId[r.apiId].cat}/${r.apiId}(${r.score.toFixed(0)})`).join('  ');
      console.log(`(${String(x).padStart(3)},${y}) count=${String(count).padEnd(4)} -> ${top}`);
    }
  }
  app.exit(0);
});
