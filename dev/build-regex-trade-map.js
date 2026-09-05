'use strict';
// Bake the Regex-tab pool -> trade2 stat-id map from GGG's LIVE stats list.
//
//   node dev/build-regex-trade-map.js <ggg-stats.json> [--write]
//
// Output: renderer/regex/trade-map.json
//   { "<pool text>": { "id": "explicit.stat_X" }              a stat filter
//   |               { "id": "...", "invert": true }           pool says less/reduced,
//   |                                                         GGG indexes more/increased:
//   |                                                         negate the value bound
//   |               { "filter": "map_tier" } }                a map_filters range instead
// Pool lines ABSENT from the map are not indexed by GGG's trade site at all
// (the 0.3 multiplicative "more" waystone family, tooltip sums like Monster
// Rarity, a few tablet lines) - the UI says so instead of silently dropping.
//
// GGG's texts differ from item tooltips in known ways, all handled here:
// value-1 singular forms ("an additional X", "for 1 second"), Map/Area printed
// both ways, tablet implicits carrying a second "# use remaining" line, and
// sign-flipped indexing (only "faster"/"increased" exists; slower is negative).
const fs = require('fs');
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'renderer', 'regex', 'pools-data.js'));
const RP = global.window.RegexPools;

const statsPath = process.argv[2];
const WRITE = process.argv.includes('--write');
const data = JSON.parse(fs.readFileSync(statsPath, 'utf8'));

// kind preference when one text lives under several ids (explicit + fractured + ...)
const KIND_RANK = { explicit: 0, implicit: 1, enchant: 2, fractured: 3, desecrated: 4, rune: 5, sanctum: 6 };

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
  .replace(/\[([^\]]+)\]/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const byText = new Map();
const allEntries = [];
for (const grp of data.result || []) {
  for (const e of grp.entries || []) {
    allEntries.push(e);
    const k = norm(e.text);
    const kind = e.id.split('.')[0];
    const prev = byText.get(k);
    if (!prev || (KIND_RANK[kind] ?? 9) < (KIND_RANK[prev.id.split('.')[0]] ?? 9)) byText.set(k, e);
  }
}

// tooltip header properties -> trade2 map_filters ranges (not stats at all).
// The key names are legacy PoE1 ids GGG repurposed - /api/trade2/data/filters is
// the authority: map_rare_monsters is literally labelled "Monster Rarity" and
// map_magic_monsters "Monster Effectiveness" there.
const PROP_FILTERS = {
  'Waystone (Tier #)': 'map_tier',
  'Item Rarity: +#%': 'map_iir',
  'Pack Size: +#%': 'map_packsize',
  'Monster Rarity: +#%': 'map_rare_monsters',
  'Monster Effectiveness: +#%': 'map_magic_monsters',
  'Waystone Drop Chance: +#%': 'map_bonus',
};

// Lines a text match WOULD bind to a stat that provably matches zero waystones -
// the dictionary text exists, but only for the tablet/atlas domain, or the trade
// site simply does not index the waystone mod. Verified live: a category
// map.waystone search on each candidate id returned total=0 against a market of
// 10000+. Mapping them anyway would zero out every search they appear in.
const DENY = new Set([
  '#% increased number of Rare Monsters',
  'Rare Monsters have # additional Modifiers',
  '#% increased Waystones found in Area',
  'Abyss Pits in Area always have Rewards',
  'Rare Monsters have #% more chance of Monster Modifiers',
]);

// pool text -> the GGG text it is indexed under, where generic candidates can't
// bridge the gap. invert: the pool line is the negative-value rendition of the
// indexed stat. Every row here was verified by hand against /data/stats.
const OVERRIDES = {
  '-#% maximum Player Resistances': { ggg: '#% maximum Player Resistances' },
  'Players have #% less Cooldown Recovery Rate': { ggg: 'Players have #% more Cooldown Recovery Rate', invert: true },
  'Players have #% less Movement and Skill Speed for each time they\'ve used a Skill Recently':
    { ggg: 'Players have #% more Movement and Skill Speed for each time they\'ve used a Skill Recently', invert: true },
  'Players and their Minions deal no damage for # out of every # seconds':
    { ggg: 'Players and their Minions deal no damage for 3 out of every 10 seconds' },
  'Area contains # additional Incubator Queens': { ggg: 'Area contains an additional Incubator Queen' },
  'Natural Rare Monsters in Area have # extra Abyssal Modifiers':
    { ggg: 'Natural Rare Monsters in Area have # extra Abyssal Modifier' },
  'Slaying Rare Monsters in Map pauses the Delirium Mirror Timer for # seconds':
    { ggg: 'Slaying Rare Monsters in Map pauses the Delirium Mirror Timer for 1 second' },
  'Delirium Fog in Map dissipates #% slower': { ggg: 'Delirium Fog in Map dissipates #% faster', invert: true },
  'Ritual Altars in Map allow rerolling Favours # additional times':
    { ggg: 'Ritual Altars in Area allow rerolling Favours an additional time' },
  'Deferring Favours at Ritual Altars in Map costs #% reduced Tribute':
    { ggg: 'Deferring Favours at Ritual Altars in Map costs #% increased Tribute', invert: true },
  'Rerolling Favours at Ritual Altars in Map costs #% reduced Tribute':
    { ggg: 'Rerolling Favours at Ritual Altars in Map costs #% increased Tribute', invert: true },
  'Unstable Breaches in Map spawn # additional Rare Monsters when Stabilised':
    { ggg: 'Unstable Breaches in Map spawn an additional Rare Monster when Stabilised' },
  'Abyssal Monsters have #% increased Effectiveness for each closed Pit,  up to #%':
    { ggg: 'Abyssal Monsters have #% increased Effectiveness for each closed Pit, up to 100%' },
  'Map is inhabited by # additional Rogue Exiles': { ggg: 'Map is inhabited by # additional Rogue Exile' },
  'Map contains # additional Azmeri Spirits': { ggg: 'Area contains # additional Azmeri Spirit' },
  // corpus-verified: real tablet listings carry the (Gold Piles) stat, not 1133965702
  '#% increased Gold found in Map': { ggg: '#% increased Gold found in Map (Gold Piles)' },
  '#% reduced Pack Size in Map': { ggg: '#% increased Pack Size in Map', invert: true },
  'Monsters have +#% Critical Damage Bonus': { ggg: 'Monsters have #% Critical Damage Bonus' },
  // 0.5.5 Expedition tablet lines: GGG stores the value-1 rendition with a literal 1
  'Expeditions contain # Additional Boss encased in ice in Map': { ggg: 'Expeditions contain 1 Additional Boss encased in ice in Map' },
  'Expeditions contain # Additional Verisium Sentry in Map': { ggg: 'Expeditions contain 1 Additional Verisium Sentry in Map' },
  'Monsters inflict # Grasping Vines on Hit': { ggg: 'Monsters inflict # Grasping Vine on Hit' },
  'Expeditions in Map have +# Remnants': { ggg: 'Expeditions in Area have # Remnants' },
  '# extra packs of Monsters around Vaal Beacons in Map': { ggg: '# extra pack of Monsters around Vaal Beacons in Map' },
};

function candidates(text) {
  // shape variants (Map/Area, GGG's value-1 singular forms, sign glyphs) COMPOSE:
  // "Map contains # additional Essences" needs Area AND "an additional" AND the
  // singular, so every variant is applied over everything generated so far
  let out = [text];
  const expand = (fn) => { for (const c of [...out]) { const v = fn(c); if (v !== c && !out.includes(v)) out.push(v); } };
  expand((c) => c.replace(/,\s+/g, ', '));
  expand((c) => c.replace(/ in Area\b/g, ' in Map').replace(/ in this Area\b/g, ' in Map'));
  expand((c) => c.replace(/ in Map\b/g, ' in Area'));
  expand((c) => c.replace(/^Area /, 'Map '));
  expand((c) => c.replace(/^Map /, 'Area '));
  expand((c) => 'Map has ' + c);
  expand((c) => c.replace(/\+#/g, '#'));
  expand((c) => c.replace(/# additional /g, 'an additional '));
  expand((c) => c.replace(/s$/, ''));           // GGG stores the value-1 singular
  // tablet implicits are two-line stats; the pool keeps line one only
  expand((c) => c + ' # use remaining');
  return out;
}

function resolve(text) {
  const ov = OVERRIDES[text];
  if (ov) {
    const e = byText.get(norm(ov.ggg));
    if (!e) return { miss: 'override text not found: ' + ov.ggg };
    return { id: e.id, invert: ov.invert || undefined };
  }
  for (const c of candidates(text)) {
    const e = byText.get(norm(c));
    if (e) return { id: e.id };
  }
  return null;
}

// ---- suggestion helper for misses: entries sharing the rarest words ---------
function suggest(text) {
  const words = norm(text).replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 3 && w !== 'monsters' && w !== 'area');
  const scored = [];
  for (const e of allEntries) {
    const t = norm(e.text);
    let n = 0;
    for (const w of words) if (t.includes(w)) n++;
    if (n >= Math.min(3, words.length)) scored.push({ n, e });
  }
  scored.sort((a, b) => b.n - a.n);
  return scored.slice(0, 3).map((s) => s.e.id + '  ' + s.e.text.replace(/\n/g, ' \\n '));
}

// ---- walk the pools ---------------------------------------------------------
const seen = new Set();
const map = {};
const misses = [];
function walk(label, text, hidden) {
  if (hidden || seen.has(text)) return;
  seen.add(text);
  if (DENY.has(text)) { misses.push({ label, text, err: 'denied (verified not indexed for this item class)' }); return; }
  if (PROP_FILTERS[text]) { map[text] = { filter: PROP_FILTERS[text] }; return; }
  const r = resolve(text);
  if (r && r.id) map[text] = r;
  else misses.push({ label, text, err: r && r.miss });
}
for (const m of RP.waystone || []) walk('waystone', m.text, m.hidden);
for (const imp of RP.tabletImplicits || []) walk('tablet-implicit', imp.text, false);
for (const ty of Object.keys(RP.tablet || {})) for (const m of RP.tablet[ty]) walk('tablet/' + ty, m.text, m.hidden);

console.log('mapped ' + Object.keys(map).length + ' / ' + seen.size);
for (const m of misses) {
  console.log('\nMISS [' + m.label + '] ' + m.text + (m.err ? '   !! ' + m.err : ''));
  for (const s of suggest(m.text)) console.log('   ? ' + s);
}

if (WRITE) {
  const out = path.join(__dirname, '..', 'renderer', 'regex', 'trade-map.js');
  const header = '// GENERATED by dev/build-regex-trade-map.js against GGG\'s live /api/trade2/data/stats.\n'
    + '// Regex-tab pool line -> trade2 search filter. {id} = stat filter; {id, invert} = the\n'
    + '// pool line is the negative-value rendition of that stat (bound goes on max, negated);\n'
    + '// {filter} = a map_filters range, not a stat. Pool lines missing here are not indexed\n'
    + '// by the trade site at all - the UI surfaces those instead of silently dropping them.\n'
    + '// Rebake when GGG adds stats or the pools change.\n';
  fs.writeFileSync(out, header + 'window.RegexTradeMap = ' + JSON.stringify(map, null, 1) + ';\n');
  console.log('\nwrote ' + out);
}
