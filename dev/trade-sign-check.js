// Measure GGG's sign convention for negated stats against LIVE trade listings.
//
// The question: when an item prints "25% reduced X" for a stat whose canonical ref is
// "#% increased X", does trade index it as -25 or +25? item-tab's effRoll has to know,
// and getting it wrong makes the search return nothing at all.
//
// Reasoning from the stat data says one id + two spellings means the sign is the only
// discriminator. This checks that against reality instead: for each stat, pull real
// listings that carry it, and read the magnitude GGG reports for that hash next to the
// mod text the item prints.
//
//   npx electron dev/trade-sign-check.js [batchSize]
//
// Runs through trade2.js, so it shares the app's self-configuring limiter and cannot
// blow the IP budget. Resumable: every verdict is appended to the out file and already
// checked stats are skipped, so run it repeatedly to slow-burn the whole list.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const trade2 = require(path.join(ROOT, 'trade2'));
const OUT = path.join(__dirname, 'trade-sign-check.json');

const DOWN_WORD = /\b(reduced|less|decreased|slower)\b/i;
const UP_WORD = /\b(increased|more|faster)\b/i;

// what item-tab currently decides for a given (matcher, ref) pair
const rulesSaysKeep = (matcher, ref) => (DOWN_WORD.test(matcher) && UP_WORD.test(ref))
  || (UP_WORD.test(matcher) && DOWN_WORD.test(ref));

function loadStats() {
  const p = path.join(ROOT, 'renderer', 'vendor', 'ee2', 'data', 'en', 'stats.ndjson');
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const neg = (j.matchers || []).filter((m) => m.negate);
    if (!neg.length) continue;
    const ids = j.trade && j.trade.ids ? j.trade.ids : {};
    // explicit is the scope with listings; fall back to whatever the stat has
    const id = (ids.explicit && ids.explicit[0]) || (ids.implicit && ids.implicit[0])
      || (ids.rune && ids.rune[0]) || (Object.values(ids).flat() || [])[0];
    if (!id) continue;
    out.push({ id, ref: j.ref || '', matcher: neg[0].string || '', keep: rulesSaysKeep(neg[0].string || '', j.ref || '') });
  }
  return out;
}

const readDone = () => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return {}; } };

// Pull the roll range GGG reports for `hash` on a listing, plus the text it printed.
// trade2 shape: item.<scope>Mods is an array of { description, hash, mods:[{magnitudes:
// [{min,max}]}] }, and the hash carries a "stat." prefix our ids do not.
const MOD_ARRAYS = ['explicitMods', 'implicitMods', 'fracturedMods', 'craftedMods',
  'enchantMods', 'runeMods', 'desecratedMods', 'scourgeMods'];
function measure(item, id) {
  if (!item) return null;
  for (const key of MOD_ARRAYS) {
    const arr = item[key];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const h = String(entry.hash || '').replace(/^stat\./, '');
      if (h !== id) continue;
      for (const m of (entry.mods || [])) {
        for (const mag of (m && m.magnitudes) || []) {
          const lo = Number(mag.min), hi = Number(mag.max);
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
          return { lo, hi, text: String(entry.description || ''), scope: key };
        }
      }
    }
  }
  return null;
}

app.whenReady().then(async () => {
  const batch = Math.max(1, Number(process.argv[2]) || 25);
  const league = process.env.POE2_LEAGUE || 'Runes of Aldur';
  const stats = loadStats();
  const done = readDone();
  // the 60 stats our rule still sign-flips are the risky ones - measure those first,
  // then work through the ones it leaves alone
  const todo = stats.filter((s) => !done[s.id]).sort((a, b) => (a.keep ? 1 : 0) - (b.keep ? 1 : 0));
  console.log(`negated stats: ${stats.length}  already checked: ${Object.keys(done).length}  this run: ${Math.min(batch, todo.length)}`);
  console.log(`league: ${league}\n`);

  let n = 0;
  for (const s of todo.slice(0, batch)) {
    n++;
    // Searching the bare stat returns mostly the "increased" spelling, which is not the
    // case in question. Ask trade directly for listings whose value is NEGATIVE - if the
    // items that come back print "reduced", the convention is settled for this stat.
    // Only if there are none do we look at the positive side, where a "reduced"-worded
    // listing would mean the opposite convention and our rule is wrong.
    const probe = async (value) => {
      const q = { query: { status: { option: 'any' }, stats: [{ type: 'and', filters: [{ id: s.id, value }] }] }, sort: { price: 'asc' } };
      const r = await trade2.searchAndFetch(league, q, 4);
      const obs = [];
      for (const l of (r.listings || [])) { const m = measure(l && l.item, s.id); if (m) obs.push(m); }
      return { total: r.total || 0, obs };
    };
    let rec = { ref: s.ref, matcher: s.matcher, ruleKeep: s.keep };
    try {
      const neg = await probe({ max: -1 });
      const negDown = neg.obs.filter((o) => DOWN_WORD.test(o.text));
      if (negDown.length) {
        rec.verdict = 'reduced-indexed-negative';
        rec.samples = negDown.slice(0, 3).map((o) => ({ text: o.text.slice(0, 70), lo: o.lo, hi: o.hi }));
      } else if (neg.obs.length) {
        rec.verdict = 'negative-but-not-reduced-worded';
        rec.samples = neg.obs.slice(0, 3).map((o) => ({ text: o.text.slice(0, 70), lo: o.lo, hi: o.hi }));
      } else {
        const pos = await probe({ min: 1 });
        const posDown = pos.obs.filter((o) => DOWN_WORD.test(o.text));
        if (posDown.length) {
          rec.verdict = 'reduced-indexed-positive'; // rule would be WRONG for this stat
          rec.samples = posDown.slice(0, 3).map((o) => ({ text: o.text.slice(0, 70), lo: o.lo, hi: o.hi }));
        } else {
          rec.verdict = pos.obs.length ? 'only-up-samples' : (pos.total || neg.total ? 'no-magnitudes' : 'no-listings');
        }
      }
    } catch (e) {
      rec.verdict = 'error';
      rec.error = String((e && e.message) || e).slice(0, 160);
    }
    done[s.id] = rec;
    fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
    console.log(`[${n}/${Math.min(batch, todo.length)}] ${s.id}  rule=${s.keep ? 'KEEP' : 'FLIP'}  ->  ${rec.verdict}`);
  }

  // summary over everything measured so far
  const all = Object.values(done);
  const tally = {};
  for (const r of all) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  console.log('\n--- totals so far ---');
  for (const k of Object.keys(tally).sort()) console.log('  ', k.padEnd(26), tally[k]);
  const measured = all.filter((r) => r.verdict === 'reduced-indexed-negative' || r.verdict === 'reduced-indexed-positive');
  const disagree = measured.filter((r) => (r.verdict === 'reduced-indexed-negative') !== !!r.ruleKeep);
  console.log(`\nstats with a real measurement: ${measured.length}   DISAGREEING WITH OUR RULE: ${disagree.length}`);
  for (const d of disagree.slice(0, 12)) console.log('   !!', d.ref.slice(0, 60), '||', d.matcher.slice(0, 60), '->', d.verdict);
  app.quit();
});
