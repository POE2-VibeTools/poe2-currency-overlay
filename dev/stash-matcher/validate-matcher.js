// Validate renderer/stash/icon-matcher.js against the preserved Abyss ground
// truth. Expect TOP1 20/20 (parity with the reference matcher). Pure Node.
//   node dev/stash-matcher/validate-matcher.js
//   DATASET=<path to iconmatch/dataset.json> node dev/stash-matcher/validate-matcher.js
const fs = require('fs');
const IM = require('../../renderer/stash/icon-matcher.js');

const DEFAULT_DS = 'C:/Users/dbatc/AppData/Local/Temp/claude/C--Users-dbatc-Documents-Overlay-App/5d9c0f92-b114-42b4-abf5-f3d16da4caef/scratchpad/stash-reader-proto/iconmatch/dataset.json';
const dsPath = process.env.DATASET || DEFAULT_DS;
const D = JSON.parse(fs.readFileSync(dsPath, 'utf8'));
const S = D.size;

const cands = D.candidates.map((c) => ({
  apiId: c.apiId, name: c.name,
  f: IM.prepCandidate(Uint8Array.from(c.rgba), { size: S })
}));

let t1 = 0, t3 = 0; const miss = [];
for (const cell of D.cells) {
  const { ranked } = IM.match(Uint8Array.from(cell.rgb), cands, { size: S });
  const r = ranked.findIndex((x) => x.apiId === cell.apiId);
  if (r === 0) t1++;
  if (r >= 0 && r < 3) t3++;
  if (r !== 0) miss.push(`${cell.apiId} -> got ${ranked[0].apiId} (true rank ${r})`);
}
console.log(`icon-matcher port: TOP1 ${t1}/${D.cells.length}  TOP3 ${t3}/${D.cells.length}  (size ${S}, ${cands.length} candidates)`);
miss.forEach((m) => console.log('  ' + m));
process.exit(t1 === D.cells.length ? 0 : 1);
