'use strict';
// Regex pool sweep: runs the app's OWN generator (renderer/regex/regex-gen.js) over the
// real pools (renderer/regex/pools-data.js) and proves, for every line, that the
// pattern it emits matches that line and NO other line in its class pool - the in-game
// search box semantics the Regex tab promises. Run after any pool edit:
//
//   node dev/test-regex-pools.js            full sweep
//   node dev/test-regex-pools.js "Verisium" only lines containing the text (verbose)
//
// What a "line" is: the pool text with every '#' realised as a number. Value 1 is
// realised the way the game prints it - count words singularised ("1 additional Rare
// Monster") - because that is the form a pattern most often misses.
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'renderer', 'regex', 'regex-gen.js'));
require(path.join(__dirname, '..', 'renderer', 'regex', 'pools-data.js'));
const RG = global.window.RegexGen;
const RP = global.window.RegexPools;

const only = process.argv[2] ? String(process.argv[2]).toLowerCase() : null;

// ---- pools, built the way regex-tab.js builds them ---------------------------
function tabletMerged() {
  const seen = new Map();
  for (const imp of RP.tabletImplicits || []) seen.set(imp.text, { text: imp.text });
  for (const type of Object.keys(RP.tablet || {})) {
    for (const m of RP.tablet[type]) {
      const prev = seen.get(m.text);
      if (prev) { if (m.max != null && (prev.max == null || m.max > prev.max)) prev.max = m.max; continue; }
      seen.set(m.text, { ...m });
    }
  }
  return [...seen.values()];
}
const POOLS = { waystone: RP.waystone || [], tablet: tabletMerged() };

// ---- realise a pool text at a value -------------------------------------------
function realise(text, v) {
  let out = text.replace(/#/g, String(v));
  if (v === 1 && /#(?!%)/.test(text)) {
    // the game singularises the count word at 1: strip the final word's plural s
    out = out.replace(/(\w+)s$/, '$1');
  }
  return out;
}
// Values a line can actually show. A known max is a hard cap - the generator drops the
// "more digits" term when it knows the roll span, so testing above it is not a test.
function valuesFor(mod) {
  const lo = mod.min != null ? mod.min : 1;
  const hi = mod.max != null ? mod.max : 100;
  const set = new Set([1, lo, hi, Math.floor((lo + hi) / 2), 5, 10, 25, 50, 99, 100, 150]);
  return [...set].filter((v) => v >= 0 && (mod.max == null || v <= mod.max));
}
const superline = (a, b) => b.toLowerCase().includes(a.toLowerCase());

let fails = 0, checks = 0;
const fail = (msg) => { fails++; console.log('  FAIL ' + msg); };

for (const [cls, pool] of Object.entries(POOLS)) {
  const texts = pool.map((m) => m.text);
  for (const mod of pool) {
    if (only && !mod.text.toLowerCase().includes(only)) continue;
    const others = pool.filter((o) => o.text !== mod.text && !superline(mod.text, o.text));

    // (a) presence pattern: matches own line at every value, no other line ever
    const pat = RG.modPattern(mod, null, texts);
    let rx;
    try { rx = new RegExp(pat, 'i'); } catch (e) { fail(`[${cls}] ${mod.text}: pattern does not compile: ${pat}`); continue; }
    if (only) console.log(`[${cls}] ${mod.text}\n    presence: ${pat}`);
    for (const v of valuesFor(mod)) {
      checks++;
      const line = realise(mod.text, v);
      if (!rx.test(line)) fail(`[${cls}] presence miss: /${pat}/ vs "${line}"`);
    }
    for (const o of others) for (const v of valuesFor(o)) {
      checks++;
      const line = realise(o.text, v);
      if (rx.test(line)) fail(`[${cls}] presence collision: /${pat}/ (for "${mod.text}") also matches "${line}"`);
    }

    // (b) threshold patterns: >= min matches own line at v>=min, never at v<min, never others
    if (mod.text.includes('#')) {
      const lo = mod.min != null ? mod.min : 1;
      const hi = mod.max != null ? mod.max : 100;
      const mins = [...new Set([lo, Math.floor((lo + hi) / 2), hi])].filter((m) => m > 0);
      for (const min of mins) {
        const tp = RG.modPattern(mod, min, texts);
        let trx;
        try { trx = new RegExp(tp, 'i'); } catch (e) { fail(`[${cls}] ${mod.text} >=${min}: does not compile: ${tp}`); continue; }
        if (only) console.log(`    >=${min}: ${tp}`);
        for (const v of valuesFor(mod)) {
          checks++;
          const line = realise(mod.text, v);
          const hit = trx.test(line);
          if (v >= min && !hit) fail(`[${cls}] >=${min} miss: /${tp}/ vs "${line}"`);
          if (v < min && hit) fail(`[${cls}] >=${min} false hit: /${tp}/ vs "${line}"`);
        }
        for (const o of others) for (const v of valuesFor(o)) {
          checks++;
          const line = realise(o.text, v);
          if (trx.test(line)) fail(`[${cls}] >=${min} collision: /${tp}/ (for "${mod.text}") also matches "${line}"`);
        }
      }
    }

    // (c) the paste-seeding regex from regex-tab.js seedFromText (raw-text fallback)
    // must recognise the line at 1 (singular) and at a plural value
    const segs = mod.text.split('#').map((p) => p.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'));
    const last = segs.length - 1;
    if (/s$/i.test(segs[last])) segs[last] = segs[last].replace(/s$/i, 's?');
    const seedRx = new RegExp('^' + segs.join('([0-9]+(?:\\.[0-9]+)?)') + '( \\(.*\\))?$', 'i');
    for (const v of [1, 2, 37]) {
      checks++;
      const line = realise(mod.text, v);
      if (!seedRx.test(line)) fail(`[${cls}] seed regex miss: "${line}" (pool "${mod.text}")`);
    }
  }
}

// (d) assembly: every pool line included at once builds a non-empty, well-quoted pattern
for (const [cls, pool] of Object.entries(POOLS)) {
  const texts = pool.map((m) => m.text);
  const inc = pool.filter((m) => !m.hidden).map((mod) => ({ mod, min: null, group: null }));
  const out = RG.build(inc, [], texts);
  checks++;
  if (!out || out.split(' ').length < inc.length) fail(`[${cls}] build() dropped terms: ${inc.length} in, "${out.slice(0, 80)}..."`);
  const quotes = (out.match(/"/g) || []).length;
  if (quotes % 2) fail(`[${cls}] build() unbalanced quotes`);
}

console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
