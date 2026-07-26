const { app, nativeImage } = require('electron');
const fs=require('fs'),path=require('path');
const REPO='C:/Users/dbatc/Documents/Overlay App';
const DR=require(REPO+'/renderer/stash/digit-reader');
const TEMPLATES=require(REPO+'/renderer/stash/digit-templates.json');
const META=JSON.parse(fs.readFileSync(__dirname+'/iconmatch/essences/_meta.json'));
const VALID=new Set(META.map(m=>m.apiId));
const LIVE=path.join(require('os').tmpdir(),'poe2-screen-capture.png');

const TIERS=['lesser','','greater','perfect']; // col0..3
const apiOf=(type,ti)=>{const t=TIERS[ti];return t?`${t}-essence-of-${type}`:`essence-of-${type}`;};
const LEFT={xs:[60,102,160,216], ys:[203,260,316,372,430,487,543,599,657,713],
  types:['the-body','the-mind','enhancement','flames','insulation','ice','thawing','electricity','grounding','ruin']};
const RIGHT={xs:[398,440,497,551], ys:[202,259,316,373,430,487,543,600,657],
  types:['command','abrasion','sorcery','haste','alacrity','seeking','battle','the-infinite','opulence']};
const MID=[[277,602,'hysteria'],[330,602,'horror'],[277,656,'delirium'],[330,656,'insanity'],[277,714,'the-abyss'],[330,714,'the-breach']]
  .map(([cx,cy,ty])=>({cx,cy,apiId:`essence-of-${ty}`}));

const slots=[];
for(const B of [LEFT,RIGHT])for(let r=0;r<B.ys.length;r++)for(let c=0;c<B.xs.length;c++){
  const id=apiOf(B.types[r],c); if(!VALID.has(id))continue; slots.push({cx:B.xs[c],cy:B.ys[r],apiId:id});}
for(const m of MID){ if(VALID.has(m.apiId)) slots.push(m); else console.log('MID invalid',m.apiId); }

app.whenReady().then(()=>{
  const img=nativeImage.createFromPath(LIVE);const{width:W,height:H}=img.getSize();
  const V=DR.valueChannelDesatMax(img.toBitmap(),W,H);const T=DR.templatesFromJSON(TEMPLATES);
  let filled=0,empty=0;const lines=[];
  for(const s of slots){const raw=DR.readCell(V,W,H,s.cx,s.cy,T,DR.DEFAULTS);if(raw==='?')empty++;else filled++;
    lines.push(`    { cx: ${s.cx}, cy: ${s.cy}, apiId: '${s.apiId}' },`);}
  const mod=`'use strict';
// Static slot -> currency map for the PoE2 Essence stash tab (fixed layout).
// Grid: each row = one essence type, each column = a tier (Lesser / Normal /
// Greater / Perfect). Left + right 4-col blocks + middle special/corrupted
// essences. Coords = stack-count number center at 1920x1080 screen capture.
// Types verified against a live tab (Runes of Aldur, 2026-07); tier+position from
// the grid structure (auto). Middle idol/craft slots are not essences (omitted).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).essenceTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STATIC_SLOTS = [
${lines.join('\n')}
  ];
  return { tab: 'essence', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS };
});
`;
  fs.writeFileSync(REPO+'/renderer/stash/essence-tab-map.js', mod);
  console.log(`${slots.length} slots (${filled} read, ${empty} empty) -> wrote essence-tab-map.js`);
  app.exit(0);
});
