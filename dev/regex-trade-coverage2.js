'use strict';
// Coverage eval v2: map Regex-tab pool lines against GGG's LIVE /api/trade2/data/stats
// (the source the feature will actually search with). Run:
//   node dev/regex-trade-coverage2.js <path-to-ggg-stats.json>
const fs = require('fs');
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'renderer', 'regex', 'pools-data.js'));
const RP = global.window.RegexPools;

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// data.result = [{ id: 'Explicit'|'Implicit'|..., label, entries: [{id:'explicit.stat_X', text, type}] }]
const entries = [];
for (const grp of data.result || []) for (const e of grp.entries || []) entries.push(e);

// GGG writes numbers as '#'; normalise both sides the same way for lookup
const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')  // GGG markup [Ref|display] -> display
  .replace(/\[([^\]]+)\]/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const byText = new Map();
for (const e of entries) {
  const k = norm(e.text);
  if (!byText.has(k)) byText.set(k, []);
  byText.get(k).push(e);
}

const PROP_FILTERS = {
  'Waystone (Tier #)': 'map_tier',
  'Item Rarity: +#%': 'map_iir',
  'Pack Size: +#%': 'map_packsize',
  'Waystone Drop Chance: +#%': 'map_bonus',
  'Revives Available: #': 'map_revives',
};

function lookup(text) {
  const cands = [text, text.replace(/,\s+/g, ', ')];
  for (const c of cands) {
    const hit = byText.get(norm(c));
    if (hit) return hit;
  }
  return null;
}

let ok = 0; const miss = [];
function check(label, text, hidden) {
  if (hidden) return; // never offered in the picker
  if (PROP_FILTERS[text]) { ok++; return; }
  const hit = lookup(text);
  if (hit) {
    ok++;
    const kinds = [...new Set(hit.map((e) => e.id.split('.')[0]))];
    if (kinds.length > 1) console.log('  multi-kind: ' + text + '  [' + hit.map((e) => e.id).join(' ') + ']');
  } else miss.push(label + ': ' + text);
}

for (const m of RP.waystone || []) check('waystone', m.text, m.hidden);
for (const imp of RP.tabletImplicits || []) check('tablet-implicit', imp.text, false);
for (const ty of Object.keys(RP.tablet || {})) for (const m of RP.tablet[ty]) check('tablet/' + ty, m.text, m.hidden);

console.log('\nmapped: ' + ok + '   missed: ' + miss.length);
for (const m of miss) console.log('  MISS ' + m);
