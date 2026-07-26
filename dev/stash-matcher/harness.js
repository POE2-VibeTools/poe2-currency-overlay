// Shared evaluation harness for the icon-matcher grind. Pure Node.
// dataset.json: { size:40, cells:[{apiId, rgb:[r,g,b,...] len size*size*3}],
//                 candidates:[{apiId,name,cat, rgba:[r,g,b,a,...] len size*size*4}] }
// Cells are in-game slot icons (opaque, on dark navy ~[26,26,40], with a stack
// number overlaid in the TOP-LEFT ~13x13 of the 40x40 that you should ignore/mask).
// Candidates are catalog icons (transparent bg; composite on navy to compare).
// GOAL: rank each cell's true apiId #1 among all candidates. Maximize TOP1.
const fs = require('fs');
const D = JSON.parse(fs.readFileSync(__dirname + '/dataset.json'));
const S = D.size; // 40
// evaluate(prep, score): prep(rec, isCand)->feature; score(fa, fb)->higher=better
function evaluate(prep, score, label) {
  const cands = D.candidates.map((c) => ({ apiId: c.apiId, name: c.name, f: prep(c, true) }));
  let t1 = 0, t3 = 0; const miss = [];
  for (const cell of D.cells) {
    const cf = prep(cell, false);
    const ranked = cands.map((c) => ({ apiId: c.apiId, s: score(cf, c.f) })).sort((a, b) => b.s - a.s);
    const r = ranked.findIndex((x) => x.apiId === cell.apiId);
    if (r === 0) t1++; if (r >= 0 && r < 3) t3++;
    if (r !== 0) miss.push(`${cell.apiId} -> got ${ranked[0].apiId} (true rank ${r})`);
  }
  console.log(`${label || 'result'}: TOP1 ${t1}/${D.cells.length}  TOP3 ${t3}/${D.cells.length}`);
  miss.forEach((m) => console.log('  ' + m));
  return t1;
}
module.exports = { D, S, evaluate };
