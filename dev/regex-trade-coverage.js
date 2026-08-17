'use strict';
// Coverage eval: can every Regex-tab pool line be mapped to a trade2 stat id
// (or a map_filters key)? Run: node dev/regex-trade-coverage.js
// Mirrors the runtime path: EE2's STAT_BY_MATCH_STR is an exact-string index over
// stats.ndjson matcher strings, so this greps the same data the same way.
const fs = require('fs');
const path = require('path');

// pools-data.js is a window-global script - shim window
global.window = {};
require(path.join(__dirname, '..', 'renderer', 'regex', 'pools-data.js'));
const RP = global.window.RegexPools;

const lines = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'vendor', 'ee2', 'data', 'en', 'stats.ndjson'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const byMatch = new Map();
for (const s of lines) {
  for (const m of s.matchers || []) {
    // first one wins, like the EE2 index
    if (!byMatch.has(m.string)) byMatch.set(m.string, s);
  }
}

// the prop lines that map to map_filters instead of stats
const PROP_FILTERS = {
  'Waystone (Tier #)': 'map_tier',
  'Item Rarity: +#%': 'map_iir',
  'Pack Size: +#%': 'map_packsize',
  'Waystone Drop Chance: +#%': 'map_bonus',
  'Revives Available: #': 'map_revives',
};

function findStat(text) {
  // exact, then the known shape variants between tooltip text and EE2 matchers
  const cands = [
    text,
    text.replace(/ in Area$/, ' in this Area'),
    text.replace(/ in this Area$/, ' in Area'),
    'Map has ' + text,
    text.replace(/^#% increased number of /, '#% increased '),
  ];
  for (const c of cands) if (byMatch.has(c)) return { stat: byMatch.get(c), via: c === text ? 'exact' : c };
  return null;
}

function tradeId(stat) {
  const ids = (stat.trade && stat.trade.ids) || {};
  return (ids.explicit && ids.explicit[0]) || (ids.implicit && ids.implicit[0]) || null;
}

let ok = 0, miss = [];
function check(label, text) {
  if (PROP_FILTERS[text]) { ok++; return; }
  const hit = findStat(text);
  if (hit && tradeId(hit.stat)) { ok++; if (hit.via !== 'exact') console.log('  via variant: ' + text + '  ->  ' + hit.via); }
  else miss.push(label + ': ' + text + (hit ? ' (stat found, NO trade id)' : ''));
}

for (const m of RP.waystone || []) check('waystone', m.text);
for (const imp of RP.tabletImplicits || []) check('tablet-implicit', imp.text);
for (const ty of Object.keys(RP.tablet || {})) for (const m of RP.tablet[ty]) check('tablet/' + ty, m.text);

console.log('\nmapped: ' + ok + '   missed: ' + miss.length);
for (const m of miss) console.log('  MISS ' + m);
