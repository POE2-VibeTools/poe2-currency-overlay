// query.js - compiles an ItemModel + user settings into a single PoE2 trade2 search body.
// Pure, dependency-free, browser + node safe. Tested live against /api/trade2/search.
//
// ItemModel shape:
//   {
//     category: 'accessory.ring',           // trade2 type_filters category option
//     rarity:   'rare' | 'normal' | ... ,   // optional
//     mods: [ Mod, ... ]
//   }
// Mod:
//   {
//     id:    'explicit.stat_3032590688',    // trade stat id (search-filter form, no 'stat.' prefix)
//     kind:  'explicit'|'implicit'|'rune'|'pseudo',
//     value: number | null,                 // the item's rolled value (single magnitude)
//     mode:  'strict' | 'pseudo' | 'off',   // strict=exact filter, pseudo=fungible/weighted, off=ignored
//     damage:'phys'|'fire'|'cold'|'lightning'|'chaos'|null,  // for weighted attack rolls
//     weight: number | null,                // per-mod weight override (else defaults by damage type)
//     group: string | null                  // membership in a make-fungible set (count-1 group)
//   }
//
// Settings (opts):
//   {
//     status: 'online'|'onlineleague'|'any' (default 'online'),
//     sort:   { price: 'asc' } (default),
//     defaultLowerPct: -100..100  (drop each strict min by this % for a broader range;
//                       NEGATIVE raises mins above the roll - strictly-better comps; default 0),
//     weightedMode: 'server' | 'client'  (server = Weighted Sum v2, needs login; client = count + client rank),
//     weightMin: number | null,          (weighted group threshold; default = item's own weighted total),
//     garbage: [id, ...]                  (garbage pool ids; adds a count>=1 group when non-empty & enabled),
//     garbageEnabled: boolean            (default false -> garbage mods simply omitted)
//   }

(function () {
'use strict';

const DEFAULT_WEIGHTS = { phys: 1.33, fire: 1, cold: 1, lightning: 1, chaos: 1 };

// resistance stats by bare hash; mult = contribution to GGG's "+#% total Resistance"
// pseudo (all-ele counts three times). chaos flags the chaos-res special case.
const RES_STATS = {
  stat_2923486259: { mult: 1, chaos: true }, // #% to Chaos Resistance
  stat_3372524247: { mult: 1 },              // #% to Fire Resistance
  stat_4220027924: { mult: 1 },              // #% to Cold Resistance
  stat_1671376347: { mult: 1 },              // #% to Lightning Resistance
  stat_2901986750: { mult: 3 },              // #% to all Elemental Resistances
  // Dual resistances: +X to two resistances is 2X toward the total (GGG counts
  // it that way). The three that include chaos also make chaos "exist" - so a
  // helmet whose only chaos is a desecrated "Lightning and Chaos" line still
  // gets the empty chaos pseudo. These fold like any res line; without them the
  // dual roll was mislabelled explicit and its resistance never reached the total.
  stat_2915988346: { mult: 2 },              // #% to Fire and Cold Resistances
  stat_3441501978: { mult: 2 },              // #% to Fire and Lightning Resistances
  stat_4277795662: { mult: 2 },              // #% to Cold and Lightning Resistances
  stat_378817135: { mult: 2, chaos: true },  // #% to Fire and Chaos Resistances
  stat_3393628375: { mult: 2, chaos: true }, // #% to Cold and Chaos Resistances
  stat_3465022881: { mult: 2, chaos: true }, // #% to Lightning and Chaos Resistances
};

function lower(value, pct) {
  if (value == null) return undefined;
  if (!pct) return value;
  // NEGATIVE rolls ("-1 Prefix Modifier allowed") are not magnitudes to widen -
  // lowering one and then clamping at 0 turned -1 into 0, i.e. "at least zero
  // prefixes allowed", which is a different (and unmatchable) request. Search
  // them exactly.
  if (value < 0) return value;
  return Math.max(0, Math.round(value * (1 - pct / 100)));
}

// A unique's mod rolls inside a NARROW band (Astramentis: 80-100 attributes), so
// taking the % off the VALUE drops the minimum under the unique's own floor and
// the filter then matches every copy in existence. Scale by the RANGE WIDTH
// instead and clamp to the band - EE2's model. A perfect roll searches exact.
function uniqueMin(mod, pct) {
  const { value, min, max } = mod;
  if (value == null || min == null || max == null || !(max > min)) return value;
  const better = mod.better == null ? 1 : mod.better;
  if (better === 0) return value;                    // not comparable: exact
  if (better === 1 && value >= max) return value;    // perfect roll: exact
  if (better === -1 && value <= min) return value;
  // pct may be NEGATIVE (mins pushed past the roll toward better) - clamp both
  // ends so the min never leaves the unique's own roll band and turns unmatchable
  const delta = (max - min) * ((pct || 0) / 100);
  return better === -1
    ? Math.max(min, Math.min(max, Math.ceil(value + delta)))   // lower is better: widen up
    : Math.max(min, Math.min(max, Math.floor(value - delta)));
}

function typeFilters(item) {
  const filters = {};
  if (item.category) filters.category = { option: item.category };
  // "Gem" is not one of trade2's rarity options (normal/magic/rare/unique/
  // uniquefoil/nonunique), so a gem sends its category and level instead
  if (item.rarity && !item.isGem) filters.rarity = { option: item.rarity };
  return Object.keys(filters).length ? { type_filters: { filters } } : {};
}

// weighted total of the item's own fungible attack mods (used as default threshold);
// respects per-mod typed minimums and the default-lowering %
function weightedTotal(mods, weightsFor, effMin) {
  let t = 0;
  for (const m of mods) {
    const v = effMin(m);
    if (v != null) t += v * weightsFor(m);
  }
  return Math.round(t);
}

function compileQuery(item, opts = {}) {
  // 'securable' = GGG's "Instant Buyout": listings you can actually buy from the
  // Market, right now. The old default was 'any', which also drags in psapi
  // stash-tab listings - and those are corpses. Live-verified on a Sapphire jewel:
  // status any returned a 1-exalted comp indexed 2 days ago and a 3-exalted one
  // 46 days old, while the game showed a 5-divine floor. Same query at securable
  // returns the divine listings the game shows. Pricing against a dead listing
  // undervalues an item by orders of magnitude, so the buyable market is the
  // default and the wider options are opt-in.
  const status = opts.status || 'securable';
  const sort = opts.sort || { price: 'asc' };
  const lowerPct = opts.defaultLowerPct || 0;
  const weightedMode = opts.weightedMode || 'client';
  const weightFor = (m) => (m.weight != null ? m.weight : (DEFAULT_WEIGHTS[m.damage] != null ? DEFAULT_WEIGHTS[m.damage] : 1));

  const allActive = (item.mods || []).filter((m) => m.mode !== 'off');
  // properties (Armour/Evasion/ES/DPS/...) compile into equipment_filters, not stats
  const propFilters = {};
  // waystone header properties are their own family - GGG's "Endgame Filters"
  const mapFilters = {};
  // when the UI passes an explicit socket range, it OWNS the rune_sockets
  // filter - the old property row (if still on) must not double-drive it
  const sockRange = opts.sockMin != null || opts.sockMax != null;
  for (const m of allActive) {
    if (m.prop && m.id === 'prop.rune_sockets' && sockRange) continue;
    if (m.prop && m.id && m.id.startsWith('prop.') && effMinOf(m) != null) {
      propFilters[m.id.slice(5)] = { min: effMinOf(m) };
    } else if (m.prop && m.id && m.id.startsWith('mapprop.')) {
      const key = m.id.slice(8);
      // min only, like every other filter - a max would hide better waystones
      // from the comp set instead of just ranking them above yours
      if (effMinOf(m) != null) mapFilters[key] = { min: effMinOf(m) };
    }
  }
  const active = allActive.filter((m) => !m.prop);
  const stats = [];

  function effMinOf(m) {
    if (m.exact && m.value != null && m.searchMin == null) return m.value;
    if (m.searchMin != null) return m.searchMin;
    if (m.isUnique && !m.prop) return uniqueMin(m, lowerPct);
    return lower(m.value, lowerPct);
  }

  // effective search minimum: an explicit user-typed min wins; otherwise tier
  // floor (when on), else the roll lowered by the default-lowering %
  const effMin = effMinOf;

  // 1) strict mods -> one AND group (make-fungible members belong to their count
  // group only, never the AND group)
  let strict = active.filter((m) => m.mode === 'strict' && !m.group);
  const notes = [];

  // Resistance pseudo rows are built in the MODEL now (toModel adds GGG's own
  // "+N% total Resistance" pseudo line + an empty-min chaos pseudo, and turns
  // the explicit res lines off) - they compile here like any strict mod, so
  // nothing res-specific happens at query time.
  const andFilters = [];
  for (const m of strict) {
    // exact-match stats (a tablet's uses remaining, a waystone's tier) pin the
    // MINIMUM at the item's own value - never lowered by the stat range % or
    // tier floor - but never cap the max: a fuller tablet is still a valid comp.
    // A max only ever appears when the user TYPED one (added mods).
    // Option/enum stats (a unique's "Legacy of #", "Allocates #"): GGG encodes the
    // chosen option IN the stat id (explicit.stat_264262054|13), with an EMPTY
    // value - the trade2 API has no value.option field, so sending one is silently
    // ignored and the whole search returns nothing (this is what broke Mageblood's
    // legacies). Pure enum stats carry no magnitude, so no min/max either.
    const withOpt = (id) => (m.option != null ? `${id}|${m.option}` : id);
    const value = {};
    if (m.option == null) {
      if (effMin(m) != null) value.min = effMin(m);
      if (m.searchMax != null) value.max = m.searchMax;
    }
    if (m.altIds && m.altIds.length) {
      // scope-fungible: the stat may live under another scope on listings
      // (explicit vs crafted/desecrated/...) - match whichever is present
      stats.push({
        type: 'count',
        value: { min: 1 },
        filters: [m.id, ...m.altIds].map((id) => ({ id: withOpt(id), value })),
      });
    } else {
      andFilters.push({ id: withOpt(m.id), value });
    }
  }
  if (andFilters.length) stats.push({ type: 'and', filters: andFilters });

  // 2) make-fungible sets -> one COUNT>=1 group each (match any member)
  const groups = {};
  for (const m of active) if (m.group) (groups[m.group] = groups[m.group] || []).push(m);
  for (const gid of Object.keys(groups)) {
    // each fungible member can carry its own min/max now; count>=1 still means
    // at least ONE member is present - and meets whatever min you set (a blank
    // min = any amount of that stat counts, the classic fungible behavior)
    const filters = groups[gid].map((m) => {
      // option/enum stats: choice rides in the id (id|value), no magnitude
      const id = m.option != null ? `${m.id}|${m.option}` : m.id;
      if (m.option != null) return { id };
      const val = {};
      const mn = effMin(m);
      if (mn != null) val.min = mn;
      if (m.searchMax != null) val.max = m.searchMax;
      return Object.keys(val).length ? { id, value: val } : { id };
    });
    stats.push({ type: 'count', value: { min: 1 }, filters });
  }

  // 3) pseudo (weighted) attack mods -> Weighted Sum v2 (server) or COUNT>=1 retrieval (client-ranked)
  const pseudo = active.filter((m) => m.mode === 'pseudo' && !m.group);
  if (pseudo.length) {
    if (weightedMode === 'server') {
      const min = opts.weightMin != null ? opts.weightMin : weightedTotal(pseudo, weightFor, effMin);
      stats.push({ type: 'weight2', value: { min }, filters: pseudo.map((m) => ({ id: m.id, value: { weight: weightFor(m) } })) });
    } else {
      // logged-out fallback: retrieve anything with >=1 of the fungible mods; rank client-side
      stats.push({ type: 'count', value: { min: 1 }, filters: pseudo.map((m) => ({ id: m.id })) });
    }
  }

  // 4) garbage pool -> one COUNT>=1 group over the whole pool (only when enabled)
  if (opts.garbageEnabled && opts.garbage && opts.garbage.length) {
    stats.push({ type: 'count', value: { min: 1 }, filters: opts.garbage.map((id) => ({ id })) });
  }

  const query = { status: { option: status } };
  // Listing age (GGG trade_filters.indexed, verified against /api/trade2/data/filters:
  // 1hour|3hours|12hours|1day|3days|1week|2weeks|1month|2months). A month-old listing
  // at a stale price drags the whole comp set up, which is what people mean when they
  // say the suggestion looks inflated. Omitted entirely when unset = GGG's "Any Time".
  const tradeFilters = {};
  if (opts.indexed) tradeFilters.indexed = { option: String(opts.indexed) };
  if (item.name) query.name = item.name; // uniques: the name IS the search
  if (item.type) query.type = item.type; // tablets: the base type IS the tablet
  const tf = typeFilters(item); // { type_filters: { filters: {...} } } or {}
  // Miscellaneous toggles (GGG's own misc_filters): Corrupted / Crafted /
  // Fractured / Desecrated / Sanctified / Twice Corrupted / Mirrored, each
  // Any-Yes-No. Only set entries are sent, so an untouched panel changes
  // nothing about the search.
  const miscFilters = {};
  for (const [k, v] of Object.entries(opts.misc || {})) {
    if (v === 'true' || v === 'false') miscFilters[k] = { option: v };
  }
  // Unidentified items price as the gamble, not as whatever they turn out to be, so the
  // comps must also be unidentified (misc_filters.identified, verified against
  // /api/trade2/data/filters). Without this an unidentified Sapphire priced against
  // identified ones - the wrong market entirely. Tier only from 5, matching EE2, below
  // which it does not separate the market.
  // The Misc panel has its own Identified row now, and an explicit choice there always
  // wins - this only fills it in when the user has not said otherwise.
  if (item.isUnidentified) {
    // Tablets are excluded on purpose. An item's tier only raises the MINIMUM mod ilevel
    // it can roll, and every tablet mod shares one ilevel - so a tier 4 unidentified
    // tablet rolls the exact same mod pool at the exact same odds as a tier 0. The tier
    // is real but carries no value, and filtering on it would shrink the comp set for
    // nothing. Uniques only, and only from tier 5, matching EE2.
    if (item.unidentifiedTier != null && item.unidentifiedTier >= 5
        && item.category !== 'map.tablet') {
      miscFilters.unidentified_tier = { min: item.unidentifiedTier, max: item.unidentifiedTier };
    }
  }
  // Item level + quality: min/max ranges living in type_filters (verified against
  // GGG's /api/trade2/data/filters - trade2 keeps them there, NOT in misc). Mins
  // default to the item's own values (set by the UI) and are deliberately NOT
  // lowered by the stat-range %; blank max = no upper limit. Sent only when set.
  const range = (min, max) => {
    const r = {};
    if (min != null) r.min = min;
    if (max != null) r.max = max;
    return r;
  };
  if (opts.ilvlMin != null || opts.ilvlMax != null || opts.qualMin != null || opts.qualMax != null) {
    if (!tf.type_filters) tf.type_filters = { filters: {} };
    if (opts.ilvlMin != null || opts.ilvlMax != null) tf.type_filters.filters.ilvl = range(opts.ilvlMin, opts.ilvlMax);
    if (opts.qualMin != null || opts.qualMax != null) tf.type_filters.filters.quality = range(opts.qualMin, opts.qualMax);
  }
  // sockets are an equipment filter (rune_sockets), min/max like ilvl/quality
  if (sockRange) propFilters.rune_sockets = range(opts.sockMin, opts.sockMax);
  // Gem level lives in misc_filters (verified against /api/trade2/data/filters:
  // misc_filters carries gem_level and gem_sockets; quality stays in type_filters
  // above). Without it a level 20 gem priced against level 1 comps - the whole
  // reason gem checks read low.
  if (opts.gemLvlMin != null || opts.gemLvlMax != null) {
    miscFilters.gem_level = range(opts.gemLvlMin, opts.gemLvlMax);
  }
  if (tf.type_filters || Object.keys(propFilters).length || Object.keys(mapFilters).length
      || Object.keys(miscFilters).length || Object.keys(tradeFilters).length) {
    query.filters = { ...(tf.type_filters ? tf : {}) };
    if (Object.keys(propFilters).length) query.filters.equipment_filters = { filters: propFilters };
    if (Object.keys(mapFilters).length) query.filters.map_filters = { filters: mapFilters };
    if (Object.keys(miscFilters).length) query.filters.misc_filters = { filters: miscFilters };
    if (Object.keys(tradeFilters).length) query.filters.trade_filters = { filters: tradeFilters };
  }
  if (stats.length) query.stats = stats;
  return { query, sort, notes };
}

// client-side weighted ranking for the logged-out fallback: score a fetched listing by the
// weighted sum of its fungible-mod magnitudes (uses the same weights as the server would).
function weightedScore(listingMods, pseudoSpec) {
  // pseudoSpec: [{ id, weight }]; listingMods: [{ id, value }]
  const w = new Map(pseudoSpec.map((p) => [p.id, p.weight]));
  let s = 0;
  for (const lm of listingMods) if (w.has(lm.id) && lm.value != null) s += lm.value * w.get(lm.id);
  return s;
}

// what the UI should display as a mod's current search minimum (mirrors effMin)
function effectiveMin(mod, defaultLowerPct) {
  if (mod.exact && mod.value != null && mod.searchMin == null) return mod.value;
  if (mod.searchMin != null) return mod.searchMin;
  if (mod.isUnique && !mod.prop) return uniqueMin(mod, defaultLowerPct || 0);
  return lower(mod.value, defaultLowerPct || 0);
}

const _api = { compileQuery, weightedScore, effectiveMin, DEFAULT_WEIGHTS, RES_STATS };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.ItemQuery = _api;
})();
