// item-tab.js - controller for the Items (price-check) tab.
// Owns tab switching, clipboard parse (vendored EE2 parser via window.EE2),
// query compilation (window.ItemQuery), live trade2 search (window.api),
// result classification (window.ItemClassify), and cached search history.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // trade stat ids for flat "Adds # to # X Damage to Attacks" (confirmed live)
  const ATTACK_FLAT = {
    'explicit.stat_3032590688': 'phys',
    'explicit.stat_1573130764': 'fire',
    'explicit.stat_4067062424': 'cold',
    'explicit.stat_1754445556': 'lightning',
    'explicit.stat_674553446': 'chaos',
  };
  const PCT_DMG_RE = /^#% increased (Physical|Fire|Cold|Lightning|Chaos) Damage$/;
  const ELEMENT = { Physical: 'phys', Fire: 'fire', Cold: 'cold', Lightning: 'lightning', Chaos: 'chaos' };

  const state = {
    view: 'empty',       // 'empty' (landing/history) | 'item'
    item: null,          // ItemModel (see query.js header)
    results: null,
    currencyResult: null, // poe2scout catalog entry when the item is exchangeable currency
    searching: false,
    notice: null,        // e.g. "cached 2h ago - Search re-runs it live"
    history: [],
    opts: { defaultLowerPct: 15, weightedMode: 'client', misc: {}, status: 'securable', indexed: null },
    league: null,
    active: false,       // items tab visible?
    ranges: {},          // learned per-stat roll bounds: { statId: {min, max} }
    garbage: [],         // user-curated worthless-mod stat ids
    authed: null,        // logged in to pathofexile.com? null = unknown
    loginHint: false,
    assume: { q20: true, fillRunes: true }, // settings-panel search assumptions
    searchCtx: null,     // live search paging: { queryId, ids, loaded, rawAll, total, page }
    histShown: 10,       // Recent-searches paging: how many history rows are visible
    excAssume: null,     // per-item assume override for Exceptional Normal bases (q20 ON, runes OFF); null otherwise
    autoCorrupted: false, // true when corrupted=No was auto-seeded for an Exceptional base (not user-chosen)
    showSliders: true, // settings-panel: per-mod sliders (off = compact rows)
  };

  // full searchable-stat catalog for the pickers (built once after parser init);
  // each entry carries its trade id per scope so pickers can offer crafted /
  // implicit / rune / fractured / ... variants, not just explicit
  // 'sanctum' = Trial of the Sekhemas relic mods (Resolve, Honour, Afflictions, Keys).
  // It exists in the stat data and relics are tradeable, but it was missing here, so
  // all 164 of those stats were unreachable in every picker.
  // 'pseudo' is LAST deliberately: buildStatCatalog keys its dedupe on the first scope
  // present, and a stat that is both explicit and pseudo must key on its explicit id.
  // Listing it at all is what makes the 33 pseudo-only stats (modifier counts, empty
  // prefix/suffix, attribute totals, tablet uses) addable by hand. This does NOT change
  // what gets auto-added to a parsed item - that is still only total resistance plus
  // the empty chaos row; total life/mana stay baits and stay off by default.
  const PICKER_SCOPES = ['explicit', 'crafted', 'implicit', 'rune', 'enchant', 'fractured', 'desecrated', 'skill', 'sanctum', 'pseudo'];
  // Two curated pools surfaced as picker pills, filtering the catalog down to the
  // mods a special context grants (with the trade scope they read as on an item):
  //   Greater Runes  = the "soul" pool (Medved's Tending & co) -> read as explicit
  //   Otherworldly   = the Altered-bone pool -> read as desecrated
  const SPECIAL_SCOPES = [
    { key: 'soul', label: t('itemtab.search.pill_greater_runes'), real: 'explicit' },
    { key: 'other', label: t('itemtab.search.pill_otherworldly'), real: 'desecrated' },
  ];
  let specialSets = null;
  function specialFor(key) {
    if (!specialSets) {
      const p = window.__desecPool;
      if (!p) { fetch('item/desecration-pool.json').then((r) => r.json()).then((j) => { window.__desecPool = j; specialSets = null; }).catch(() => {}); return null; }
      specialSets = { soul: new Set(p.soul || []), other: new Set(p.otherworldly || []) };
    }
    return specialSets[key] || null;
  }
  let statCatalog = null;
  function buildStatCatalog() {
    if (statCatalog) return statCatalog;
    statCatalog = [];
    const seen = new Set();
    for (const stat of window.EE2.statsSearch('', 5000)) {
      const tradeIds = (stat.trade && stat.trade.ids) || {};
      const ids = {};
      for (const sc of PICKER_SCOPES) if (tradeIds[sc] && tradeIds[sc].length) ids[sc] = tradeIds[sc]; // ALL ids per scope
      if (!Object.keys(ids).length) continue;
      const baseKey = Object.values(ids)[0][0];
      // OPTION stats ("Legacy of #", "Allocates #") carry one matcher PER CHOICE, and the
      // choice is the whole point - a Mageblood's Legacy of Topaz is a different item from
      // Legacy of Gold. Taking matchers[0] published exactly one of them and hid the other
      // thirteen, so they could not be searched at all. Emit one entry per choice, keyed by
      // its option value so they do not dedupe into each other.
      const isOption = !!(stat.trade && stat.trade.option);
      const matchers = (stat.matchers || []).filter((m) => m && m.string);
      if (isOption && matchers.length > 1) {
        for (const m of matchers) {
          if (m.value == null) continue;
          const key = `${baseKey}|${m.value}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const text = cleanBrackets(m.string);
          statCatalog.push({ ids, ref: stat.ref, text, lower: text.toLowerCase(), option: m.value });
        }
        continue;
      }
      if (seen.has(baseKey)) continue;
      seen.add(baseKey);
      const text = cleanBrackets((matchers[0] && matchers[0].string) || stat.ref);
      statCatalog.push({ ids, ref: stat.ref, text, lower: text.toLowerCase() });
    }
    return statCatalog;
  }
  function filterStats(q, pickedIds, scope) {
    const cat = buildStatCatalog();
    // in-game-style subset search: every word must appear somewhere, any order
    // ("monster rare increased" -> "#% increased number of Rare Monsters").
    // A word that prefixes a scope name ("frac", "desecr") selects that scope.
    const tokens = [];
    for (const t of q.toLowerCase().split(/\s+/).filter(Boolean)) {
      const sc = t.length >= 3 && PICKER_SCOPES.find((s) => s.startsWith(t));
      if (sc) scope = sc; else tokens.push(t);
    }
    // A special pill ("soul"/"other") filters to its curated hash set and reads the
    // stat under a real trade scope (explicit/desecrated). Everything else is a
    // plain trade scope, unfiltered.
    const spec = SPECIAL_SCOPES.find((s) => s.key === scope);
    const effScope = spec ? spec.real : scope;
    const set = spec ? specialFor(spec.key) : null;
    const found = [];
    for (const s of cat) {
      if (!s.ids[effScope]) continue;
      if (spec && !(set && s.ids[effScope].some((id) => set.has(String(id).split('.').pop())))) continue;
      let boundary = 0, ok = true;
      for (const t of tokens) {
        const idx = s.lower.indexOf(t);
        if (idx === -1) { ok = false; break; }
        if (idx === 0 || /[^a-z0-9]/.test(s.lower[idx - 1])) boundary++; // word-start match ranks higher
      }
      if (!ok) continue;
      found.push({ s, boundary });
      if (found.length >= 400) break;
    }
    // more word-start hits first; shorter = more canonical ("# to maximum Life"
    // above "...per 100 maximum Life")
    // With a query, word-start hits rank first and shorter = more canonical
    // ("# to maximum Life" above "...per 100 maximum Life").
    // With NO query there is nothing to rank, and shortest-first fills the whole list
    // with the shortest names in the scope - in `sanctum` that is every cryptic boon
    // ("Has Golden Smoke") while the readable numeric mods sit below the fold. So when
    // the box is empty, parameterised stats (the ones with a # you can put a number in)
    // come first, and the bare named ones follow.
    const noQuery = !tokens.length;
    found.sort((a, b) =>
      b.boundary - a.boundary
      || (noQuery ? (b.s.text.includes('#') - a.s.text.includes('#')) : 0)
      || a.s.text.length - b.s.text.length);
    const res = found.slice(0, 40)
      .map(({ s }) => ({
        id: s.ids[effScope][0], altIds: s.ids[effScope].slice(1), scope: effScope,
        ref: s.ref, text: s.text,
        // option stats share one trade id across every choice, so "already picked" has
        // to compare the CHOICE too, not just the id
        option: s.option != null ? s.option : null,
        picked: pickedIds.has(s.option != null ? `${s.ids[effScope][0]}|${s.option}` : s.ids[effScope][0]),
      }));
    res.scope = scope; // effective pill (may differ from the chip if a scope word was typed)
    return res;
  }

  // ---------- helpers ----------
  const cleanBrackets = (s) => String(s || '').replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');

  // ---------- quick currency price (exchange-value lookup, not a whisper search) ----------
  // Any tradeable item carries a tradeTag == poe2scout's apiId, so it maps straight
  // to a live exchange value. Raw fungible crafting orbs are skipped - pricing an
  // Exalted in Exalts is pointless - but fragments, soul cores, runes, alloys,
  // catalysts, essences, splinters, bones, infusers, etc. all get a quick value.
  // Only the base unit is skipped. Everything is quoted in exalted, so an exalted priced
  // in exalted reads "1 exalted = 1 exalted" and is the one genuinely useless answer.
  //
  // This list used to hold 21 tags - every greater/perfect variant plus the utility orbs -
  // on the theory that "raw crafting currency" should not price. But a Perfect Exalted Orb
  // is a traded good with a real exalted value, not a denominator, and so are Greater
  // Chaos, Annul and Vaal. Mirror of Kalandra and Fracturing Orb were never on the list
  // and priced fine, which is the precedent: a denominator can still have a useful price.
  // Divine and chaos in particular are the numbers people most want to see.
  const CURRENCY_SKIP = new Set(['exalted']);
  const cel = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const cesc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  const divRateFull = () => (ccatalog && ccatalog.divine && ccatalog.divine.price > 0 ? ccatalog.divine.price
    : (window.currencyPriceOf ? window.currencyPriceOf('divine') : null));
  // chaos, in exalted - the denominator a divine is actually quoted in
  const chaosRateFull = () => (ccatalog && ccatalog.chaos && ccatalog.chaos.price > 0 ? ccatalog.chaos.price
    : (window.currencyPriceOf ? window.currencyPriceOf('chaos') : null));

  let ccatalog = null, ccatalogAt = 0; // flat apiId -> { price, text, icon, logs }, cached
  async function currencyPrice(tag) {
    if (!ccatalog || Date.now() - ccatalogAt > 90000) {
      const res = await window.api.fetchCatalog();
      const map = {};
      for (const g of (res.groups || [])) for (const it of (g.items || [])) map[it.apiId] = it;
      ccatalog = map; ccatalogAt = Date.now();
    }
    return ccatalog[tag] || null;
  }
  async function doCurrencyPrice() {
    state.searching = true; state.notice = null; state.currencyResult = null; render();
    try {
      let it = await currencyPrice(state.item.currencyTag);
      // poe2scout doesn't list every exchange item (Raven's Reflection and other
      // CX-only fragments/keys). Fall back to GGG's currency-exchange feed, which
      // prices them the same way the Net Worth stash valuation does.
      if (!it && window.api.cxItemPrice) {
        const cx = await window.api.cxItemPrice({ apiId: state.item.currencyTag, name: state.item.currencyName });
        if (cx && !cx.error && cx.price != null) {
          it = { apiId: cx.apiId, price: cx.price, text: cx.text || state.item.currencyName, icon: cx.icon, logs: null, source: 'cx' };
        }
      }
      state.currencyResult = it || null;
      if (!it) state.notice = t('itemtab.currency.no_price_found_yet');
      else pushCurrencyHistory(it); // currency lookups belong in Recent searches too
    } catch (err) {
      state.notice = t('itemtab.currency.price_lookup_failed', { error: (err && err.message || err) });
    }
    state.searching = false; state.stale = false;
    render();
  }
  // tiny 7-day price sparkline from poe2scout PriceLogs
  function currencySpark(logs) {
    const pts = (logs || []).filter((l) => l && typeof l.p === 'number').map((l) => l.p);
    if (pts.length < 2) return null;
    const w = 280, h = 44, pad = 3;
    const lo = Math.min(...pts), hi = Math.max(...pts), rng = hi - lo || 1;
    const step = (w - pad * 2) / (pts.length - 1);
    const y = (v) => pad + (h - pad * 2) * (1 - (v - lo) / rng);
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(pad + i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const up = pts[pts.length - 1] >= pts[0];
    const wrap = cel('div', 'cur-spark');
    wrap.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="cur-spark-svg ${up ? 'up' : 'down'}"><path d="${d}"/></svg>`;
    const lbl = cel('div', 'cur-spark-lbl');
    lbl.appendChild(cel('span', null, t('itemtab.currency.spark_label_7day')));
    lbl.appendChild(cel('span', null, t('itemtab.currency.spark_range', { lo: fmtNum(lo), hi: fmtNum(hi) })));
    wrap.appendChild(lbl);
    return wrap;
  }
  function renderCurrency(root) {
    root.innerHTML = '';
    const back = cel('div', 'back-link', t('itemtab.currency.back_link'));
    back.onclick = () => { state.view = 'empty'; state.item = null; state.currencyResult = null; render(); };
    root.appendChild(back);
    const card = cel('div', 'cur-card');
    const head = cel('div', 'cur-head');
    if (state.item.currencyIcon) { const img = cel('img', 'cur-icon'); img.src = state.item.currencyIcon; img.onerror = () => img.remove(); head.appendChild(img); }
    head.appendChild(cel('div', 'cur-name', cesc(state.item.currencyName || '')));
    card.appendChild(head);
    const r = state.currencyResult;
    if (state.searching && !r) {
      card.appendChild(cel('div', 'cur-note', t('itemtab.currency.fetching')));
    } else if (r && r.price != null) {
      const div = divRateFull();
      // A Divine Orb quoted in divines reads "1.00 div", the same useless tautology as
      // pricing an exalted in exalted. Divines are quoted in CHAOS in trade, with the
      // exalted count in brackets, so that is what a divine shows.
      const selfDiv = state.item.currencyTag === 'divine';
      const ex = r.price, big = !selfDiv && div && ex >= div;
      // unit as icon (Settings > "Show currency icons instead of names") or the
      // plain "div"/"ex" abbreviation, whichever the toggle calls for
      const unit = (apiId, abbr) => (window.currencyIconTag && window.currencyIconTag(apiId)) || abbr;
      const chaos = chaosRateFull();
      const primary = selfDiv && chaos
        ? `${fmtNum(ex / chaos)} ${unit('chaos', t('itemtab.currency.unit_chaos'))}`
        : (big ? `${(ex / div).toFixed(2)} ${unit('divine', t('itemtab.currency.unit_div'))}` : `${fmtNum(ex)} ${unit('exalted', t('itemtab.currency.unit_ex'))}`);
      const secondary = (selfDiv && chaos) ? `${fmtNum(ex)} ${unit('exalted', t('itemtab.currency.unit_ex'))}` : selfDiv ? '' : (big ? `${fmtNum(ex)} ${unit('exalted', t('itemtab.currency.unit_ex'))}` : (div ? `${(ex / div).toFixed(3)} ${unit('divine', t('itemtab.currency.unit_div'))}` : ''));
      const val = cel('div', 'cur-value', primary);
      if (secondary) val.appendChild(cel('span', 'cur-value-sub', ' · ' + secondary));
      card.appendChild(val);
      const spark = currencySpark(r.logs);
      if (spark) card.appendChild(spark);
      card.appendChild(cel('div', 'cur-note', r.source === 'cx'
        ? t('itemtab.currency.note_cx')
        : t('itemtab.currency.note_scout')));
    } else {
      card.appendChild(cel('div', 'cur-note', cesc(state.notice || t('itemtab.currency.no_price_found'))));
    }
    root.appendChild(card);
  }

  function damageTag(ref, tradeId) {
    if (tradeId && ATTACK_FLAT[tradeId]) return { damage: ATTACK_FLAT[tradeId], form: 'flat' };
    const m = PCT_DMG_RE.exec(ref || '');
    if (m) return { damage: ELEMENT[m[1]], form: 'percent' };
    return { damage: null, form: null };
  }

  // The parser keeps matcher templates ("#% to Cold Resistance"), not the item's own
  // lines. Recover true display text from rawText: strip advanced-copy annotations,
  // then match each template against the original lines the parser already matched.
  function rawModLines(rawText) {
    return String(rawText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('{') && !/^-+$/.test(l))
      .map((l) => l
        .replace(/\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g, '') // drop "(min-max)" roll ranges
        .replace(/ \((?:rune|added rune|implicit|crafted|desecrated|enchant|fractured)\)$/, ''));
  }
  // scale every number in a mod line by its catalyst boost, the way the game
  // prints it (truncating, like EE2's incrRoll)
  function incrText(text, incr) {
    if (!incr || !text) return text;
    return String(text).replace(/[+-]?\d+(?:\.\d+)?/g, (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return n;
      const scaled = Math.trunc(v + (v * incr) / 100 + Number.EPSILON);
      return (n.startsWith('+') ? '+' : '') + scaled;
    });
  }

  function displayText(template, rawLines, claimed, rollValue) {
    const rx = new RegExp('^' + template
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\?#/g, '[+-]?\\d+(?:\\.\\d+)?') + '$');
    // two passes: prefer an unclaimed line whose numbers include this mod's own roll
    // (several mods can share a template, e.g. rune +1 and explicit +6 spell skills)
    for (const requireValue of [true, false]) {
      for (let i = 0; i < rawLines.length; i++) {
        if (claimed.has(i) || !rx.test(rawLines[i])) continue;
        if (requireValue && rollValue != null) {
          const nums = (rawLines[i].match(/[+-]?\d+(?:\.\d+)?/g) || []).map(Number);
          if (!nums.some((n) => Math.abs(n) === Math.abs(rollValue))) continue;
        }
        claimed.add(i);
        return rawLines[i];
      }
      if (rollValue == null) break; // second pass is identical when there is no roll
    }
    return template;
  }

  // the parser stores only the base in info; a rare/magic item's own name is the
  // 3rd line of the nameplate block
  function ownName(rawText, rarity) {
    if (rarity !== 'Rare' && rarity !== 'Unique') return null;
    const head = String(rawText || '').split(/^-+$/m)[0].split('\n').map((l) => l.trim()).filter(Boolean);
    // [Item Class: X, Rarity: Y, <name>, <base>]
    return head.length >= 4 ? head[2] : null;
  }

  // Which trade-id scope to search for each parsed mod type. GGG's matching is
  // asymmetric (user-verified): explicit-scope filters ALSO match desecrated/fractured
  // carriers of the stat (wider net), but crafted/rune/implicit/skill mods live in
  // their own scopes and an explicit filter misses them entirely. One wrong-scoped
  // filter zeroes the whole search, so a type with no scoped id goes OFF (flagged
  // unsearchable) instead of falling back.
  const SCOPE_PREF = {
    explicit: ['explicit'],
    desecrated: ['explicit', 'desecrated'], // explicit preferred: catches both
    fractured: ['explicit', 'fractured'],
    // crafted is resolved dynamically in toModel: single-stat crafts that exist as
    // explicit mods search as explicit (GGG returns the crafted carriers too), but
    // hybrid alloy crafts have no explicit counterpart and need the crafted scope
    implicit: ['implicit'],
    rune: ['rune'],                         // socketed runes + anvil augments
    'added-rune': ['rune'],
    enchant: ['enchant'],
    skill: ['skill'],                       // "Grants Skill: ..." lines
    sanctum: ['sanctum'],
  };

  // ParsedItem (EE2) -> our ItemModel
  function toModel(parsed) {
    // Exceptional NORMAL bases are sold as clean crafting bases. The FILLED-RUNE
    // assumption invents rune bonuses an empty-socket base doesn't have, so it
    // defaults OFF; quality-20 stays ON, because the game's own base search floors
    // defences at the q20 value (an 83-ES base reads 100 there). Still per-item
    // toggleable via state.excAssume, and independent of the user's global assume
    // pref, which stays untouched for every other item.
    const excBase = parsed.rarity === 'Normal' && !!parsed.isExceptional;
    const assume = excBase ? (state.excAssume || { q20: true, fillRunes: false }) : state.assume;
    const rawLines = rawModLines(parsed.rawText);
    const claimed = new Set();
    // Advanced copy (Ctrl+Alt+C, what the price-check hotkey sends) prints each
    // roll's range: "+95(80-100)". A plain Ctrl+C or an in-game market copy does
    // not, and the parser then reports min = max = the roll - which is NOT a
    // one-value range, it's an unknown one. Uniques have no external range table
    // to fall back on, so that distinction decides whether a slider can exist.
    const rangesKnown = /\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/.test(String(parsed.rawText || ''));

    // Defences and weapon damage are OUTCOMES - the mod lines are just recipes
    // (50 flat ES and +100% ES can produce the same item). Comps are found by the
    // computed totals (equipment_filters), so on armour the defence-contributing
    // lines default OFF, and on martial weapons ONLY the lines that feed the
    // item's LISTED DPS default off (flat added damage, local %phys). Multipliers
    // invisible to the sheet DPS - "% Elemental Damage with Attacks", extra
    // totems, ... - stay ON: they are value the DPS filter cannot see. Caster
    // weapons keep everything: spell damage has no DPS-style filter.
    let categoryId = window.EE2.tradeCategory(parsed.category) || null;
    // the parser lumps every endgame item under "map"; GGG splits waystones and
    // tablets into their own categories, and the wrong one drags in fragments,
    // breachstones and logbooks as "comps"
    if (categoryId === 'map') {
      if (parsed.mapTier != null || /Waystone/i.test(parsed.info && parsed.info.refName || '')) categoryId = 'map.waystone';
      else if (/Tablet|Precursor/i.test((parsed.info && parsed.info.refName) || '')) categoryId = 'map.tablet';
    }
    const isArmourPiece = !!categoryId && categoryId.startsWith('armour.') && categoryId !== 'armour.quiver';
    const apsPre = parsed.weaponAS || 0;
    const isMartial = !!categoryId && categoryId.startsWith('weapon.')
      && ((parsed.weaponPHYSICAL || 0) * apsPre >= 50 || (parsed.weaponELEMENTAL || 0) * apsPre >= 50);
    const QS = window.EE2.QUALITY_STATS || {};
    const DEF_REFS = new Set([
      ...((QS.ARMOUR && QS.ARMOUR.flat) || []), ...((QS.ARMOUR && QS.ARMOUR.incr) || []),
      ...((QS.EVASION && QS.EVASION.flat) || []), ...((QS.EVASION && QS.EVASION.incr) || []),
      ...((QS.ENERGY_SHIELD && QS.ENERGY_SHIELD.flat) || []), ...((QS.ENERGY_SHIELD && QS.ENERGY_SHIELD.incr) || []),
    ]);
    const DPS_REFS = new Set([
      ...((QS.PHYSICAL_DAMAGE && QS.PHYSICAL_DAMAGE.flat) || []), ...((QS.PHYSICAL_DAMAGE && QS.PHYSICAL_DAMAGE.incr) || []),
      'Adds # to # Fire Damage', 'Adds # to # Cold Damage', 'Adds # to # Lightning Damage', 'Adds # to # Chaos Damage',
    ]);

    // The roll to search on is the EFFECTIVE one, and it comes from each
    // source's `contributes` - not from `stat.roll`, which is the raw pre-
    // catalyst number. Jewellery quality ("Quality (Cold Modifiers): +40%")
    // boosts every mod carrying that tag, and the advanced copy states the
    // per-mod amount ("- 60% Increased"); EE2 folds it into contributes.
    // Reading stat.roll made a 45-base cold res search as 45 when the item
    // actually has 72, so catalysed jewellery was priced against weaker comps.
    // Summing across sources also fixes stats granted by TWO mods, where
    // sources[0] alone silently reported half the item's total.
    // GGG's own sign convention: a stat has ONE trade id and two spellings, so the sign
    // is the only thing telling them apart. 516 stats in the data are exactly this
    // shape. "faster/slower" and "increased/decreased" are the same convention wearing
    // different words.
    const DOWN_WORD = /\b(reduced|less|decreased|slower)\b/i;
    const UP_WORD = /\b(increased|more|faster)\b/i;

    const effRoll = (sc) => {
      const srcs = (sc && sc.sources) || [];
      let value = 0, min = 0, max = 0, any = false;
      for (const s of srcs) {
        const c = (s.contributes && s.contributes.value != null) ? s.contributes : (s.stat && s.stat.roll);
        if (!c || c.value == null) continue;
        // option stats (Allocates #, variants) carry an id, not a magnitude -
        // summing them would be meaningless, so the first source wins
        if (c.option != null) return { value: c.value, min: c.min != null ? c.min : c.value, max: c.max != null ? c.max : c.value, option: c.option };
        any = true;
        value += c.value;
        min += (c.min != null ? c.min : c.value);
        max += (c.max != null ? c.max : c.value);
      }
      if (!any) return null;
      // NEGATED matchers (674 of them in the stat data) print the opposite sign to the
      // stat's canonical form: Atziri's Step shows "-12% to amount of Damage Prevented by
      // Deflection" for the stat whose canonical ref is "Prevent #% of Damage from
      // Deflected Hits". The parser flips roll AND bounds to canonicalise, but the trade
      // API indexes the sign the ITEM shows - so searching the canonical value asked for
      // +12 and matched nothing. Flip back to the item's own sign here, once, so every
      // downstream consumer (uniqueMin, lower, the min inputs) works in trade's terms.
      // The bounds are also swapped: negating -12..-6 leaves min=12 > max=6, which made
      // uniqueMin bail its `max > min` guard and fall back to an exact match.
      // ...but only for the 88 matchers where the item's wording is a DIFFERENT stat
      // phrased inversely ("Lose # Life when you Block" against a "# Life gained when
      // you Block" ref). The other 586 are reduced/less spellings of an increased/more
      // ref, which is GGG's own sign convention: trade indexes "costs 25% reduced
      // Tribute" as -25 on the increased stat, so the parser's canonical -25 is already
      // the number trade wants and flipping it searched +25 and matched nothing.
      const negSrc = srcs.find((s) => s.stat && s.stat.translation && s.stat.translation.negate);
      if (negSrc) {
        const matcher = String(negSrc.stat.translation.string || '');
        const ref = String((negSrc.stat.stat && negSrc.stat.stat.ref) || '');
        // The pair runs BOTH ways: "reduced Tribute" against an "increased" ref, and
        // "increased Mana Cost of Skills" against a "reduced" ref. 13 stats are the
        // second kind, and a one-directional test left them inverted.
        const spelling = (DOWN_WORD.test(matcher) && UP_WORD.test(ref))
          || (UP_WORD.test(matcher) && DOWN_WORD.test(ref));
        if (!spelling) return { value: -value, min: -max, max: -min };
      }
      return { value, min, max };
    };

    const mods = (parsed.statsByType || []).map((sc) => {
      const trade = (sc.stat && sc.stat.trade && sc.stat.trade.ids) || {};
      const src = (sc.sources && sc.sources[0]) || {};
      const roll = effRoll(sc);
      const rawRoll = src.stat && src.stat.roll; // pre-catalyst, matches the clipboard text
      const rollIncr = rawRoll && rawRoll.unscalable ? 0
        : ((src.modifier && src.modifier.info && src.modifier.info.rollIncr) || 0);
      const info = src.modifier && src.modifier.info;
      // Scope-fungible mods (user-directed): rather than betting on one scope, a
      // desecrated/fractured/single-craft mod searches as a count>=1 group over its
      // explicit id AND its own-scope id - whichever the listing carries matches.
      // Hybrid alloy crafts have no explicit counterpart and stay crafted-only.
      // CRITICAL: a scope can hold SEVERAL trade ids for the same text (GGG keeps
      // duplicate stats - e.g. "# to Spirit" is stat_2704225257 on weapons but
      // stat_3981240776 on gear) - every id goes into the group, or whole item
      // classes silently never match.
      // A tablet's uses are a hard attribute, not a roll to be haggled over: a
      // 10-use tablet is a different product from a 5-use one, so it searches
      // EXACT and ignores the stat-range % (and tier floor) entirely. The count
      // rides on each tablet type's own implicit ("Adds X to a Map / # use
      // remaining"); the cross-type pseudo says the same thing.
      const isUses = /uses? remaining/i.test((sc.stat && sc.stat.ref) || '');
      let pref = SCOPE_PREF[sc.type] || [];
      let altKeys = [];
      if (sc.type === 'crafted') {
        const hybrid = src.modifier && src.modifier.stats && src.modifier.stats.length > 1;
        pref = hybrid ? ['crafted'] : ['explicit'];
        altKeys = hybrid ? [] : ['crafted'];
      } else if (sc.type === 'desecrated' || sc.type === 'fractured') {
        // GGG's explicit filter INCLUDES the desecrated/fractured subset, but not
        // vice versa - so the explicit id alone is the wider, correct search
        pref = ['explicit'];
        altKeys = [sc.type];
      }
      const allIds = [...new Set([...pref, ...altKeys].flatMap((k) => trade[k] || []))];
      const tradeId = allIds[0] || null;
      const altIds = allIds.slice(1);
      const ref = sc.stat && sc.stat.ref;
      const tag = damageTag(ref, tradeId);
      const template = cleanBrackets((src.stat && src.stat.translation && src.stat.translation.string) || ref);
      const isGarbage = tradeId && state.garbage.includes(tradeId);
      // OPTION/enum stats (a unique's "Legacy of #", "Allocates #"): the roll is a
      // discrete variant id, not a magnitude. It picks WHICH mageblood/variant, so
      // it's a distinguishing feature buyers search on - defaults ON on uniques.
      const optionVal = (sc.stat && sc.stat.trade && sc.stat.trade.option && roll && roll.option != null)
        ? roll.option : null;
      return {
        id: tradeId,
        altIds, // same stat in other scopes; searched as an OR alongside id
        kind: sc.type,
        ref,
        // the affix side straight from the advanced copy's header - never guess
        // it from a stat lookup (the same stat can be a prefix on one base and a
        // suffix on another)
        gen: (info && info.generation) || null,
        // the clipboard prints BASE rolls; the game (and our search) uses the
        // catalyst-boosted number, so scale the displayed line to match rather
        // than showing "30% increased Cold Damage" on a row searching 42
        text: incrText(displayText(template, rawLines, claimed, rawRoll ? rawRoll.value : null), rollIncr),
        garbage: isGarbage,
        value: roll ? roll.value : null,
        min: roll ? roll.min : null,       // this tier's bounds (from advanced copy)
        max: roll ? roll.max : null,
        rangesKnown,                        // false = simple copy: bounds unknown, not fixed
        exact: isUses,                      // search min AND max at this value
        // OPTION stats ("Allocates Zarokh's Gift", "Legacy of #") carry an enum id,
        // not a magnitude. GGG encodes the choice IN the stat id (stat_123|9506),
        // not as a value - query.js appends it. Sending it as a minimum, OR as a
        // {option: id} value field, matches nothing and silently kills the search.
        option: optionVal,
        isUnique: parsed.rarity === 'Unique',
        better: sc.stat && sc.stat.better != null ? sc.stat.better : 1, // 1 high good, -1 low good, 0 n/a
        tier: info && info.tier != null ? info.tier : null,
        searchMin: null,                    // user-typed exact min (overrides value-lowering)
        // default OFF: unsearchable lines, garbage-pool mods, rollless meta lines
        // ("Destroys all Augment Sockets...") which as presence filters poison searches,
        // Grants-Skill lines (probed live: the trade2 API's skill filters fail to match
        // listings that visibly have the skill - even exact level bounds return zero),
        // a unique's FIXED rolls (see below - the variable ones stay ON), armour's
        // defence recipe lines and martial weapons' damage prefixes (the computed
        // totals in equipment_filters are what price the item)
        mode: (!tradeId || isGarbage || (roll == null && sc.type === 'rune') || sc.type === 'skill'
          || (isArmourPiece && DEF_REFS.has(ref))
          || (isMartial && DPS_REFS.has(ref))
          // socketed runes / anvil augments: off by default - turn back on to find
          // items socketed exactly like yours
          || sc.type === 'rune' || sc.type === 'added-rune')
          // A unique's FIXED rolls (min == max: the same on every copy ever printed)
          // are dead weight as filters - every listing matches them - so they fold
          // away, which is what EE2 does too (hideNotVariableStat: hidden unless
          // roll.min !== roll.max). Its VARIABLE rolls are the opposite: they are the
          // whole reason one Mageblood is 1ex and another is 200div, so they stay on.
          // Defaulting the lot to off (what this used to do, on the theory that the
          // name pins the item) pinned the item but not its price - the search came
          // back full of the cheapest rolls and read as "yours is worthless".
          // Bounds unknown (simple Ctrl+C rather than advanced copy) defaults ON: if
          // the roll turns out to be fixed the filter matches everything anyway, so
          // it costs nothing, while guessing "off" is what caused the bad reads.
          || (parsed.rarity === 'Unique' && rangesKnown && roll
            && roll.min != null && roll.max != null && roll.min === roll.max
            && optionVal == null)
          ? 'off'
          : (tag.damage && tag.form === 'flat' ? 'pseudo' : 'strict'),
        damage: tag.damage,
        form: tag.form,
        weight: null,
        group: null,
      };
    });
    // Item properties (defences / weapon damage) - a separate trade filter family
    // (equipment_filters) the stat mods can't express. EE2's own q20 machinery
    // normalizes armour/weapons to 20% quality (jewelry untouched), and empty rune
    // sockets can be valued as if they held Greater Iron Runes - both default-on
    // settings, matching how buyers actually evaluate items.
    const props = [];
    const addProp = (key, label, value, on, dp, note) => {
      if (value == null || value <= 0) return;
      const v = dp ? Math.round(value * 10) / 10 : Math.round(value);
      props.push({
        id: 'prop.' + key, prop: true, kind: 'property', ref: label,
        text: `${label}: ${v}${note ? ` (${note})` : ''}`,
        value: v, min: null, max: null, tier: null, searchMin: null,
        // Exceptional Normal bases search their defence/DPS at the EXACT q20 value
        // (no stat-range % loosening) - matching the game's base search. The player
        // can still type a lower min to widen it from there.
        mode: on ? 'strict' : 'off', exact: excBase, damage: null, form: null, weight: null, group: null, altIds: [],
      });
    };

    // ---- Waystones: the value lives in the header properties, not the mods ----
    // GGG gives these their own filter family (map_filters, "Endgame Filters"),
    // which is why mod-only tools price waystones badly. The four that carry the
    // price go on; tier pins the bracket; revives / gold are listed but off.
    // Every MOD defaults off - they're the map's danger text, and which
    // ones matter is build-specific (Rakiata's wants monster ele res), so they're
    // one click from being part of the search.
    // waystones ONLY - a tablet is also "map.*" but its mods ARE its value
    const isWaystone = categoryId === 'map.waystone';
    if (isWaystone) {
      const mp = (key, label, value, on) => {
        if (value == null) return;
        props.push({
          id: 'mapprop.' + key, prop: true, kind: 'property', ref: label,
          text: `${label}: ${value}${key === 'map_tier' || key === 'map_revives' ? '' : '%'}`,
          value, min: null, max: null, tier: null, searchMin: null,
          mode: on ? 'strict' : 'off', damage: null, form: null, weight: null, group: null, altIds: [],
          exact: key === 'map_tier', // tier is a bracket, not a floor
        });
      };
      mp('map_tier', t('itemtab.property.waystone_tier'), parsed.mapTier, true);
      mp('map_iir', t('itemtab.property.item_rarity'), parsed.mapItemRarity, true);
      mp('map_packsize', t('itemtab.property.pack_size'), parsed.mapPackSize, true);
      mp('map_rare_monsters', t('itemtab.property.monster_rarity'),
        parsed.mapMonsterRarity != null ? parsed.mapMonsterRarity : parsed.mapRareMonsters, true);
      mp('map_magic_monsters', t('itemtab.property.monster_effectiveness'),
        parsed.mapEffectiveness != null ? parsed.mapEffectiveness : parsed.mapMagicMonsters, true);
      // drop chance swings a waystone's price as hard as rarity/pack size, so it is ON
      // with the rest of the value-carrying properties. It used to default off, which
      // also buried it in the auto-set-aside group where you could not see it at all.
      mp('map_bonus', t('itemtab.property.waystone_drop_chance'), parsed.mapDropChance, true);
      mp('map_revives', t('itemtab.property.revives_available'), parsed.mapRevives, false);
      mp('map_gold', t('itemtab.property.waystone_gold'), parsed.mapGold, false);
      for (const m of mods) m.mode = 'off';
    }

    const q20On = assume.q20 && window.EE2.itemIsModifiable(parsed);
    // rune fill: Greater Iron Rune effect for this category, x empty sockets.
    // Caster weapons are excluded - they don't use Greater Iron Runes.
    const CASTER_NO_IRON = categoryId === 'weapon.wand' || categoryId === 'weapon.staff' || categoryId === 'weapon.sceptre';
    const emptySockets = (parsed.augmentSockets && parsed.augmentSockets.empty) || 0;
    let runeIncrPhys = 0, runeIncrDef = 0, runeNote = '';
    if (assume.fillRunes && emptySockets > 0 && !CASTER_NO_IRON) {
      const entry = window.EE2.augmentData('Greater Iron Rune')
        .find((e) => e.categories && e.categories.includes(parsed.category));
      if (entry && entry.values && entry.values[0]) {
        const total = entry.values[0] * emptySockets;
        if (/Physical Damage/.test(entry.baseStat || entry.string || '')) runeIncrPhys = total;
        else if (/Armour|Evasion|Energy Shield/.test(entry.baseStat || entry.string || '')) runeIncrDef = total;
        if (runeIncrPhys || runeIncrDef) runeNote = tn('itemtab.property.rune_note', emptySockets, { count: emptySockets });
      }
    }
    const notes = [q20On && (parsed.quality || 0) < 20 ? t('itemtab.property.q20_tag') : '', runeNote].filter(Boolean).join(', ');

    // defences/phys: displayed = baseFlat x (1 + increased%) x (1 + quality%).
    // Runes are "increased" mods, so they ADD to the item's increased-sum
    // (additive with e.g. "96% increased Energy Shield"), never multiply the
    // final value. Rescale the displayed number by the incr and quality deltas.
    const adjVal = (raw, statsKey, runeIncr) => {
      if (raw == null || raw <= 0) return raw;
      const qCur = parsed.quality || 0;
      const qEff = q20On ? Math.max(20, qCur) : qCur;
      let incr = 0;
      try { incr = window.EE2.calcPropBase(window.EE2.QUALITY_STATS[statsKey], parsed).incr.value || 0; } catch {}
      return raw * ((1 + (incr + runeIncr) / 100) / (1 + incr / 100)) * ((1 + qEff / 100) / (1 + qCur / 100));
    };
    addProp('ar', t('itemtab.property.armour'), adjVal(parsed.armourAR, 'ARMOUR', runeIncrDef), true, false, notes);
    addProp('ev', t('itemtab.property.evasion'), adjVal(parsed.armourEV, 'EVASION', runeIncrDef), true, false, notes);
    addProp('es', t('itemtab.property.energy_shield'), adjVal(parsed.armourES, 'ENERGY_SHIELD', runeIncrDef), true, false, notes);
    // Runic Ward is real defence - runeforged gear trades raw AR/EV/ES for it,
    // so leaving it out prices those items against the wrong comps entirely.
    // Left unscaled: quality and Iron Runes boost Armour/Evasion/Energy Shield,
    // not ward, so the printed number is already the number.
    addProp('ward', t('itemtab.property.runic_ward'), parsed.armourRW, true);
    addProp('block', t('itemtab.property.block'), parsed.armourBLOCK, true);
    addProp('spirit', t('itemtab.property.spirit'), parsed.weaponSPIRIT, true);

    // weapons: parser's weaponPHYSICAL/ELEMENTAL are damage PER HIT; DPS = dmg x APS.
    // Physical normalizes to q20 and adds the assumed rune's increased-phys (same
    // additive-increased model as defences above).
    const aps = parsed.weaponAS || 0;
    let physHit = parsed.weaponPHYSICAL || 0;
    if (physHit > 0) physHit = adjVal(physHit, 'PHYSICAL_DAMAGE', runeIncrPhys);
    const pdps = aps ? physHit * aps : 0;
    const edps = aps ? (parsed.weaponELEMENTAL || 0) * aps : 0;
    addProp('pdps', t('itemtab.property.physical_dps'), pdps, pdps >= 50, true, notes);
    addProp('edps', t('itemtab.property.elemental_dps'), edps, edps >= 50, true);
    if (pdps + edps > 0) addProp('dps', t('itemtab.property.total_dps'), pdps + edps, pdps + edps >= 100, true, notes);
    addProp('aps', t('itemtab.property.attacks_per_second'), aps, false, true);
    addProp('crit', t('itemtab.property.critical_chance'), parsed.weaponCRIT, false, true);

    // Rune sockets ("Augmentable Sockets" - GGG's own term), its own
    // equipment_filter (rune_sockets). A count, not a roll, so it searches
    // exact-min and the stat-range % never loosens it. EE2's default: on only
    // when the item carries MORE sockets than its base grants, or is corrupted
    // (both make the socket count a real, fixed price driver); otherwise present
    // but off. Without it, a 2-socket item was priced against every 0/1-socket
    // one - which is what dragged this glove's floor down to a junk comp.
    const sock = parsed.augmentSockets;
    if (sock && sock.current > 0) {
      const socketsMatter = sock.current > sock.normal || parsed.isCorrupted;
      props.push({
        id: 'prop.rune_sockets', prop: true, kind: 'property', ref: t('itemtab.property.augmentable_sockets'),
        text: `${t('itemtab.property.augmentable_sockets')}: ${sock.current}`,
        value: sock.current, min: null, max: null, tier: null, searchMin: null,
        mode: socketsMatter ? 'strict' : 'off', exact: true,
        damage: null, form: null, weight: null, group: null, altIds: [],
      });
    }

    // Resistances -> GGG's OWN pseudo stat lines (user-specified): one
    // "+N% total Resistance" pseudo row above the res lines - ALWAYS the
    // all-res pseudo, never the elemental-only variant: a comp whose total
    // includes chaos is strictly better at the same number, and excluding it
    // hides the competition that price-caps this item. When the item itself
    // has chaos, an empty-min "+#% to Chaos Resistance" pseudo rides along
    // (chaos must EXIST on comps; the minimum is the user's call). The
    // explicit lines stay as their own rows, OFF by default, so the user can
    // flip back to exact-element searching. Runes never tally.
    // Desecrated (and fractured) lines that have a 1:1 explicit equivalent split
    // into TWO rows: the EXPLICIT filter on (it already matches desecrated
    // listings - GGG's explicit scope is the superset) and the DESECRATED row
    // off beneath it, so narrowing to desecrated-only is one click. Lines with
    // no explicit counterpart keep their own scope and stay single rows.
    for (let i = mods.length - 1; i >= 0; i--) {
      const m = mods[i];
      if ((m.kind !== 'desecrated' && m.kind !== 'fractured') || !m.id) continue;
      // CRITICAL: a scope holds SEVERAL ids for one text (GGG duplicates stats -
      // "+# to Accuracy Rating" is stat_803737631 globally but stat_691932474
      // local). EVERY id of a scope must survive into its row as an OR group, or
      // the filter searches an id real listings don't carry and returns nothing.
      const allIds = [m.id, ...(m.altIds || [])];
      const explicitIds = allIds.filter((id) => String(id).startsWith('explicit.'));
      const ownIds = allIds.filter((id) => String(id).startsWith(m.kind + '.'));
      if (!explicitIds.length || !ownIds.length) continue; // no 1:1 explicit counterpart
      const explicitRow = {
        ...m, kind: 'explicit', id: explicitIds[0], altIds: explicitIds.slice(1),
        foldGroup: `scope-${i}`, foldHead: true,
        // the head reads EXPLICIT because that is the filter it runs, but the line on
        // the item is desecrated/fractured. Without this the row looks like an ordinary
        // explicit and the only clue is expanding the fold.
        scopeSrc: m.kind,
      };
      const ownRow = {
        ...m, kind: m.kind, id: ownIds[0], altIds: ownIds.slice(1),
        mode: 'off', foldGroup: `scope-${i}`, foldHead: false,
      };
      // invariant: the split must not lose a single trade id. Dropping one makes
      // the filter search an id listings may not carry - a SILENT zero-result
      // search, which is how this shipped broken once (15 stats carry two ids).
      const kept = new Set([...explicitIds, ...ownIds]);
      if (kept.size !== new Set(allIds).size) {
        console.error('scope split dropped trade ids', { text: m.text, allIds, kept: [...kept] });
      }
      mods.splice(i, 1, explicitRow, ownRow);
    }

    const RES = (window.ItemQuery && window.ItemQuery.RES_STATS) || {};
    const resOf = (m) => (m.id && m.kind !== 'rune' && m.kind !== 'added-rune' && !String(m.id).startsWith('rune.')
      ? RES[String(m.id).split('.').pop()] : undefined);
    // fold each res line ONCE (a split desecrated res line has an explicit head
    // and an off scope-row; only the head carries the value into the total)
    const resRows = mods.filter((m) => resOf(m) && m.value != null && m.foldHead !== false);
    if (resRows.length) {
      const total = Math.round(resRows.reduce((s, m) => s + m.value * resOf(m).mult, 0));
      const hasChaos = resRows.some((m) => resOf(m).chaos);
      // every res row (both halves of a split) goes off and folds under the pseudo
      for (const m of mods) {
        if (resOf(m) && m.value != null) { m.mode = 'off'; m.foldGroup = 'res'; m.foldHead = false; }
      }
      const pseudoRows = [{
        id: 'pseudo.pseudo_total_resistance',
        altIds: [], kind: 'pseudo', pseudoAuto: true, ref: 'pseudo total resistance',
        text: t('itemtab.property.pseudo_total_resistance', { total }),
        value: total, min: null, max: null, tier: null, searchMin: null,
        mode: 'strict', damage: null, form: null, weight: null, group: null, garbage: false,
        foldGroup: 'res', foldHead: true, // the folded res lines accordion under this
      }];
      if (hasChaos) {
        pseudoRows.push({
          id: 'pseudo.pseudo_total_chaos_resistance', altIds: [], kind: 'pseudo',
          pseudoAuto: true, editableMin: true, ref: 'pseudo chaos resistance',
          text: t('itemtab.property.pseudo_chaos_resistance'), value: null, min: null, max: null,
          tier: null, searchMin: null, mode: 'strict', damage: null, form: null,
          weight: null, group: null, garbage: false,
        });
      }
      mods.splice(mods.indexOf(resRows[0]), 0, ...pseudoRows);
    }

    // lines the parser couldn't identify (e.g. an unrevealed desecrated modifier
    // mid-reveal) - keep them visible as unsearchable n/a rows, like the game shows
    // ...but NOT the item's instruction/flavour text. The parser sweeps any
    // unmatched line in a mod section into unknownModifiers, which on a jewel
    // catches "Place into an allocated Jewel Socket... Right click to remove
    // from the Socket." Real mods never end in a period - verified against all
    // 4,719 stat matchers in the data, none do - so that alone separates them.
    // Per-LINE that rule misses multi-line prose: a unique tablet's flavour text
    // is "A simple instruction that will purify an entire region," / "making it
    // safe and kind for weary travellers." - only the second line ends with a
    // period, so the first leaked through as an n/a mod row.
    // Prose lives in its own dashed section, so judge the SECTION: if its last
    // line ends with a period, the whole block is prose. A mod section can never
    // qualify - no stat matcher ends in a period - and a tablet's real
    // "Adds a Mirror of Delirium to a Map" / "5 uses remaining" block is kept
    // because its last line has none.
    const proseLines = new Set();
    for (const sec of String(parsed.rawText || '').split(/^-{3,}$/m)) {
      const lines = sec.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && /\.\s*$/.test(lines[lines.length - 1])) {
        for (const l of lines) proseLines.add(l);
      }
    }
    const isFlavour = (t) => proseLines.has(t) || /\.\s*$/.test(t)
      || /\b(right|shift)[- ]?click\b/i.test(t);
    const unknowns = (parsed.unknownModifiers || []).map((u) => {
      const rawLine = (u && u.text) || String(u);
      const text = cleanBrackets(rawLine);
      // match on both forms: proseLines holds the item text verbatim
      if (isFlavour(text) || proseLines.has(rawLine.trim())) return null;
      return {
        id: null, altIds: [], kind: 'explicit', ref: text, text, garbage: false,
        value: null, min: null, max: null, tier: null, searchMin: null,
        mode: 'off', damage: null, form: null, weight: null, group: null,
      };
    }).filter(Boolean);

    const title = ownName(parsed.rawText, parsed.rarity);
    // A unique resolves to its UNIQUE entry, so info.refName is the unique's own
    // name ("Clear Skies") and NOT the base ("Delirium Tablet"). parsed.baseType
    // carries the real base at every rarity. Taking refName sent a unique tablet's
    // name as `type` and GGG answered 400 "Unknown item base type"; it also made
    // the header print the unique's name twice.
    const baseType = parsed.baseType
      || (parsed.info && parsed.info.unique && parsed.info.unique.base)
      || (parsed.info && parsed.info.refName) || (parsed.info && parsed.info.name) || null;
    // Capture each mod's PARSE-TIME auto-off classification so the "collapsed
    // modifiers" bracket (item-ui.js) knows which off mods the classifier set
    // aside vs. ones turned off by hand. Sticky - never changes as modes toggle;
    // garbage-pool membership (live) is folded in alongside it at render time.
    const allMods = [...props, ...mods, ...unknowns];
    // Skill/support gems: level and quality ARE the price (a level 20 is worth a
    // multiple of a 19), so they get parsed off the property block and drive real
    // trade filters. Read from the raw text rather than the base db, since a gem
    // added in a new patch still has to price. The requirement line on a gem reads
    // "Requires: Level 90", so the property "Level: 20 (Max)" is unambiguous here -
    // gear's "Requirements: / Level: 78" never reaches this branch.
    const rawTxt = String(parsed.rawText || '');
    // Gem identity comes from the PARSER and the item database, not from matching English
    // text: `parsed.category` is set off the client's own localised rarity line, and the
    // vendored db keys every gem's type to its language-independent refName ("Active Skill
    // Gem" / "Support Skill Gem" / "MetaSkillGem"). The English-only regexes this replaces
    // meant gem level and category silently did nothing on a translated client, so a level
    // 20 gem priced as if it had no level at all. The class line is still read as a
    // fallback, for a gem too new to be in the db yet.
    const dbGemCategory = String((parsed.info && parsed.info.craftable && parsed.info.craftable.category) || '');
    const gemClass = /^Item Class: (Skill|Support|Meta) Gems\s*$/m.exec(rawTxt);
    const isGem = parsed.category === 'Gem' || /gem/i.test(dbGemCategory) || !!gemClass;
    // trade2's own gem categories (from /api/trade2/data/filters): gem.activegem =
    // Skill Gem, gem.supportgem = Support Gem, gem.metagem = Meta Gem
    const gemCategory = !isGem ? null
      : /support/i.test(dbGemCategory) ? 'gem.supportgem'
        : /meta/i.test(dbGemCategory) ? 'gem.metagem'
          : dbGemCategory ? 'gem.activegem'
            : gemClass && gemClass[1] === 'Support' ? 'gem.supportgem'
              : gemClass && gemClass[1] === 'Meta' ? 'gem.metagem'
                : 'gem.activegem';
    // A gem copied while SOCKETED prints its EFFECTIVE level - base plus every
    // +level your gear and passives grant ("Level: 32 (augmented)" on a level 20 gem
    // with +12). Nobody can buy a level 32 Comet, so the search must use the gem's
    // own level. The copy spells the split out:
    //   Level: 32 (augmented)
    //   20 Levels from Gem (Max)
    //   +12 Levels from Global Modifiers (augmented)
    // so "Levels from Gem" is authoritative when present; a stash copy has no
    // breakdown and its plain "Level: 20 (Max)" is the gem's own level already.
    const GEM_MAX_LEVEL = 20;
    // The parser reads the level off the client's own localised "Level: " line, so the
    // shown level is right in every language - but it is the EFFECTIVE level, which on a
    // socketed gem includes every +level granted by gear.
    const shownLevel = isGem && Number.isFinite(Number(parsed.gemLevel)) ? Number(parsed.gemLevel) : null;
    // The breakdown that separates the gem's OWN level from the gear bonus ("20 Levels
    // from Gem", "(augmented)") is not in the vendored client strings for ANY language,
    // so it can only be read on an English client. Everywhere else, fall back to capping
    // at the highest level a gem can actually be - searching for a level 32 Comet finds
    // nothing, since nobody can buy one.
    const gemOwnLevel = isGem ? /^(\d+) Levels? from Gem/m.exec(rawTxt) : null;
    const gemLevelAugmented = isGem && /^Level: \d+[^\n]*augmented/mi.test(rawTxt);
    const gemLevel = (() => {
      if (gemOwnLevel) return Number(gemOwnLevel[1]);
      if (shownLevel == null) return null;
      return (gemLevelAugmented || shownLevel > GEM_MAX_LEVEL) ? Math.min(shownLevel, GEM_MAX_LEVEL) : shownLevel;
    })();
    // how much of the shown level came from gear (display only - never searched)
    const gemLevelBonus = (() => {
      if (shownLevel == null || gemLevel == null) return 0;
      return shownLevel > gemLevel ? shownLevel - gemLevel : 0;
    })();
    // An unidentified unique prints its BASE where the name goes, so the name is simply
    // not in the text. Most bases carry exactly one unique, and those resolve outright -
    // an unidentified "Time-Lost Diamond" can only be Against the Darkness, so we search
    // it by name like any identified unique. The rest are genuinely ambiguous (Sapphire
    // is Grand Spectrum or Voices; Diamond is one of seven) and get searched as the base,
    // with the UI saying so - guessing there would price a 2000-divine Voices against
    // Grand Spectrums.
    const unidCandidates = (parsed.isUnidentified && parsed.rarity === 'Unique' && baseType
      && window.EE2 && window.EE2.uniquesOnBase)
      ? window.EE2.uniquesOnBase(baseType) : [];
    const unidResolved = unidCandidates.length === 1 ? unidCandidates[0] : null;

    // a gem searches by its own name as the base type ("Powered by Verisium"). trade2
    // indexes gems by their ENGLISH name, so the db's refName is the identity to search
    // with - the raw text carries whatever language the player's client is in.
    const gemName = (() => {
      if (!isGem) return null;
      const ref = (parsed.info && (parsed.info.refName || parsed.info.name)) || '';
      if (ref) return ref;
      const m = /^Rarity: Gem\s*\n(.+)$/m.exec(rawTxt);
      return (m ? m[1].trim() : '') || baseType || title || null;
    })();
    // A gem's lines are its skill's own stats at that level - every gem of the same
    // name and level carries them, and trade2 indexes none of them. So they go in as
    // display-only and the search rides on type + gem level + quality.
    if (isGem) for (const _m of allMods) _m.mode = 'off';
    for (const _m of allMods) _m.initiallyOff = (_m.mode === 'off');
    // "Sockets: S S" line -> augmentable socket count, drawn as pips on the art.
    // Localised like every other header, so the socket pips vanished on a translated
    // client (renderer/vendor/ee2/data/<lang>/client_strings.js SOCKETS).
    const sockLine = /^(?:Sockets|Fassungen|Гнезда|Châsses|Engarces|Encaixes): (.+)$/m.exec(String(parsed.rawText || ''));
    const sockCount = sockLine ? (sockLine[1].match(/S/g) || []).length : 0;
    return {
      title,
      base: baseType || '?',
      // uniques search by NAME - that alone finds the item; mod filters refine rolls.
      // Unidentified ones print the BASE where the name goes, so the name has to come
      // from the base instead: resolved outright when the base carries one unique, left
      // null (search the base + identified=No) when it carries several.
      name: parsed.rarity === 'Unique'
        ? (parsed.isUnidentified
          ? (unidResolved ? unidResolved.refName : null)
          : (title || (parsed.info && parsed.info.name)))
        : null,
      // >1 unique on this base, so which one it is cannot be known from the TEXT - but the
      // player can see the art. The UI shows the candidates and lets them say which, which
      // is the only way to price a 2000-divine unidentified Voices as a Voices instead of
      // averaging it against Grand Spectrums.
      unidCandidates: unidCandidates.length > 1 ? unidCandidates : null,
      unidResolvedName: unidResolved ? unidResolved.name : null,
      // Tablets: pin the BASE TYPE ("Delirium Tablet"). Tablet-type-specific mods
      // and generic ones (effectiveness) mix freely, so without this a search can
      // return the wrong tablet type entirely. With the type pinned, uses
      // remaining only has to carry the count - the pseudo is then as safe as the
      // type-specific implicit.
      // An item with NO searchable mods has nothing else to identify it, so the base type
      // IS the search. Wombgifts are the case that exposed this: their category
      // (BrequelFruit) has no trade equivalent, so categoryId was null, type was null,
      // name was null and the whole query collapsed to "any Currency, cheapest first" -
      // which is why every one of them came back as 1 transmute.
      type: (categoryId === 'map.tablet' || parsed.isUnidentified || !allMods.some((m) => m.id))
        ? baseType : (isGem ? gemName : null),
      // Wombgift value is driven by its level, and the levels price very differently, so
      // the search pins it exactly rather than using it as a floor.
      exactLevel: parsed.category === 'BrequelFruit',
      // unidentified: drives misc_filters.identified=false, and the tier when the
      // item carries one (EE2 only searches the tier at 5+, where it starts mattering)
      isUnidentified: !!parsed.isUnidentified,
      unidentifiedTier: parsed.unidentifiedTier != null ? Number(parsed.unidentifiedTier) : null,
      rarity: parsed.rarity || null,
      itemLevel: parsed.itemLevel || null,
      // gem facts: level drives misc_filters.gem_level, and isGem switches the
      // header to a gem-level range instead of an item-level one
      isGem,
      gemLevel,
      // gemLevelBonus > 0 = the copy came off a socketed gem and this much of the
      // level shown was your gear; the search uses gemLevel, never the sum
      gemLevelAugmented,
      gemLevelBonus,
      // item art from the EE2 base/unique db (null on a db miss - header shows no
      // icon then) + socket count for the pips overlay
      icon: (parsed.info && parsed.info.icon) || null,
      sockets: sockCount,
      // actual quality on the item (null when it has no Quality line) - seeds the
      // header q-range control the same way itemLevel seeds the ilvl one
      // the item's own quality, catalyst included: "Quality (Cold Modifiers):
      // +40%" reads 40 (EE2's parsed.quality is 0 for catalyst rings), so a
      // catalysed item compares its quality against comps instead of showing 0
      quality: (() => {
        const qm = /^Quality[^:\n]*:\s*\+?(\d+)/m.exec(String(parsed.rawText || ''));
        return qm ? Number(qm[1]) : (typeof parsed.quality === 'number' ? parsed.quality : null);
      })(),
      // charm base facts ("Lasts 3.20 (augmented) Seconds", "Consumes 20 of 68
      // (augmented) Charges on use") - display-only, no trade filter exists
      charm: (() => {
        const raw = String(parsed.rawText || '');
        const mL = /^Lasts ([\d.]+)(?: \(augmented\))? Seconds?/m.exec(raw);
        const mC = /^Consumes ([\d,]+)(?: \(augmented\))? of ([\d,]+)(?: \(augmented\))? Charges/m.exec(raw);
        if (!mL && !mC) return null;
        return { lasts: mL ? mL[1] : null, consumes: mC ? `${mC[1]} of ${mC[2]}` : null };
      })(),
      category: isGem ? gemCategory : categoryId,
      mods: allMods,
      // exchangeable non-gear currency gets a quick exchange-value lookup instead
      // of a whisper search (raw crafting orbs excluded - see CURRENCY_SKIP)
      currencyTag: (() => {
        const t = parsed.info && parsed.info.tradeTag;
        if (t && !CURRENCY_SKIP.has(t)) return t;
        // CX-only currency/fragments (no poe2scout tradeTag) still get an
        // exchange value via the currency-exchange feed - match by name.
        if (!t && parsed.rarity !== 'Unique') {
          const nm = (parsed.info && parsed.info.name) || baseType;
          const cx = nm && CX_BY_NAME.get(String(nm).toLowerCase());
          if (cx) return cx;
        }
        return null;
      })(),
      currencyName: (parsed.info && parsed.info.name) || baseType || null,
      currencyIcon: (parsed.info && parsed.info.icon) || null,
      // whether the q20 / filled-rune assumptions even apply to this item, so the
      // live toggles only show when they can change the numbers
      // shown whenever the item CLASS can take runes - not only when sockets
      // happen to be empty right now. Toggling it on a fully-socketed item is a
      // no-op, which is fine; hiding it makes the setting unreachable.
      runeFillable: !!parsed.augmentSockets && !CASTER_NO_IRON,
      // itemIsModifiable() only asks whether the item has a `craftable` block, and
      // CURRENCY HAS ONE (Exalted Orb is craftable.category "Currency", a Wombgift is
      // "BrequelFruit"). So every currency looked quality-upgradable and got an
      // "assume quality 20" checkbox it can never have. Quality is a gear and gem
      // concept, so require a real equipment/gem trade category as well - currency
      // either maps to "currency*" or, like Wombgifts, to nothing at all.
      // Deliberately NOT gated on quality < 20: an already-20% item makes the
      // toggle a no-op, not a reason to hide the control.
      q20able: !!(window.EE2.itemIsModifiable(parsed)
        && categoryId && !/^currency/.test(categoryId) && !/^map/.test(categoryId)),
      // Exceptional Normal base: drives the OFF-by-default assumptions + corrupted=No
      exceptionalBase: excBase,
    };
  }

  // History models predate newer display fields - backfill what's derivable so
  // restored searches keep up with the UI (icon via the EE2 db, sockets via the
  // Augmentable Sockets property row it already carries).
  function backfillModel(m) {
    if (!m) return;
    if (m.icon === undefined && window.EE2 && window.EE2.ready) {
      const ent = (m.name && window.EE2.itemByRef('UNIQUE', m.name)) || window.EE2.itemByRef('ITEM', m.base);
      const one = Array.isArray(ent) ? ent[0] : ent;
      m.icon = (one && one.icon) || null;
    }
    if (m.sockets == null) {
      const sp = (m.mods || []).find((x) => /^Augmentable Sockets/.test(x.text || ''));
      const n = sp && /(\d+)/.exec(sp.text);
      m.sockets = n ? Number(n[1]) : 0;
    }
    // Saved records carry whatever q20able/runeFillable meant when they were
    // stored, and those used to be gated on the item's CURRENT quality / empty
    // sockets - so a restored 20%-quality or fully-runed item came back with the
    // assume chips switched off for good. Both are class facts, so re-derive them
    // from the model every restore instead of trusting the stored booleans.
    // Same story for the scope-split rail: the split itself is saved (foldGroup +
    // foldHead), but a record written before scopeSrc existed has a head row with no
    // idea it came off a desecrated line, so restored items showed a bare EXPLICIT row.
    // Re-derive it from the fold members instead of trusting the stored field.
    const heads = (m.mods || []).filter((x) => x.foldGroup && x.foldHead);
    for (const head of heads) {
      if (head.scopeSrc) continue;
      const member = (m.mods || []).find((x) => x.foldGroup === head.foldGroup && x.foldHead === false
        && (x.kind === 'desecrated' || x.kind === 'fractured'));
      if (member) head.scopeSrc = member.kind;
    }
    const cat = m.category || '';
    const gear = !!cat && !/^currency/.test(cat) && !/^map/.test(cat);
    m.q20able = gear;
    m.runeFillable = gear && (m.sockets > 0 || (m.mods || []).some((x) => x.id === 'prop.rune_sockets'))
      && cat !== 'weapon.wand' && cat !== 'weapon.staff' && cat !== 'weapon.sceptre';
  }

  const profileOf = (mods) => mods.filter((m) => m.damage && m.form).map((m) => ({ form: m.form, element: m.damage }));

  // ---- comparability totals: one number per dimension, so a comp reads at a
  // glance against your item instead of mousing over and adding rolls up. Same
  // math for your item and every comp, so the delta is honest.
  const RES = (window.ItemQuery && window.ItemQuery.RES_STATS) || {};
  const DEFAULT_WEIGHTS = (window.ItemQuery && window.ItemQuery.DEFAULT_WEIGHTS) || { phys: 1.33, fire: 1, cold: 1, lightning: 1, chaos: 1 };
  const DMG_STATS = { // bare hash -> weight (matches DEFAULT_WEIGHTS)
    stat_3032590688: 1.33, // Physical
    stat_1573130764: 1, stat_4067062424: 1, stat_1754445556: 1, stat_674553446: 1, // fire/cold/lightning/chaos
  };
  const bareOf = (id) => (id ? String(id).split('.').pop() : null);
  const firstNum = (t) => { const m = String(t).match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
  const avgNum = (t) => {
    const m = /Adds (-?\d+(?:\.\d+)?) to (-?\d+(?:\.\d+)?)/.exec(String(t));
    return m ? (Number(m[1]) + Number(m[2])) / 2 : firstNum(t);
  };
  // recover a resistance contribution from a line's TEXT, for lines with no
  // usable hash. "+N% to all Elemental Resistances" -> 3x, "... X and Y
  // Resistances" -> 2x, a single (or Chaos) resistance -> 1x. Deliberately does
  // NOT match "increased Explicit Resistance Modifier magnitudes" (a magnitude
  // mod, not a resistance value) - that has no "to ... Resistance" shape.
  function resFromText(text) {
    const t = String(text || '');
    if (/magnitude|modifier/i.test(t)) return null;
    const m = /(-?\d+(?:\.\d+)?)%?\s+to\s+(.+?)\s+Resistances?\b/i.exec(t);
    if (!m) return null;
    const v = Number(m[1]);
    if (!Number.isFinite(v)) return null;
    const what = m[2].toLowerCase();
    const mult = /all elemental/.test(what) ? 3 : /\band\b/.test(what) ? 2 : 1;
    return { v, mult };
  }
  // total resistance a set of {id/hash, text} lines carries (all-res counts 3x,
  // chaos included - GGG's own pseudo_total_resistance definition). Matches by
  // hash first; falls back to the TEXT when a line has no usable hash - the
  // trade API returns implicit lines as plain strings, so an implicit
  // "+14% to all Elemental Resistances" would otherwise be silently dropped from
  // a comp's total while your own item's pseudo (which has the hash) counts it.
  function resTotal(lines) {
    let t = 0, any = false;
    for (const m of lines) {
      const txt = m.text != null ? m.text : m.description;
      const r = RES[bareOf(m.id || m.hash)];
      if (r) {
        const v = firstNum(txt);
        if (v == null) continue;
        any = true; t += v * (r.mult || 1);
      } else {
        const rt = resFromText(txt);
        if (rt) { any = true; t += rt.v * rt.mult; }
      }
    }
    return any ? Math.round(t) : null;
  }
  // weighted added-damage-to-attacks total (the fungible pool), same weights the
  // search ranks on - so a fire+cold comp is comparable to your fire+lightning one
  function dmgTotal(lines) {
    let t = 0, any = false;
    for (const m of lines) {
      const w = DMG_STATS[bareOf(m.id || m.hash)];
      if (w == null) continue;
      const v = avgNum(m.text != null ? m.text : m.description);
      if (v == null) continue;
      any = true; t += v * w;
    }
    return any ? Math.round(t * 10) / 10 : null;
  }
  // augmentable (rune) sockets on a fetched listing
  const runeSockets = (item) => (item.sockets || []).filter((s) => s && s.type === 'rune').length;

  // your item's reference totals, computed once per search
  function myTotals() {
    const active = state.item.mods.filter((m) => m.mode !== 'off');
    const resMod = state.item.mods.find((m) => m.id === 'pseudo.pseudo_total_resistance');
    const sockMod = state.item.mods.find((m) => m.id === 'prop.rune_sockets');
    let dmg = 0, hasDmg = false;
    for (const m of active) {
      if (m.form === 'flat' && m.damage && m.value != null) {
        hasDmg = true; dmg += m.value * (DEFAULT_WEIGHTS[m.damage] != null ? DEFAULT_WEIGHTS[m.damage] : 1);
      }
    }
    return {
      res: resMod && resMod.value != null ? Math.round(resMod.value) : null,
      dmg: hasDmg ? Math.round(dmg * 10) / 10 : null,
      sockets: sockMod && sockMod.value != null ? sockMod.value : null,
    };
  }

  // trade2 fetch listing -> display + classify shape. myIds = the stat ids my active
  // search cares about, for diff-highlighting comps against the item. ref = my
  // item's comparability totals, for the at-a-glance +/- on the peek card.
  function toListing(l, myIds, ref) {
    const item = l.item || {};
    // The API has NO desecratedMods array - desecrated lines arrive inside
    // explicitMods carrying flags.desecrated and a "stat.desecrated.*" hash.
    // Special mod types all arrive inside explicitMods, distinguished only by a
    // flag (verified across the cached listings: crafted, desecrated and
    // fractured are the three that occur). Each gets the game's own treatment
    // in the peek card, so a comp's provenance reads at a glance.
    const flagOf = (m) => {
      if (!m || typeof m !== 'object') return null;
      const f = m.flags || {};
      const hash = String(m.hash || '');
      if (f.desecrated || /^stat\.desecrated\./.test(hash)) return 'des';
      if (f.fractured || /^stat\.fractured\./.test(hash)) return 'fractured';
      if (f.crafted || /^stat\.crafted\./.test(hash)) return 'crafted';
      return null;
    };
    const norm1 = (m) => {
      const base = (typeof m === 'string') ? { text: cleanBrackets(m), id: null } : {
        text: cleanBrackets(m.description || ''),
        id: m.hash ? String(m.hash).replace(/^stat\./, '') : null,
        kind: flagOf(m), // -> styled + labelled in the peek card
      };
      base.delta = null; // filled by the rank-pairing pass below
      return base;
    };
    // sections in the game's own tooltip order: enchants/runes on top, implicits,
    // then the explicit block (fractured -> explicit -> crafted)
    const sectionsRaw = [
      ['rune', [].concat(item.enchantMods || [], item.runeMods || [])],
      ['implicit', item.implicitMods || []],
      ['explicit', [].concat(item.fracturedMods || [], item.explicitMods || [], item.craftedMods || [])],
    ];
    const mods = [];
    const secs = [];
    for (const [key, arr] of sectionsRaw) {
      const lines = arr.map(norm1);
      mods.push(...lines);
      if (lines.length) secs.push({ key, lines });
    }
    const profile = mods.map((m) => damageTag(null, m.id)).filter((t) => t.damage)
      .map((t) => ({ form: t.form, element: t.damage }));
    // ids lack the %-dmg regex path (no ref); fall back to text detection
    for (const m of mods) {
      const t = /(?:^|\s)(\d+)% increased (Physical|Fire|Cold|Lightning|Chaos) Damage$/.exec(m.text);
      if (t) profile.push({ form: 'percent', element: ELEMENT[t[2]] });
    }
    const price = l.listing && l.listing.price
      ? { amount: l.listing.price.amount, currency: l.listing.price.currency }
      : null;
    // Diff on two bases: bare stat hash (explicit vs implicit of the same stat counts)
    // and number-normalized text (fetch returns some mod groups as plain strings with
    // no hash). A mod matches if either basis matches.
    const hashOf = (id) => (id ? String(id).split('.').pop() : null);
    // Over/under vs MY item, faithful by construction: a LINE delta appears
    // only when the stat is one real line on BOTH items (same section bucket,
    // same stat) - never a merged or summed number. Merged/multi-line stats
    // (96% + hybrid 35% increased ES lives as one value-131 row on my side)
    // simply carry no per-line figure; the defence TOTALS in "Vs your item"
    // cover the aggregate. Sign: positive/green = mine ahead.
    if (myIds && myIds.lines) {
      const theirGroups = new Map(); // my group -> their matching lines
      for (const sec of secs) {
        for (const line of sec.lines) {
          const bare = hashOf(line.id);
          if (!bare) continue;
          const nums = String(line.text).match(/-?\d+(?:\.\d+)?/g);
          if (!nums || nums.length !== 1) continue;
          const grp = myIds.lines.get(`${sec.key}|${bare}`);
          if (!grp) continue;
          let num = Number(nums[0]);
          if (!Number.isFinite(num)) continue;
          // polarity: listing text spells negatives in words ("28% reduced X")
          // while my roll sits on the canonical increased-axis as a negative
          if (num > 0 && grp.sum < 0 && /\b(reduced|less)\b/i.test(line.text)) num = -num;
          if (!theirGroups.has(grp)) theirGroups.set(grp, []);
          theirGroups.get(grp).push({ line, num });
        }
      }
      for (const [grp, arr] of theirGroups) {
        if (grp.n === 1 && !grp.merged && arr.length === 1) {
          const d = Math.round((grp.sum - arr[0].num) * 10) / 10;
          arr[0].line.delta = d === 0 ? null : d; // equal lines stay quiet
        }
      }
    }
    const listingHashes = new Set(mods.map((m) => hashOf(m.id)).filter(Boolean));
    const listingNorms = new Set(mods.map((m) => normText(m.text)));
    const isMatch = (m) => !!(myIds && ((m.id && myIds.allHashes.has(hashOf(m.id))) || myIds.allNorms.has(normText(m.text))));
    // GGG-computed headline stats (weapon DPS, defences) for the peek header
    const extRaw = item.extended || {};
    const ext = {};
    for (const k of ['dps', 'pdps', 'edps', 'ar', 'ev', 'es', 'ward', 'block', 'spirit']) {
      if (typeof extRaw[k] === 'number' && extRaw[k] > 0) ext[k] = Math.round(extRaw[k]);
    }
    // Comparability totals vs my item. Only surfaced for a dimension my search
    // actually uses (ref.* set): a res total on a res search, a damage total when
    // I have fungible damage, sockets when either side has them. delta = mine -
    // theirs, same sign convention as the line deltas (green = mine ahead).
    const cmp = (mine, theirs) => {
      if (theirs == null) return null;
      const d = mine == null ? null : Math.round((mine - theirs) * 10) / 10;
      return { val: theirs, delta: d === 0 ? null : d };
    };
    // Quality rides in `properties`, and on jewellery it names the catalyst
    // ("Quality (Cold Modifiers): +40%") - which decides how much its mods are
    // boosted, so a comp's quality is part of reading its rolls, not trivia.
    let quality = null;
    for (const p of item.properties || []) {
      if (!/^Quality/.test(p.name || '')) continue;
      const val = p.values && p.values[0] && p.values[0][0];
      if (!val) continue;
      const kind = /\(([^)]+)\)/.exec(p.name);
      quality = { val, kind: kind ? kind[1] : null };
      break;
    }
    // total defences (GGG's own computed numbers, quality included): the comp's
    // ES/Armour/Evasion/Ward against my item's property values
    const myProps = (myIds && myIds.props) || {};
    const dcmp = (k) => (ext[k] != null ? cmp(myProps[k] != null ? myProps[k] : null, ext[k]) : null);
    const totals = {
      // Item level, compared like every other dimension. It has to be computed HERE, not
      // in the peek card: peekCardHtml(l) only receives the listing, so state.item is not
      // in scope there. Same trap that erased five comparison rows in 2.6.0.
      ilvl: (item.ilvl != null && state.item && state.item.itemLevel != null)
        ? cmp(state.item.itemLevel, item.ilvl)
        : (item.ilvl != null ? { val: item.ilvl, delta: null } : null),
      // quality as a compared number (their +4% vs my +20% -> -16); catalyst
      // kind (jewellery) travels alongside for the row label
      qual: (() => {
        const myQ = state.item && state.item.quality > 0 ? state.item.quality : 0;
        const thQ = quality ? (parseFloat(String(quality.val).replace(/[+%]/g, '')) || 0) : 0;
        if (!myQ && !thQ) return null;
        return cmp(myQ, thQ);
      })(),
      qualKind: quality && quality.kind ? quality.kind.replace(/ Modifiers$/, '') : null,
      res: ref && ref.res != null ? cmp(ref.res, resTotal(mods)) : null,
      dmg: ref && ref.dmg != null ? cmp(ref.dmg, dmgTotal(mods)) : null,
      es: dcmp('es'), ar: dcmp('ar'), ev: dcmp('ev'), ward: dcmp('ward'),
      sockets: (() => {
        const n = runeSockets(item);
        if (!n) return null;
        return cmp(ref ? ref.sockets : null, n);
      })(),
    };

    // Charm base properties ("Lasts %0 Seconds", "Consumes %0 of %1 Charges on
    // use"). GGG offers no trade filter for these - the mods that drive them
    // (increased Charges, reduced Charges used, increased Duration) are the
    // searchable handles - so they surface as display facts on the comp.
    let charmLasts = null, charmConsumes = null;
    for (const p of item.properties || []) {
      const name = p.name || '';
      const vals = (p.values || []).map((v) => v && v[0]).filter((v) => v != null);
      if (/^Lasts/.test(name) && vals.length) charmLasts = vals[0];
      else if (/^Consumes/.test(name) && vals.length) charmConsumes = vals.length > 1 ? `${vals[0]} of ${vals[1]}` : vals[0];
    }
    return {
      price,
      base: item.typeLine || item.baseType || '?',
      name: item.name || '',
      icon: item.icon || null,
      ext,
      quality,
      sockets: runeSockets(item) || 0,
      charm: charmLasts || charmConsumes ? { lasts: charmLasts, consumes: charmConsumes } : null,
      // kept so the row can show it when ilvl IS the price (Wombgifts): without it you
      // cannot tell whether the comps you are being priced against are your level
      ilvl: item.ilvl != null ? item.ilvl : null,
      indexed: (l.listing && l.listing.indexed) || null,
      whisper: (l.listing && l.listing.whisper) || null,
      // item-level status the game shows as banners. GGG only sends each field
      // when true, so absent ones are simply omitted. Unrevealed desecrated is a
      // hidden line the buyer reveals at the Well of Souls.
      flags: (() => {
        // confirmed against real listings: corrupted + desecrated are booleans;
        // fractured has no top-level flag (the fractured scope is the signal).
        // duplicated(mirrored)/split/sanctified/unmodifiable are the standard trade
        // shape but unconfirmed in PoE2 data - kept as harmless no-ops until seen.
        const STATUS = [['corrupted', t('itemtab.property.status_corrupted')], ['desecrated', t('itemtab.property.status_desecrated')], ['duplicated', t('itemtab.property.status_mirrored')], ['split', t('itemtab.property.status_split')], ['sanctified', t('itemtab.property.status_sanctified')], ['unmodifiable', t('itemtab.property.status_unmodifiable')]];
        const f = STATUS.filter(([k]) => item[k]).map(([, lab]) => lab);
        const eh = (item.extended && item.extended.hashes) || {};
        if ((eh.fractured || []).length) f.push(t('itemtab.property.status_fractured'));
        // `identified` is the one status sent as FALSE rather than omitted-unless-true.
        // Without it an unidentified search returned rows that looked like ordinary
        // items, with nothing saying the whole comp set is unidentified.
        if (item.identified === false) f.push(t('itemtab.property.status_unidentified'));
        return f;
      })(),
      totals, // res / dmg / sockets, each { val, delta } or null - peek card

      // `kind` MUST survive this projection - it is what styles desecrated /
      // crafted / fractured lines in the peek card. It was computed correctly
      // and then dropped here, so every special mod rendered as plain text.
      mods: mods.map((m) => ({ text: m.text, match: isMatch(m), kind: m.kind || null, delta: m.delta })),
      secs: secs.map((s) => ({ key: s.key, lines: s.lines.map((m) => ({ text: m.text, match: isMatch(m), kind: m.kind || null, delta: m.delta })) })),
      // only STRICT mods can be "lacking" - pseudo/fungible members are allowed to be
      // absent by design (that is what fungible means)
      missing: myIds
        ? myIds.strict.filter((s) => !listingHashes.has(s.hash) && !listingNorms.has(s.norm)).map((s) => s.text)
        : [],
      profile,
    };
  }
  const normText = (s) => String(s || '').replace(/[+-]?\d+(?:\.\d+)?/g, '#').trim().toLowerCase();

  // Accumulate per-stat roll bounds from fetched listings' tier magnitudes - these feed
  // the slider ranges, widening organically with every search. Keyed per item CATEGORY:
  // the same stat rolls very differently across classes (staff spell damage ~200%,
  // amulet ~30%) and must never pollute another class's slider.
  let rangesDirty = false;
  function learnRanges(rawListings) {
    const cat = (state.item && state.item.category) || '?';
    for (const l of rawListings || []) {
      const item = (l && l.item) || {};
      for (const m of [].concat(item.implicitMods || [], item.explicitMods || [], item.runeMods || [])) {
        if (typeof m !== 'object' || !m.hash) continue;
        const id = cat + '|' + String(m.hash).replace(/^stat\./, '');
        for (const sub of m.mods || []) {
          for (const mag of sub.magnitudes || []) {
            const lo = parseFloat(mag.min), hi = parseFloat(mag.max);
            if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
            const r = state.ranges[id] || (state.ranges[id] = { min: lo, max: hi });
            if (lo < r.min) { r.min = lo; rangesDirty = true; }
            if (hi > r.max) { r.max = hi; rangesDirty = true; }
            if (r.min === lo && r.max === hi) rangesDirty = true; // first sighting
          }
        }
      }
    }
    if (rangesDirty) { rangesDirty = false; window.api.setItemRanges(state.ranges); }
  }

  // Slider bounds - the REAL roll range per mod per item type:
  //  - uniques: the advanced copy's (min-max) IS the unique's full range - clamp
  //    exactly to it, never widen.
  //  - rares: mod-ranges.json (generated from the full mod database) spans the
  //    lowest tier's min to the highest tier's max for this item category.
  //  - fallback (table miss): tier bounds widened by roll*0.55..*1.45, unioned
  //    with ranges learned from fetched listings.
  let modRanges = null; // "<category>|<hash>" -> [lo, hi]
  fetch('item/mod-ranges.json').then((r) => r.json()).then((j) => {
    modRanges = j;
    if (state.item) render(); // re-decorate if an item beat the table load
  }).catch(() => {});

  function decorateSliderBounds(mods) {
    const isUnique = state.item && state.item.rarity === 'Unique';
    const cat = (state.item && state.item.category) || '?';
    for (const m of mods) {
      if (m.value == null) { m.sliderMin = m.sliderMax = null; continue; }
      // exact counts (socket count, waystone tier, tablet uses remaining) are not
      // rolls - a slider that fuzzes them to value*0.55..1.45 is meaningless, so
      // they get an input only, no slider.
      if (m.exact) { m.sliderMin = m.sliderMax = null; continue; }
      const isInt = Number.isInteger(m.value) && (m.min == null || Number.isInteger(m.min));
      const rnd = (v) => (isInt ? Math.round(v) : Math.round(v * 10) / 10);
      let lo, hi;
      if (isUnique) {
        // A unique rolls only what IT can roll - no mod-range table applies, and
        // inventing one from the roll would lie. Advanced copy: clamp exactly to
        // the printed range. Simple copy (no printed ranges): no slider at all.
        if (m.rangesKnown === false || m.min == null || m.max == null) { m.sliderMin = m.sliderMax = null; continue; }
        lo = Math.min(m.min, m.value);
        hi = Math.max(m.max, m.value);
      } else {
        const table = !isUnique && !m.prop && m.id && modRanges && modRanges[cat + '|' + m.id.split('.').pop()];
        if (table) {
          // the mod's OWN printed range is ground truth for what it can roll, so it has
          // to be inside the track even when the table disagrees. The table aggregates
          // the tiers we know about, and a low tier can sit under its floor - a 10-15
          // crafted Spirit roll against a [36,60] table used to clamp the slider to the
          // roll itself, so you could not drag below the value you already had.
          lo = Math.min(table[0], m.value, m.min != null ? m.min : Infinity);
          hi = Math.max(table[1], m.value, m.max != null ? m.max : -Infinity);
        } else {
          lo = Math.min(m.min != null ? m.min : m.value, rnd(m.value * 0.55));
          hi = Math.max(m.max != null ? m.max : m.value, rnd(m.value * 1.45));
          const learned = m.id && state.ranges[cat + '|' + m.id];
          if (learned) { lo = Math.min(lo, learned.min); hi = Math.max(hi, learned.max); }
        }
      }
      if (hi > lo) {
        m.sliderMin = lo;
        m.sliderMax = hi;
        m.sliderStep = isInt ? 1 : 0.1;
      } else {
        m.sliderMin = m.sliderMax = null;
      }
    }
  }

  // ---- suggested floor -----------------------------------------------------
  const PROP_EXT = { es: 'es', ar: 'ar', ev: 'ev', ward: 'ward', dps: 'dps', pdps: 'pdps', edps: 'edps', spirit: 'spirit', block: 'block' };
  const roundAmt = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

  // WEAPONS price on total DPS, and steeply: a +30% DPS bow is worth ~2x, not
  // +30%. So a weapon's floor is the best DPS-per-divine deal on the board,
  // scaled to the item's own DPS -   floor = min over comps of
  // price_i * (myDPS / compDPS_i)^E   (E~2.5 -> +30% DPS ~ +90% price). The
  // cheapest strong-DPS comp binds; a junk-DPS cheap listing can't drag it down
  // (its (myDPS/lowDPS)^E term balloons, so it never wins the min).
  const WEAPON_DPS_E = 2.5;

  // Non-weapon similarity fit over the priced dimensions (defences, res + added
  // damage totals, sockets). gap SIGNED (+ = the comp beats me), dist unsigned.
  // Missing-mod differences are a LIGHT nudge only - never enough to flip a
  // clearly-stronger cheap comp into looking "worse". null = nothing measurable.
  function compFit(l, ref) {
    const dims = [];
    for (const m of state.item.mods) {
      if (!m.prop || !m.id || m.mode === 'off' || m.value == null) continue;
      const key = PROP_EXT[String(m.id).replace('prop.', '')];
      if (!key || !(l.ext && l.ext[key] > 0)) continue;
      dims.push({ mine: m.value, theirs: l.ext[key], w: 1 });
    }
    if (ref && ref.res != null && l.totals && l.totals.res && l.totals.res.val != null) dims.push({ mine: ref.res, theirs: l.totals.res.val, w: 1 });
    if (ref && ref.dmg != null && l.totals && l.totals.dmg && l.totals.dmg.val != null) dims.push({ mine: ref.dmg, theirs: l.totals.dmg.val, w: 0.8 });
    if (ref && ref.sockets != null && l.totals && l.totals.sockets && l.totals.sockets.val != null) {
      dims.push({ rel: (l.totals.sockets.val - ref.sockets) * 0.08, w: 1 });
    }
    if (!dims.length) return null;
    let sw = 0, sGap = 0, sDist = 0;
    for (const d of dims) {
      const rel = d.rel != null ? d.rel : (d.theirs - d.mine) / Math.max(Math.abs(d.mine), 1e-6);
      sw += d.w; sGap += rel * d.w; sDist += Math.abs(rel) * d.w;
    }
    // missing mods: a small nudge (0.04 each, capped), not a power flip
    const miss = Math.min(3, (l.missing || []).length);
    return { gap: sGap / sw - 0.04 * miss, dist: sDist / sw + 0.04 * miss };
  }

  const NUDGE_CAP = 0.10;  // how far the better/worse nudge moves off an anchor
  const myDpsTotal = () => {
    const m = state.item.mods.find((x) => x.id === 'prop.dps' && x.value > 0);
    return m ? m.value : null;
  };

  function suggestFloor(listings, ref, status) {
    const priced = listings.filter((l) => l.price && l.price.amount != null);
    if (!priced.length) return null;
    const cur = priced[0].price.currency;
    const same = priced.filter((l) => l.price.currency === cur);

    // --- weapon path: DPS elasticity ---
    const myDPS = myDpsTotal();
    if (myDPS != null) {
      const cand = same.filter((l) => l.ext && l.ext.dps > 0);
      if (cand.length) {
        let best = null;
        for (const l of cand) {
          const implied = l.price.amount * Math.pow(myDPS / l.ext.dps, WEAPON_DPS_E);
          if (!best || implied < best.implied) best = { implied, l };
        }
        const b = best.l;
        return {
          amount: roundAmt(best.implied), currency: cur,
          why: { mode: 'weapon-dps', anchorL: b, anchorAmt: b.price.amount,
                 myDPS: Math.round(myDPS), theirDPS: Math.round(b.ext.dps), cur },
        };
      }
    }

    // --- non-weapon path: cheapest comp that beats/matches me caps the price ---
    const scored = same.map((l) => ({ l, amount: l.price.amount, fit: compFit(l, ref) })).filter((s) => s.fit);
    if (scored.length) {
      const EPS = 0.03; // within 3% aggregate = "basically the same item"
      const betterEq = scored.filter((s) => s.fit.gap >= -EPS).sort((a, b) => a.amount - b.amount);
      const worse = scored.filter((s) => s.fit.gap < -EPS).sort((a, b) => b.amount - a.amount);
      const ceil = betterEq[0];          // cheapest comp >= me -> my hard ceiling
      const supp = worse[0];             // priciest comp I beat -> floor support
      if (ceil && supp && ceil.amount > supp.amount) {
        // I sit between: interpolate by where my power lands between the two
        const gA = ceil.fit.gap, gB = Math.abs(supp.fit.gap);
        const t = gB / ((gB + Math.max(gA, 0)) || 1);
        const amt = supp.amount + t * (ceil.amount - supp.amount);
        return { amount: roundAmt(amt), currency: cur, why: { mode: 'between', below: { amount: supp.amount, gap: supp.fit.gap }, above: { amount: ceil.amount, gap: ceil.fit.gap }, anchorL: ceil.l } };
      }
      if (ceil) {
        // everything (that I match/trail) beats me, or a better comp is the
        // cheapest on the board -> price just under the cheapest better comp
        const edge = Math.min(NUDGE_CAP, Math.max(0, ceil.fit.gap));
        return { amount: roundAmt(ceil.amount * (1 - edge)), currency: cur, why: { mode: 'below-best', above: { amount: ceil.amount, gap: ceil.fit.gap }, anchorL: ceil.l } };
      }
      if (supp) {
        // I beat everything listed -> price just over the priciest comp I beat
        const edge = Math.min(NUDGE_CAP, Math.abs(supp.fit.gap));
        return { amount: roundAmt(supp.amount * (1 + edge)), currency: cur, why: { mode: 'above-worst', below: { amount: supp.amount, gap: supp.fit.gap }, anchorL: supp.l } };
      }
    }
    // nothing measurable: median of the 3 cheapest (the old behavior)
    const amounts = same.map((l) => l.price.amount).slice(0, 3);
    return { amount: amounts[Math.floor((amounts.length - 1) / 2)], currency: cur, why: { mode: 'median' } };
  }

  // ---------- rendering ----------
  // The item-level and quality search ranges default to the CURRENT item's own
  // values (as the min, with no max) and re-default whenever a new item is
  // adopted - keyed on item identity so every load path resets them without
  // extra wiring. Neither is ever lowered by the stat-range %.
  function syncIlvl() {
    if (state._ilvlFor !== state.item) {
      state._ilvlFor = state.item;
      state.ilvlMin = state.item && state.item.itemLevel != null ? state.item.itemLevel : null;
      // exact-level items (Wombgifts) pin BOTH ends; everything else keeps ilvl as a floor
      state.ilvlMax = (state.item && state.item.exactLevel && state.item.itemLevel != null)
        ? state.item.itemLevel : null;
      state.qualMin = state.item && state.item.quality > 0 ? state.item.quality : null;
      state.qualMax = null;
      state.sockMin = state.item && state.item.sockets > 0 ? state.item.sockets : null;
      state.sockMax = null;
      // Gem level defaults to EXACT (min = max = the gem's level), unlike item
      // level. Gem prices step hard per level, so a "20+" search on a level 18 gem
      // would price it off level 20 comps - the floor would be a fantasy.
      const gl = state.item && state.item.gemLevel != null ? state.item.gemLevel : null;
      state.gemLvlMin = gl;
      state.gemLvlMax = gl;
    }
  }

  // Exceptional Normal bases (clean crafting bases) start with filled-rune OFF,
  // quality-20 ON, and the Corrupted filter set to No - matching the game's own
  // base search. The assume side lives in state.excAssume (per-item, never touches
  // the global pref); corrupted rides state.opts.misc but is auto-seed-marked so it
  // is cleared again when a non-exceptional item is next adopted (no leak) and is
  // left alone the moment the user picks a Corrupted value themselves.
  function applyExceptionalDefaults() {
    const misc = { ...(state.opts.misc || {}) };
    if (state.item && state.item.exceptionalBase) {
      state.excAssume = { q20: true, fillRunes: false };
      if (!misc.corrupted || state.autoCorrupted) { misc.corrupted = 'false'; state.autoCorrupted = true; }
    } else {
      state.excAssume = null;
      if (state.autoCorrupted) { delete misc.corrupted; state.autoCorrupted = false; }
    }
    // An unidentified item searches unidentified comps - but that has to be VISIBLE in the
    // Misc panel, not applied behind the query builder's back. The dropdown said "Any"
    // while the search sent "No", which is the app lying about what it just did. Seeded
    // like corrupted: shown as No, yours the moment you touch it, cleared on a normal item.
    if (state.item && state.item.isUnidentified) {
      if (!misc.identified || state.autoIdentified) { misc.identified = 'false'; state.autoIdentified = true; }
    } else if (state.autoIdentified) {
      delete misc.identified; state.autoIdentified = false;
    }
    state.opts.misc = misc;
  }

  // A text input's change event fires on BLUR, so clicking Search straight out of
  // the gem-level (or ilvl / quality / mod-min) box rebuilt this whole panel between
  // mousedown and mouseup: the button the click was headed for no longer existed, and
  // the user had to click twice. So while a pointer is held down, a render is held
  // back and applied the moment the click has been delivered.
  let pointerHeld = false;
  let renderHeld = false;
  const releaseRender = () => {
    pointerHeld = false;
    if (renderHeld) { renderHeld = false; render(); }
  };
  // Only the blur case is held: a field is being edited and the pointer went down
  // somewhere else. Dragging a slider (or clicking inside the field you're already
  // in) still re-renders live, which is what keeps the slider and its number box in
  // lockstep.
  document.addEventListener('pointerdown', (e) => {
    const a = document.activeElement;
    const editing = !!(a && /^(?:INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
    pointerHeld = editing && a !== e.target && !a.contains(e.target);
  }, true);
  document.addEventListener('click', releaseRender); // bubble phase: after the target's own handler ran
  document.addEventListener('pointercancel', releaseRender, true);
  // a pointerup that never becomes a click (dragged off the target, released on
  // dead space) must still let the held render through
  document.addEventListener('pointerup', () => { setTimeout(releaseRender, 80); }, true);

  function render() {
    const root = $('item-root');
    if (!root) return;
    if (pointerHeld) { renderHeld = true; return; }
    if (state.item && state.item.currencyTag) { renderCurrency(root); return; }
    if (state.item) { decorateSliderBounds(state.item.mods); syncIlvl(); }
    window.ItemUI.render(root, state, handlers);
  }

  // canned sample for the "See an example" button on the empty landing - a
  // near-perfect desecrated ring, so the sample also surfaces the redesecrate?
  // corner and gives the Desecrate tab something real. Twin of tutorial.js's
  // TUT_DEMO_ITEM; keep them in sync if either changes.
  const SAMPLE_TEXT = [
    'Item Class: Rings', 'Rarity: Rare', 'Sovereign Whorl', 'Sapphire Ring', '--------',
    'Requirements:', 'Level: 78', '--------', 'Item Level: 82', '--------',
    '{ Prefix Modifier "Virtuoso\'s" (Tier: 1) — Life }', '+112(105-119) to maximum Life',
    '{ Prefix Modifier "Archmage\'s" (Tier: 1) — Mana }', '+69(64-70) to maximum Mana',
    '{ Suffix Modifier "of the Volcano" (Tier: 1) — Elemental, Fire, Resistance }', '+45(43-46)% to Fire Resistance',
    '{ Suffix Modifier "of the Tundra" (Tier: 1) — Elemental, Cold, Resistance }', '+44(43-46)% to Cold Resistance',
    '{ Desecrated Suffix Modifier "of Ulaman" (Tier: 1) — Elemental, Lightning, Chaos, Resistance }', '+16(13-17)% to Lightning and Chaos Resistances',
  ].join('\n');

  const handlers = {
    onModeToggle(i) {
      const m = state.item.mods[i];
      if (!m.id) return; // unsearchable mods stay off
      const canPseudo = !!(m.damage && m.form === 'flat');
      const cycle = canPseudo ? ['pseudo', 'strict', 'off'] : ['strict', 'off'];
      m.mode = cycle[(cycle.indexOf(m.mode) + 1) % cycle.length];
      markStale();
    },
    onValueChange(i, v) {
      const n = parseFloat(v);
      state.item.mods[i].searchMin = Number.isFinite(n) ? n : null;
      markStale(); // also keeps the input and slider in lockstep
    },
    onMaxChange(i, v) {
      const n = parseFloat(v);
      state.item.mods[i].searchMax = Number.isFinite(n) ? n : null;
      markStale();
    },
    onRerender() { render(); }, // fold accordions toggle without re-searching
    onMisc(key, value) {
      // once the user picks a Corrupted value, it is theirs - stop auto-managing it
      if (key === 'corrupted') state.autoCorrupted = false;
      if (key === 'identified') state.autoIdentified = false;
      state.opts.misc = { ...(state.opts.misc || {}) };
      // Keep the key on "Any" ('') rather than deleting it. Deleting made an explicit Any
      // indistinguishable from never-touched, so a filter the app seeds itself (identified
      // on an unidentified item) silently re-applied the moment you chose Any.
      state.opts.misc[key] = value || '';
      markStale();
    },
    // live q20 / filled-rune assumption toggle: recompute THIS item and re-search,
    // and remember the choice as the default for the next paste
    onAssume(key, val) {
      // Exceptional Normal base: the toggle is a per-item override only - it must
      // never rewrite the user's global assume pref (that would leak q20/rune
      // assumptions onto every future rare/unique).
      if (state.item && state.item.exceptionalBase) {
        state.excAssume = { ...(state.excAssume || { q20: true, fillRunes: false }), [key]: !!val };
        reapplyAssume();
        return;
      }
      state.assume = { ...state.assume, [key]: !!val };
      if (window.api.setItemSearchOpts) {
        window.api.setItemSearchOpts({ q20: state.assume.q20, fillRunes: state.assume.fillRunes, sliders: state.showSliders }).catch(() => {});
      }
      reapplyAssume();
    },
    // one-click minimum presets. These WRITE searchMin on every row (the inputs
    // and sliders visibly move) rather than flipping a mode that recomputes
    // behind the scenes - what you see is what gets searched.
    onSetMins(which) {
      if (!state.item) return;
      if (which === 'reset') {
        state.item = JSON.parse(JSON.stringify(state.itemOriginal || state.item));
        state.openFolds = new Set();
      } else {
        for (const m of state.item.mods) {
          if (m.mode === 'off') continue;
          if (which === 'current') {
            if (m.value != null) m.searchMin = m.value;
          } else if (m.min != null && !m.prop) {
            m.searchMin = m.min;         // tier floor; totals/tierless keep the %
          }
        }
      }
      markStale();
    },
    onDesecrate() {
      // hand the item to the Desecrate tab with its floor (in exalts) prefilled
      let currentValue = null;
      const sug = state.results && state.results.suggested;
      if (sug && sug.amount != null) {
        if (sug.currency === 'exalted') currentValue = sug.amount;
        else if (window.currencyPriceOf) {
          const r = window.currencyPriceOf(sug.currency);
          if (r > 0) currentValue = Math.round(sug.amount * r * 10) / 10;
        }
      }
      window.Desecrate.open(state.item, { currentValue });
      setTab('desec');
    },
    onOpt(key, val) {
      state.opts[key] = val;
      // the stat-range % is a preference, not per-item state - persist it so it
      // doesn't reset to the default every session
      if (key === 'defaultLowerPct' && window.api.setItemSearchOpts) {
        window.api.setItemSearchOpts({ statRange: val }).catch(() => {});
      }
      // listing-age window is a standing preference too, not per-item state
      if (key === 'indexed' && window.api.setItemSearchOpts) {
        window.api.setItemSearchOpts({ indexed: val }).catch(() => {});
      }
      markStale();
    },
    // item-level search range (min/max). null clears that bound. Kept on state so
    // syncIlvl re-defaults it to the item's own level when a new item is adopted.
    onIlvl(which, raw) {
      const s = String(raw == null ? '' : raw).trim();
      const n = s === '' ? null : parseInt(s, 10);
      const val = (n != null && Number.isFinite(n)) ? Math.max(1, Math.min(100, n)) : null;
      if (which === 'min') state.ilvlMin = val; else state.ilvlMax = val;
      markStale();
    },
    // quality search range - same contract as onIlvl (null clears; re-defaults to
    // the item's own quality per item via syncIlvl)
    onQual(which, raw) {
      const s = String(raw == null ? '' : raw).trim();
      const n = s === '' ? null : parseInt(s, 10);
      const val = (n != null && Number.isFinite(n)) ? Math.max(0, Math.min(100, n)) : null;
      if (which === 'min') state.qualMin = val; else state.qualMax = val;
      markStale();
    },
    // gem-level search range - same contract; both bounds re-default to the gem's
    // own level (exact) per item
    onGemLvl(which, raw) {
      const s = String(raw == null ? '' : raw).trim();
      const n = s === '' ? null : parseInt(s, 10);
      const val = (n != null && Number.isFinite(n)) ? Math.max(1, Math.min(40, n)) : null;
      if (which === 'min') state.gemLvlMin = val; else state.gemLvlMax = val;
      markStale();
    },
    // augmentable-socket search range - same contract; min re-defaults to the
    // item's own socket count per item
    onSock(which, raw) {
      const s = String(raw == null ? '' : raw).trim();
      const n = s === '' ? null : parseInt(s, 10);
      const val = (n != null && Number.isFinite(n)) ? Math.max(0, Math.min(10, n)) : null;
      if (which === 'min') state.sockMin = val; else state.sockMax = val;
      markStale();
    },
    async onWhisper(l) {
      if (!l.whisper) return;
      await window.api.writeClipboard(l.whisper);
      const shown = t('itemtab.notice.whisper_copied');
      state.notice = shown;
      render();
      // compare against the string we actually set, not an English prefix: the old
      // startsWith('Whisper copied') check silently stopped clearing the notice the
      // moment the UI wasn't English
      setTimeout(() => { if (state.notice === shown) { state.notice = null; render(); } }, 3500);
    },
    onSearch: doSearch,
    onAddMod() {
      window.ItemUI.showPicker({
        title: t('itemtab.search.add_mod_title'),
        placeholder: t('itemtab.search.add_mod_placeholder'),
        scopes: [...PICKER_SCOPES, ...SPECIAL_SCOPES],
        query: (q, scope) => filterStats(q, new Set(state.item.mods.map((m) => (m.option != null ? `${m.id}|${m.option}` : m.id))), scope || 'explicit'),
        onPick(e) {
          if (state.item.mods.some((m) => m.id === e.id && m.option === (e.option != null ? e.option : undefined))) return;
          state.item.mods.push({
            id: e.id, kind: e.scope || 'explicit', ref: e.ref, text: e.text,
            // option stats ride their choice in the id (id|value) - without this every
            // Legacy searched as the same one
            ...(e.option != null ? { option: e.option } : {}),
            value: null, min: null, max: null, tier: null, searchMin: null,
            // an added mod has no roll of its own to lower, so its min is typed
            // rather than derived: blank = "just has to be present"
            searchMax: null, editableMin: true,
            mode: 'strict', damage: null, form: null, weight: null,
            group: null, added: true, altIds: e.altIds || [],
          });
          render();
        },
        onClose() { markStale(); },
      });
    },
    onModMenu(i, ev) {
      const m = state.item.mods[i];
      if (m.prop) return; // properties have no garbage/fungible actions
      const inGarbage = m.id && state.garbage.includes(m.id);
      window.ItemUI.showMenu(ev, [
        m.id && { label: t('itemtab.search.menu_make_fungible'), fn: () => openFungiblePicker(i) },
        m.group && { label: t('itemtab.search.menu_remove_fungible_group'), fn: () => ungroup(i) },
        m.added && !m.group && { label: t('itemtab.search.menu_remove_mod'), fn: () => { state.item.mods.splice(i, 1); markStale(); } },
        m.id && !inGarbage && { label: t('itemtab.search.menu_add_garbage'), fn: () => addGarbage(i) },
        m.id && inGarbage && { label: t('itemtab.search.menu_remove_garbage'), fn: () => removeGarbage(m.id) },
      ]);
    },
    async onLogin() {
      await window.api.poeLogin();
      const league = await resolveLeague();
      state.authed = await window.api.trade2AuthCheck(league, true);
      state.loginHint = !state.authed;
      state.notice = state.authed ? t('itemtab.notice.login_success') : t('itemtab.notice.login_still_out');
      render();
      if (state.authed && state.item) doSearch();
    },
    onHistoryOpen(i) {
      const rec = state.history[i];
      if (!rec) return;
      // currency entry: restore the exchange-value view and re-fetch a live price
      if (rec.currency && rec.model && rec.model.currencyTag) {
        state.item = rec.model;
        state.currencyResult = null;
        state.results = null;
        state.searchCtx = null;
        state.view = 'item';
        state.stale = false;
        state.notice = null;
        render();
        doCurrencyPrice();
        return;
      }
      backfillModel(rec.model); // older saves lack icon/sockets - derive them
      // A restored search runs as a DEFAULT search: stamped per-mod minimums
      // ("set mins" tier-floor/exact-roll stamps, typed mins) don't survive the
      // trip - otherwise the stat-range % is silently ignored on cached items.
      // Props keep their flags (sockets are exact-by-design).
      for (const m of rec.model.mods || []) {
        if (m.prop) continue;
        m.searchMin = null;
        if (m.exact) m.exact = false;
      }
      state.item = rec.model;
      state.itemOriginal = JSON.parse(JSON.stringify(rec.model)); // reset -> as restored
      state.opts = { ...state.opts, ...rec.opts };
      state.searchCtx = null; // cached restore has no live query to page; Search re-runs it
      // keep the Exceptional-base override state consistent with the restored item
      state.excAssume = rec.model.exceptionalBase ? { q20: true, fillRunes: false } : null;
      state.autoCorrupted = !!(rec.model.exceptionalBase && (state.opts.misc || {}).corrupted === 'false');
      state.stale = false;
      state.view = 'item';
      if (rec.cachedRaw && rec.cachedRaw.raw) {
        // rebuild presentation from the raw cache - always current format
        state.results = buildResults(rec.cachedRaw.raw, rec.cachedRaw.total);
        // backfill the suggested floor for rows saved before it was cached, so
        // the Recent-searches row reads at a glance next time
        if (rec.floor == null && state.results && state.results.suggested) {
          rec.floor = state.results.suggested;
          window.api.setItemHistory(state.history);
        }
        state.notice = t('itemtab.history.cached_result', { age: ageStr(rec.ts) });
      } else {
        // pre-raw-cache history entry: its snapshot is stale-formatted, don't show it
        state.results = null;
        state.notice = rec.cached ? t('itemtab.history.stale_format_notice') : null;
      }
      render();
    },
    onBack() {
      state.view = 'empty';
      state.item = null;
      state.results = null;
      state.searchCtx = null;
      state.histShown = 10; // reset Recent-searches paging when returning to the landing
      state.notice = null;
      render();
    },
    onLoadMore() { loadMoreResults(); },
    onHistoryMore() { state.histShown = (state.histShown || 10) + 10; render(); },
    // "See an example" on the empty landing: load the sample ring as a normal
    // item (local synth comps, no API), decoupled from the tutorial demo path
    // Price check something the clipboard cannot reach - runestones and Verisium gems
    // in the rune-combination dialogue, Ritual remnant choices. There is no item text to
    // parse, so this builds the minimum model a search needs: an identity and no mods.
    // Uniques search by NAME, everything else by TYPE, which is the same split
    // compileQuery already makes for parsed items.
    async onNameSearch() {
      // the parser data can still be cold if no item has been price checked yet
      try { await ensureInit(''); } catch { /* picker shows its own empty state */ }
      showItemNamePicker((hit) => applyNamePick(hit));
    },

    // Click the item name on the search screen to retype it - same picker, same rules.
    // Escape closes without picking, so the name stays put.
    // The player told us which unique their unidentified item actually is (or cleared it
    // back to "any"). Only the searched NAME changes; it stays unidentified either way.
    async onPickUnid(cand) {
      if (!state.item) return;
      state.item.name = cand ? cand.refName : null;
      if (cand && cand.icon) state.item.icon = cand.icon;
      state.notice = null;
      state.stale = false;
      state.results = null;
      render();
      await doSearch();
    },

    async onRename() {
      if (!state.item) return;
      try { await ensureInit(''); } catch { /* picker shows its own empty state */ }
      showItemNamePicker((hit) => applyNamePick(hit), state.item.title || state.item.base);
    },
    async onLoadSample() {
      const model = await modelFromText(SAMPLE_TEXT);
      if (!model) return;
      state.item = model;
      state.itemOriginal = JSON.parse(JSON.stringify(model));
      state.notice = t('itemtab.notice.sample_item_loaded');
      state.stale = false;
      state.view = 'item';
      try { state.results = buildResults(demoSynthListings(model), 3); } catch { state.results = null; }
      render();
    },
  };

  // ---------- mod actions ----------
  // Name picker for onNameSearch. Queries the vendored item db by NAME in the player's
  // own language, and hands back refName for the trade query. The db has to be loaded
  // first - normally the parser warms it up on the first item, and here there may not
  // have been one yet.
  // Base categories whose items roll their OWN random mods, from the vendored item db's
  // craftable.category. Anything NOT here has fixed contents (Currency, Omen, SoulCore,
  // UncutSkillGem, keys, fragments, quest items) and is treated as a clean search.
  // Listed positively rather than as an exclusion list so a category we have not seen
  // defaults to "clean search", which is the safe direction for a fixed item.
  const ROLLS_OWN_MODS = new Set([
    'Ring', 'Amulet', 'Belt', 'Talisman', 'Jewel', 'Charm', 'Flask', 'Relic',
    'Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield', 'Buckler', 'Focus', 'Quiver',
    'One Hand Mace', 'Two Hand Mace', 'One Hand Axe', 'Two Hand Axe',
    'One Hand Sword', 'Two Hand Sword', 'Dagger', 'Claw', 'Flail',
    'Bow', 'Crossbow', 'Wand', 'Sceptre', 'Staff', 'Warstaff', 'Spear',
    'Map', 'TowerAugment',
  ]);

  // Both Search-by-name entry points (the history screen and clicking the item name on
  // the search screen) run THIS - same picker, same rules, so the two surfaces cannot
  // drift apart. A unique or gem has a defined mod set, so the mods on screen belong to
  // whatever was there before and get cleared. A plain base is a random rare: no
  // canonical mods to reset to, so the user's filters are left exactly as they were.
  async function applyNamePick(hit) {
    if (!hit) return;
    const isUnique = hit.namespace === 'UNIQUE';
    const isGem = hit.namespace === 'GEM';
    // A currency picked by NAME has to reach the exchange-value screen, the same one
    // Ctrl+C on that currency reaches. currencyTag was only ever set on the parse path,
    // so a typed search built a bare model, fell through to a whisper search and showed
    // no price at all. Resolve it the same way toModel does: the item db's tradeTag,
    // else the CX feed matched on display name.
    const currencyTag = (() => {
      try {
        const rec = (window.EE2.itemByRef('ITEM', hit.refName) || [])[0];
        const tag = rec && rec.tradeTag;
        if (tag && !CURRENCY_SKIP.has(tag)) return tag;
        if (!tag && !isUnique) {
          const cx = CX_BY_NAME.get(String(hit.name || '').toLowerCase());
          if (cx) return cx;
        }
      } catch { /* not a currency, fall through to the normal search */ }
      return null;
    })();
    // Keep the existing mod filters ONLY when the new pick is gear that rolls its own
    // mods - swapping one rare ring base for another, where the filters still mean
    // something. Everything with fixed contents (a Mirror, an Omen, a Soul Core, a
    // unique, a named gem) starts clean: carrying a weapon's mods onto a Mirror of
    // Kalandra would search for a currency item with weapon stats and find nothing.
    const rolls = hit.namespace === 'ITEM' && ROLLS_OWN_MODS.has(hit.category || '');
    const fresh = !rolls || !state.item;
    state.item = fresh
      ? {
          title: hit.name,
          base: hit.name,
          // trade indexes in English, so the identity sent is always refName - the
          // localised name is display only
          name: isUnique ? hit.refName : null,
          type: isUnique ? null : hit.refName,
          icon: hit.icon || null,
          rarity: isUnique ? 'Unique' : null,
          mods: [], props: [],
          itemLevel: null, isGem, gemLevel: null,
          currencyTag,
          currencyName: hit.name || hit.refName || null,
          currencyIcon: hit.icon || null,
          nameOnly: true, // marks a model with no parsed item behind it
        }
      : {
          ...state.item,
          title: hit.name,
          base: hit.name,
          name: null,
          type: hit.refName,
          icon: hit.icon || state.item.icon || null,
        };
    if (fresh) {
      state.itemOriginal = JSON.parse(JSON.stringify(state.item));
      state.ilvlMin = null; state.ilvlMax = null;
      state.qualMin = null; state.qualMax = null;
      state.sockMin = null; state.sockMax = null;
      state.gemLvlMin = null; state.gemLvlMax = null;
    }
    state.notice = null;
    state.stale = false;
    state.view = 'item';
    state.results = null;
    render();
    await doSearch();
  }

  function showItemNamePicker(onPick, seed) {
    const NS_LABEL = {
      UNIQUE: t('itemtab.namesearch.ns_unique'),
      GEM: t('itemtab.namesearch.ns_gem'),
      ITEM: t('itemtab.namesearch.ns_item'),
    };
    const query = (q) => {
      if (!window.EE2 || !window.EE2.ready || !window.EE2.itemsSearch) return [];
      let hits = [];
      try { hits = window.EE2.itemsSearch(q, 40) || []; } catch { return []; }
      return hits.map((hit) => ({
        text: hit.name,
        tag: NS_LABEL[hit.namespace] || hit.namespace,
        hit,
      }));
    };
    window.ItemUI.showPicker({
      title: t('itemtab.namesearch.picker_title'),
      placeholder: t('itemtab.namesearch.picker_placeholder'),
      emptyText: t('itemtab.namesearch.no_matches'),
      value: seed || '',
      query,
      onPick: (e) => { window.ItemUI.closePicker(); onPick(e.hit); },
    });
  }

  function openFungiblePicker(i) {
    const host = state.item.mods[i];
    const groupId = host.group || (host.group = 'fg' + i);
    const pickedIds = () => new Set(state.item.mods.filter((m) => m.group === groupId).map((m) => m.id));
    window.ItemUI.showPicker({
      title: t('itemtab.search.fungible_with_title', { mod_text: host.text }),
      placeholder: t('itemtab.search.fungible_placeholder'),
      scopes: [...PICKER_SCOPES, ...SPECIAL_SCOPES],
      query: (q, scope) => filterStats(q, pickedIds(), scope || 'explicit'),
      onPick(e) {
        const existing = state.item.mods.findIndex((m) => m.group === groupId && m.id === e.id);
        if (existing !== -1) {
          if (!state.item.mods[existing].added) return; // can't remove the host this way
          state.item.mods.splice(existing, 1);
        } else {
          state.item.mods.splice(i + 1, 0, {
            id: e.id, kind: e.scope || 'explicit', ref: e.ref, text: e.text,
            value: null, min: null, max: null, tier: null, searchMin: null,
            mode: 'strict', damage: null, form: null, weight: null,
            group: groupId, added: true, altIds: e.altIds || [], editableMin: true,
          });
        }
        render();
      },
      onClose() {
        // a group of one is no group
        if (state.item.mods.filter((m) => m.group === groupId).length < 2) delete host.group;
        markStale();
      },
    });
  }
  function ungroup(i) {
    const gid = state.item.mods[i].group;
    state.item.mods = state.item.mods.filter((m) => !(m.group === gid && m.added));
    for (const m of state.item.mods) if (m.group === gid) delete m.group;
    markStale();
  }
  function addGarbage(i) {
    const m = state.item.mods[i];
    if (!state.garbage.includes(m.id)) state.garbage.push(m.id);
    window.api.setGarbagePool(state.garbage);
    m.mode = 'off'; // garbage defaults to off; the COUNT toggle re-constrains the flex slot
    m.garbage = true;
    state.notice = t('itemtab.search.garbage_added', { mod_text: m.text });
    markStale();
  }
  function removeGarbage(id) {
    state.garbage = state.garbage.filter((g) => g !== id);
    window.api.setGarbagePool(state.garbage);
    const m = state.item && state.item.mods.find((x) => x.id === id);
    if (m) m.garbage = false;
    markStale();
  }

  function ageStr(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return t('itemtab.history.age_seconds', { count: s });
    if (s < 3600) return t('itemtab.history.age_minutes', { count: Math.floor(s / 60) });
    if (s < 86400) return t('itemtab.history.age_hours', { count: Math.floor(s / 3600) });
    return t('itemtab.history.age_days', { count: Math.floor(s / 86400) });
  }

  // ---------- search ----------
  // Searches are MANUAL and deliberate - the trade API budget is tiny (5/10s, 30/5min),
  // so refinements never auto-fire. Mutations mark the current results STALE; the user
  // batches as many changes as they like, then spends exactly one search.
  function markStale() {
    if (state.results) state.stale = true;
    render();
  }

  async function resolveLeague() {
    if (state.league) return state.league;
    const cfg = await window.api.getConfig();
    if (cfg.league && cfg.league !== 'auto') { state.league = cfg.league; return state.league; }
    const leagues = await window.api.trade2Leagues();
    state.league = (leagues && leagues[0]) || 'Standard';
    return state.league;
  }

  // ---- rate-limit countdown ------------------------------------------------
  // One ticker, owned here. clearWait() must run on EVERY search exit or a
  // finished search keeps counting down under fresh results.
  let waitTimer = null;
  function clearWait() {
    if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
    state.waitUntil = null;
    state.waitBanned = false;
  }
  function setWait(until, banned) {
    state.waitUntil = until;
    state.waitBanned = !!banned;
    if (!waitTimer) {
      waitTimer = setInterval(() => {
        if (!state.searching || !state.waitUntil || Date.now() >= state.waitUntil) {
          const wasWaiting = !!state.waitUntil;
          clearWait();
          if (wasWaiting) render();
          return;
        }
        render();
      }, 1000);
    }
    render();
  }

  async function doSearch() {
    if (!state.item || state.searching) return;
    if (state.item.currencyTag) return doCurrencyPrice(); // exchange-value lookup, not a whisper search
    state.searching = true; // keep previous results visible (dimmed) while updating
    state.notice = null;
    clearWait();
    render();
    try {
      const league = await resolveLeague();
      const hasPseudo = state.item.mods.some((m) => m.mode === 'pseudo' && !m.group);
      // ONE search = ONE hit. Server-side weighted matching needs a login, but we
      // don't spend a request probing for it - the search itself is the probe.
      // Try server weighting unless we already learned we're logged out; a
      // logged-out weighted query comes back "too complex", which we catch below.
      const compileWith = (mode) => {
        state.opts.weightedMode = mode;
        const c = window.ItemQuery.compileQuery(state.item, {
          ...state.opts, ilvlMin: state.ilvlMin, ilvlMax: state.ilvlMax,
          qualMin: state.qualMin, qualMax: state.qualMax,
          sockMin: state.sockMin, sockMax: state.sockMax,
          gemLvlMin: state.gemLvlMin, gemLvlMax: state.gemLvlMax,
          garbage: state.garbage, garbageEnabled: !!state.opts.garbageOnly,
        });
        return { query: c.query, sort: c.sort };
      };
      const tryServer = hasPseudo && state.authed !== false;
      const PAGE = 10; // fetch + show 10 comps at a time; "Load more" pages the rest
      let res = await window.api.trade2SearchFetch(league, compileWith(tryServer ? 'server' : 'client'), PAGE);
      // "Query too complex / Logging in will increase this limit" == logged out.
      // Remember it (so future searches skip straight to client), fall back, retry.
      if (!res.ok && tryServer && /complex|logg?ing? ?in|log in/i.test(res.error || '')) {
        state.authed = false;
        res = await window.api.trade2SearchFetch(league, compileWith('client'), PAGE);
      } else if (tryServer && res.ok) {
        state.authed = true; // a weighted search that succeeded proves the login
      }
      state.loginHint = hasPseudo && state.authed === false;
      if (!res.ok) throw new Error(res.error);
      const d = res.data;
      const rawAll = (d.listings || []).slice();
      // keep the full id list + query id so "Load more" can fetch the next page on
      // demand (one fetch each), until the result ids run out
      state.searchCtx = { queryId: d.id, ids: d.result || [], loaded: rawAll.length, rawAll, total: d.total, page: PAGE };
      learnRanges(rawAll);
      state.results = buildResults(rawAll, d.total);
      pushHistory(rawAll, d.total);
    } catch (err) {
      state.notice = t('itemtab.search.failed', { error: err.message });
      if (window.logAction) window.logAction('item-search-error', String(err.message));
    }
    state.searching = false;
    state.stale = false; // results now reflect the current filters
    clearWait();
    render();
  }

  // "Load more results": fetch the NEXT page of listing ids for the current search
  // (one fetch call) and append them. No-op once every id has been loaded.
  async function loadMoreResults() {
    const ctx = state.searchCtx;
    if (!ctx || state.searching || ctx.loaded >= ctx.ids.length) return;
    state.searching = true;
    render();
    try {
      const next = ctx.ids.slice(ctx.loaded, ctx.loaded + ctx.page);
      const res = await window.api.trade2Fetch(next, ctx.queryId);
      if (!res.ok) throw new Error(res.error);
      ctx.rawAll.push(...(res.data || []));
      ctx.loaded += next.length;
      learnRanges(res.data || []);
      state.results = buildResults(ctx.rawAll, ctx.total);
    } catch (err) {
      state.notice = t('itemtab.search.load_more_failed', { error: err.message });
    }
    state.searching = false;
    clearWait();
    render();
  }


  // RAW listings -> displayed result groups. History caches the raw API objects and
  // re-runs this on restore, so cached results always render in the CURRENT format
  // (sections, headline stats, diff rules) instead of a stale snapshot.
  function buildResults(rawListings, total) {
    // diff basis: all active mods highlight as matches; only strict non-group mods
    // can be reported "lacking"
    const activeMods = state.item.mods.filter((m) => m.mode !== 'off' && m.id && !m.prop);
    const myIds = {
      allHashes: new Set(activeMods.map((m) => m.id.split('.').pop())),
      allNorms: new Set(activeMods.map((m) => normText(m.text))),
      // pseudo rows (total res / chaos-present) are aggregates - listings never
      // carry those stat lines, so they can't be reported "lacking". Explicit
      // res rows only enter the basis when the user deliberately re-enabled
      // them, and then per-element lacks-reporting is exactly what they want.
      strict: activeMods.filter((m) => m.mode === 'strict' && !m.group && m.kind !== 'pseudo')
        .map((m) => ({ hash: m.id.split('.').pop(), norm: normText(m.text), text: m.text })),
      // MY per-stat groups, keyed (section bucket | bare stat id). The model
      // merges same-stat lines into one row (96% + hybrid 35% increased ES is
      // stored as ONE row, value 131, text still printing "96%") - detected via
      // printed-number != value. A group is line-comparable ONLY when it is one
      // real unmerged line; merged/multi-line stats compare as TOTALS in the
      // "Vs your item" section instead - the line list never lies about a line.
      // Bucketed so a comp's rune line reads against my rune, implicit against
      // implicit. altIds alias to the SAME group so either hash lands on it.
      // my defence property values (prop.es -> 654 etc.) for the "Vs your item"
      // total-defence rows
      props: (() => {
        const p = {};
        for (const mod of state.item.mods) {
          if (mod.prop && mod.id && String(mod.id).startsWith('prop.') && mod.value != null) p[String(mod.id).slice(5)] = mod.value;
        }
        return p;
      })(),
      lines: (() => {
        const m = new Map();
        const bucketOf = (k) => (k === 'rune' || k === 'added-rune' || k === 'enchant') ? 'rune' : (k === 'implicit') ? 'implicit' : 'explicit';
        for (const mod of state.item.mods) {
          if (mod.prop || !mod.id || mod.value == null) continue;
          // scope-split twins (a desecrated/fractured line's explicit head + its
          // own-scope row) are ONE physical line - count the head only
          if (String(mod.foldGroup || '').startsWith('scope-') && mod.foldHead === false) continue;
          const b = bucketOf(mod.kind);
          const key = `${b}|${String(mod.id).split('.').pop()}`;
          const printed = parseFloat((/-?\d+(?:\.\d+)?/.exec(String(mod.text)) || [])[0]);
          const merged = Number.isFinite(printed) && Math.abs(printed - mod.value) > 0.001;
          let grp = m.get(key);
          if (!grp) {
            grp = { sum: 0, n: 0, merged: false };
            m.set(key, grp);
          }
          grp.sum += mod.value;
          grp.n += 1;
          if (merged) grp.merged = true;
          for (const alt of mod.altIds || []) {
            const ak = `${b}|${String(alt).split('.').pop()}`;
            if (!m.has(ak)) m.set(ak, grp);
          }
        }
        return m;
      })(),
    };
    const ref = myTotals();
    const listings = rawListings.map((l) => toListing(l, myIds, ref));
    const myProfile = profileOf(state.item.mods.filter((m) => m.mode !== 'off'));
    let groups;
    if (myProfile.length) {
      const highly = [], similar = [], other = [];
      for (const l of listings) {
        const c = window.ItemClassify.classify(myProfile, l.profile);
        (c === 'highly' ? highly : c === 'similar' ? similar : other).push(l);
      }
      // structurally unrelated listings still matched the search - keep them visible under Similar
      groups = { highly, similar: similar.concat(other) };
    } else {
      groups = { plain: listings };
    }
    const top = groups.highly && groups.highly.length ? groups.highly : (groups.plain || groups.similar || []);
    return { ...groups, total, suggested: suggestFloor(top, ref, state.opts.status) };
  }

  function summaryOf(model) {
    return model.mods.filter((m) => m.mode !== 'off').map((m) => m.text.replace(/^Adds /, '')).slice(0, 4).join(', ');
  }

  function pushHistory(rawListings, total) {
    const rec = {
      ts: Date.now(),
      base: state.item.title ? `${state.item.title} (${state.item.base})` : state.item.base,
      summary: summaryOf(state.item),
      icon: state.item.icon || null,
      // cache the suggested floor so the Recent-searches row reads at a glance
      // (object {amount,currency} when priced; may be a string/null otherwise)
      floor: (state.results && state.results.suggested) || null,
      model: state.item,
      opts: { defaultLowerPct: state.opts.defaultLowerPct, misc: { ...(state.opts.misc || {}) }, status: state.opts.status, indexed: state.opts.indexed },
      // cache the RAW API listings; presentation is rebuilt on restore so cached
      // results always render in the current format
      cachedRaw: { raw: rawListings.slice(0, 20), total },
    };
    // replace an earlier search of the same item (same base + same mod ids)
    const key = (r) => r.base + '|' + (r.model.mods || []).map((m) => m.id).join(',');
    state.history = [rec, ...state.history.filter((r) => key(r) !== key(rec))].slice(0, 100);
    window.api.setItemHistory(state.history);
  }

  // Currency exchange lookups share the Recent-searches list. Flagged `currency: true`
  // so onHistoryOpen restores the exchange-value view (and re-fetches a live price)
  // instead of trying to rebuild gear comps. Deduped per currency, newest first.
  function pushCurrencyHistory(it) {
    const m = state.item;
    if (!m || !m.currencyTag) return;
    const rec = {
      ts: Date.now(),
      base: m.currencyName || it.text || m.base || t('itemtab.history.currency_fallback_name'),
      summary: it && it.price > 0 ? `${fmtNum(it.price)} ${t('itemtab.currency.unit_ex')}` : t('itemtab.history.no_price_yet'),
      icon: m.currencyIcon || (it && it.icon) || null,
      model: m,
      currency: true,
    };
    const tagOf = (r) => (r.currency && r.model && r.model.currencyTag) || null;
    state.history = [rec, ...state.history.filter((r) => tagOf(r) !== m.currencyTag)].slice(0, 100);
    window.api.setItemHistory(state.history);
  }

  // ---------- clipboard ----------
  // parse clipboard text to a model without touching the Price Check state or
  // firing a search (the Desecrate tab's paste path)
  async function modelFromText(text) {
    text = String(text || '').replace(/^﻿/, '');
    if (!text || !looksLikeItem(text)) return null;
    try {
      await ensureInit(text);
      const res = window.EE2.parse(text);
      if (!res.ok) return null;
      return toModel(res.item);
    } catch { return null; }
  }

  async function tryParse(text) {
    text = String(text || '').replace(/^﻿/, ''); // BOM-proof (pasted from files/editors)
    if (!text || !looksLikeItem(text)) return false;
    let res;
    try {
      await ensureInit(text);
      res = window.EE2.parse(text);
    } catch (err) {
      res = { ok: false, error: String((err && err.message) || err) };
      console.error('item parse threw:', err);
    }
    if (!res.ok) {
      state.notice = t('itemtab.notice.parse_failed', { error: res.error });
      render();
      if (window.logAction) window.logAction('item-parse-error', String(res.error).slice(0, 200));
      return false;
    }
    state.excAssume = null; // fresh paste: drop any prior item's per-item assume override
    state.item = toModel(res.item);
    applyExceptionalDefaults(); // Exceptional Normal base: assume OFF + corrupted=No
    state.item.rawText = text; // kept so a live q20/rune-assumption toggle can recompute
    state.itemOriginal = JSON.parse(JSON.stringify(state.item)); // for the reset button
    state.openFolds = new Set();
    state.view = 'item';
    state.results = null;
    state.stale = false;
    // A fresh parse clears any prior notice. No "advanced copy" tip: the hotkey
    // copies the item for you, and there is no separate PoE2 copy format that a
    // manual copy could be "missing" - the old tip described a PoE1 distinction.
    state.notice = null;
    render();
    autoSearch(); // auto-search on paste/hotkey: one keystroke -> priced comps
    return true;
  }

  // re-derive the current item from its raw text under the live q20/rune
  // assumptions, then re-search. A toggle must change the property values and the
  // search minimums for THIS item - not just a note, and not only the next paste.
  async function reapplyAssume() {
    const text = state.item && state.item.rawText;
    if (!text) return;
    try {
      await ensureInit(text);
      const res = window.EE2.parse(text);
      if (!res.ok) return;
      const m = toModel(res.item);
      m.rawText = text;
      state.item = m;
      state.itemOriginal = JSON.parse(JSON.stringify(m));
      render();
      doSearch();
    } catch {}
  }

  // Guard against ACCIDENTAL spam - pressing Ctrl+F several times on the same
  // hovered item, or a double-fire - without ever delaying a real search. The
  // rule is dedupe, not throttle: the SAME item within a second searches once;
  // a DIFFERENT item (or the same one after a second) searches immediately. The
  // old time-based throttle rescheduled its timer on every press, so holding or
  // repeating Ctrl+F pushed the search back until you stopped - the opposite of
  // responsive. The manual Search button is never affected.
  let lastAutoAt = 0, lastAutoSig = null;
  function itemSig() {
    if (!state.item) return null;
    return state.item.base + '|' + (state.item.mods || []).map((m) => `${m.id}:${m.value}`).join(',');
  }
  function autoSearch() {
    const sig = itemSig();
    const now = Date.now();
    if (sig && sig === lastAutoSig && now - lastAutoAt < 1000) return; // same item, just searched
    lastAutoAt = now;
    lastAutoSig = sig;
    doSearch();
  }

  // CX-only currency/fragments (Raven's Reflection, pinnacle keys, ...) carry no
  // poe2scout tradeTag, so they'd fall through to a whisper search that finds
  // nothing. Their EE2 name maps to a CX apiId here, which routes them to the
  // exchange-value view (priced via the currency-exchange feed instead).
  let CX_BY_NAME = new Map(); // lowercase display name -> CX apiId
  const PARSER_LANGS = ['en', 'ru', 'pt', 'de', 'fr', 'es'];
  // Every item PoE2 copies starts with a localised "Item Class: " header, so the item
  // text states which language the CLIENT is in. That is the only thing the parser can
  // be right about: the app's own display language follows the OS locale until the user
  // picks one, and an English client on a non-English Windows is completely ordinary -
  // binding the parser to the display language meant those players got a parser that
  // could not read their items at all, so price check just stopped working for them.
  const ITEM_CLASS_HEADER = [
    ['en', 'Item Class: '], ['de', 'Gegenstandsklasse: '], ['ru', 'Класс предмета: '],
    ['fr', "Classe d'objet: "], ['es', 'Clase de objeto: '], ['pt', 'Classe do Item: '],
  ];
  // Same story for the "is this even an item?" gate: it tested for the ENGLISH headers
  // only, so a translated client's item text was thrown away before the parser saw it.
  const RARITY_HEADER = [
    ['en', 'Rarity: '], ['de', 'Seltenheit: '], ['ru', 'Редкость: '],
    ['fr', 'Rareté: '], ['es', 'Rareza: '], ['pt', 'Raridade: '],
  ];
  function parserLangFor(text) {
    const head = String(text || '').slice(0, 120);
    for (const [code, label] of ITEM_CLASS_HEADER) if (head.startsWith(label)) return code;
    for (const [code, label] of RARITY_HEADER) if (head.includes(label)) return code;
    const ui = window.I18N && window.I18N.lang();
    return PARSER_LANGS.includes(ui) ? ui : 'en'; // no header (warm-up call): best guess
  }
  function looksLikeItem(text) {
    const s = String(text || '');
    return ITEM_CLASS_HEADER.some(([, l]) => s.includes(l)) || RARITY_HEADER.some(([, l]) => s.includes(l));
  }
  let initPromise = null;
  let initLang = null;
  function ensureInit(text) {
    const lang = parserLangFor(text);
    if (!initPromise || initLang !== lang) {
      initLang = lang;
      initPromise = Promise.all([
        window.EE2.init(lang),
        Promise.resolve(window.api.getCxCatalog ? window.api.getCxCatalog() : null)
          .then((cat) => {
            if (cat && !cat.error) {
              for (const [id, info] of Object.entries(cat)) {
                if (info && info.text) CX_BY_NAME.set(info.text.toLowerCase(), id);
              }
            }
          })
          .catch(() => {}), // CX routing is a bonus; never block the parser on it
      ]).then(() => undefined);
    }
    return initPromise;
  }

  // settings-panel hooks: assumptions apply to the next item; slider visibility and
  // login state apply immediately
  let demoBackup = null; // tutorial demo state snapshot (see demoLoad/demoClear)
  function demoSnapshot() {
    if (!demoBackup) {
      demoBackup = { view: state.view, item: state.item, itemOriginal: state.itemOriginal, results: state.results, notice: state.notice, stale: state.stale, miscOpen: state.miscOpen };
    }
  }
  // build comparable listings from the demo item itself: same stat ids (so the
  // line-by-line +/- and totals compute), varied rolls and prices. Shaped like a
  // trade2 fetch result so buildResults consumes them unchanged.
  function demoSynthListings(model) {
    const explicit = (model.mods || []).filter((m) => m.id && !m.prop && m.value != null
      && ['explicit', 'desecrated', 'crafted', 'fractured'].includes(m.kind));
    const day = 86400000;
    const mk = (name, price, cur, mult, ageDays) => ({
      item: {
        name, typeLine: model.base, baseType: model.base, ilvl: model.itemLevel || 82,
        explicitMods: explicit.map((m) => ({
          description: String(m.text).replace(/-?\d+(?:\.\d+)?/, String(Math.max(1, Math.round(m.value * mult)))),
          hash: 'stat.' + m.id,
        })),
        extended: {}, sockets: [], properties: [],
      },
      listing: { price: { amount: price, currency: cur }, indexed: new Date(Date.now() - ageDays * day).toISOString() },
    });
    // divine-range: the demo item is a near-perfect ring, so its comps are too
    return [mk('Bramble Coil', 2, 'divine', 0.92, 2), mk('Dusk Signet', 4, 'divine', 1.04, 1), mk('Sovereign Band', 7, 'divine', 1.12, 5)];
  }
  window.ItemTab = {
    resolveLeague,
    // re-render from current state with no changes of its own - used when a
    // global setting the render reads (e.g. currencyIcons) flips while this
    // tab is open, since state itself didn't change.
    refresh() { render(); },
    setItemHotkey(acc) {
      state.itemHotkey = acc;
      render();
    },
    setSearchAssumptions(q20, fillRunes, sliders) {
      state.assume = { q20: !!q20, fillRunes: !!fillRunes };
      if (sliders !== undefined && state.showSliders !== !!sliders) {
        state.showSliders = !!sliders;
        render();
      }
    },
    setAuthed(authed) {
      state.authed = !!authed;
      if (authed) state.loginHint = false;
      render();
    },
    // parse the canned sample ring to a model - used by the "See a sample"
    // buttons on the Price Check and Desecrate empty states
    async sampleModel() { return modelFromText(SAMPLE_TEXT); },
    // ---- tutorial demo: load a canned item so the Price Check / Desecrate
    // spotlights have real targets (the redesecrate? button, live mod rows),
    // without touching the user's work or firing a live search. demoClear()
    // restores exactly what was on screen before.
    // show the empty paste/landing screen (the surface people actually paste
    // into), snapshotting the user's state first so demoClear can restore it
    demoEmpty() {
      demoSnapshot();
      state.item = null; state.itemOriginal = null; state.results = null;
      state.notice = null; state.stale = false; state.view = 'empty';
      render();
    },
    async demoLoad(text) {
      demoSnapshot();
      const model = await modelFromText(text);
      if (!model) return null;
      state.item = model;
      state.itemOriginal = JSON.parse(JSON.stringify(model));
      state.notice = null; state.stale = false; state.view = 'item';
      // synthesize a few comparable listings from the item's OWN mods (same
      // stat ids, varied rolls) so the results + hover-to-compare are real to
      // spotlight - all local, nothing hits the trade API
      try { state.results = buildResults(demoSynthListings(model), 3); } catch { state.results = null; }
      render();
      return model;
    },
    // open the Miscellaneous accordion so the tutorial can spotlight its toggles
    setMiscOpen(open) { state.miscOpen = !!open; render(); },
    demoDesecrate() {
      // pass a canned floor so Desecrate.open does NOT fire priceCurrentItem
      // (a live search) - the tutorial must never hit the API
      if (state.item && window.Desecrate) { window.Desecrate.open(state.item, { currentValue: 12 }); return true; }
      return false;
    },
    demoActive() { return !!demoBackup; },
    demoClear() {
      if (!demoBackup) return;
      Object.assign(state, demoBackup);
      demoBackup = null;
      render();
    },
  };

  // ---------- tab switching ----------
  // Optional-tab visibility (App Settings toggles). A hidden Desecrate tab still
  // opens via redesecrate? - its button shows WHILE it's the active tab and
  // vanishes again when you navigate away. A hidden Regex tab is simply gone.
  // Currency and Price Check are permanent; the rest carry a ✕ that hides them
  // (same state as the App Settings toggles), and the whole bar is drag-
  // reorderable. Order + visibility persist in config.
  const TAB_META = [
    { key: 'currency', id: 'tab-currency', closeable: false },
    { key: 'items', id: 'tab-items', closeable: false },
    { key: 'desec', id: 'tab-desecrate', closeable: true },
    { key: 'networth', id: 'tab-networth', closeable: true },
    { key: 'regex', id: 'tab-regex', closeable: true },
    { key: 'grandex', id: 'tab-grandex', closeable: true },
  ];
  const metaOf = (key) => TAB_META.find((t) => t.key === key);
  const tabVis = { desec: true, regex: true, grandex: true, networth: true };
  let tabOrder = TAB_META.map((t) => t.key);

  function activeKey() {
    const a = document.querySelector('#tabs .tab.active');
    if (!a) return null;
    const m = TAB_META.find((t) => t.id === a.id);
    return m ? m.key : null;
  }
  function applyTabVisibility(activeWhich) {
    for (const m of TAB_META) {
      if (!m.closeable) continue;
      const btn = $(m.id);
      if (!btn) continue;
      // Desecrate opens via the redesecrate? button and Net Worth via its
      // capture hotkey even while hidden - so a hidden tab stays reachable
      // WHILE it is the active view, then vanishes when you navigate away.
      const keepForActive = (m.key === 'desec' || m.key === 'networth') && activeWhich === m.key;
      btn.style.display = (tabVis[m.key] || keepForActive) ? '' : 'none';
    }
  }
  function setTabVisibility(tab, show) {
    tabVis[tab] = !!show;
    const which = activeKey();
    // closing the tab you're standing on strands you - move to Currency first.
    // desec/networth are exempt: they legitimately linger while active.
    if (!show && which === tab && tab !== 'desec' && tab !== 'networth') { setTab('currency'); return; }
    applyTabVisibility(which);
  }
  window.setTabVisibility = setTabVisibility; // renderer.js settings toggles call this

  // ---- bar order (drag to reorder) ----
  function applyTabOrder() {
    const nav = $('tabs');
    if (!nav) return;
    for (const key of tabOrder) {
      const m = metaOf(key);
      const btn = m && $(m.id);
      if (btn) nav.appendChild(btn); // re-appending in sequence sorts the bar
    }
  }
  function normalizeOrder(saved) {
    const known = TAB_META.map((t) => t.key);
    const out = (Array.isArray(saved) ? saved : []).filter((k) => known.includes(k));
    for (const k of known) if (!out.includes(k)) out.push(k); // tabs added later land at the end
    return out;
  }
  function moveTab(fromKey, targetKey, before) {
    const arr = tabOrder.filter((k) => k !== fromKey);
    const i = arr.indexOf(targetKey);
    if (i < 0) arr.push(fromKey);
    else arr.splice(before ? i : i + 1, 0, fromKey);
    tabOrder = arr;
    applyTabOrder();
    try { window.api.setTabOrder(tabOrder); } catch {}
    if (window.logAction) window.logAction(`tabs reordered: ${tabOrder.join(',')}`);
  }
  const clearDropMarks = () => document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.remove('tab-drop-l', 'tab-drop-r'));

  let dragKey = null;
  function wireTabBar() {
    for (const m of TAB_META) {
      const btn = $(m.id);
      if (!btn) continue;
      btn.draggable = true;
      btn.addEventListener('dragstart', (e) => {
        dragKey = m.key;
        btn.classList.add('tab-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.key); } catch {}
      });
      btn.addEventListener('dragend', () => { dragKey = null; btn.classList.remove('tab-dragging'); clearDropMarks(); });
      btn.addEventListener('dragover', (e) => {
        if (!dragKey || dragKey === m.key) return;
        e.preventDefault();
        const r = btn.getBoundingClientRect();
        clearDropMarks();
        btn.classList.add(e.clientX < r.left + r.width / 2 ? 'tab-drop-l' : 'tab-drop-r');
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('tab-drop-l', 'tab-drop-r'));
      btn.addEventListener('drop', (e) => {
        if (!dragKey) return;
        e.preventDefault();
        const r = btn.getBoundingClientRect();
        moveTab(dragKey, m.key, e.clientX < r.left + r.width / 2);
        dragKey = null;
        clearDropMarks();
      });
      if (m.closeable && !btn.querySelector('.tab-x')) {
        const x = document.createElement('span');
        x.className = 'tab-x';
        x.textContent = '✕';
        x.title = t('itemtab.settings.hide_tab_tooltip');
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          setTabVisibility(m.key, false);
          try { window.api.setTabShown(m.key, false); } catch {}
          if (window.setTabToggleChecked) window.setTabToggleChecked(m.key, false);
          if (window.logAction) window.logAction(`tab closed: ${m.key}`);
        });
        btn.appendChild(x);
      }
    }
  }
  // networth-ui calls this when a capture fires so the tally is visible even
  // when the tab is hidden in App Settings
  window.showNetWorthTab = () => setTab('networth');

  function setTab(which) {
    if (which === true) which = 'items'; // legacy boolean callers
    if (which === false) which = 'currency';
    state.active = which === 'items';
    // Tell main which tab is live so the trade-exchange poll only runs on Currency
    // (see main.js liveTick) - polling a tab the user isn't viewing burned the API budget.
    try { window.api.setActiveTab(which); } catch {}
    $('tab-items').classList.toggle('active', which === 'items');
    $('tab-currency').classList.toggle('active', which === 'currency');
    $('tab-desecrate').classList.toggle('active', which === 'desec');
    const nwTab = $('tab-networth'); if (nwTab) nwTab.classList.toggle('active', which === 'networth');
    const rxTab = $('tab-regex'); if (rxTab) rxTab.classList.toggle('active', which === 'regex');
    const gxTab = $('tab-grandex'); if (gxTab) gxTab.classList.toggle('active', which === 'grandex');
    $('item-root').classList.toggle('hidden', which !== 'items');
    $('buckets').classList.toggle('hidden', which !== 'currency');
    $('desecrate-root').classList.toggle('hidden', which !== 'desec');
    const nwRoot = $('networth-root'); if (nwRoot) nwRoot.classList.toggle('hidden', which !== 'networth');
    const rxRoot = $('regex-root'); if (rxRoot) rxRoot.classList.toggle('hidden', which !== 'regex');
    const gxRoot = $('grandex-root'); if (gxRoot) gxRoot.classList.toggle('hidden', which !== 'grandex');
    applyTabVisibility(which);
    document.querySelector('footer').classList.toggle('hidden', which !== 'currency');
    // #status is currency-feed state; keep it off the other tabs
    if (which !== 'currency') $('status').classList.add('hidden');
    else if ($('status').textContent) $('status').classList.remove('hidden');
    if (which === 'items') {
      ensureInit(); // warm the parser while the user reaches for Ctrl+C
      render();
    }
    if (which === 'desec' && window.Desecrate) window.Desecrate.render();
    if (which === 'networth' && window.NetWorth) window.NetWorth.render();
    if (which === 'regex' && window.RegexTab) window.RegexTab.render();
    if (which === 'grandex' && window.GrandEx) window.GrandEx.render();
  }

  // ---------- wiring ----------
  window.addEventListener('DOMContentLoaded', async () => {
    $('tab-currency').addEventListener('click', () => setTab('currency'));
    $('tab-items').addEventListener('click', () => setTab('items'));
    $('tab-desecrate').addEventListener('click', () => setTab('desec'));
    { const t = $('tab-networth'); if (t) t.addEventListener('click', () => setTab('networth')); }
    { const t = $('tab-regex'); if (t) t.addEventListener('click', () => setTab('regex')); }
    { const t = $('tab-grandex'); if (t) t.addEventListener('click', () => setTab('grandex')); }
    wireTabBar(); // drag-to-reorder + the ✕ on closeable tabs
    // Reopen on whichever tab you left it on last (persisted in config.lastTab);
    // first-ever launch falls back to Currency. Also syncs tab state + reports it.
    window.api.getConfig().then((c) => {
      state.itemHotkey = c.itemHotkey;
      tabVis.desec = c.showDesecrateTab !== false;
      tabVis.regex = c.showRegexTab !== false;
      tabVis.grandex = c.showGrandExTab !== false;
      tabVis.networth = c.showNetWorthTab !== false;
      tabOrder = normalizeOrder(c.tabOrder);
      applyTabOrder();
      let last = ['currency', 'items', 'desec', 'networth', 'regex', 'grandex'].includes(c.lastTab) ? c.lastTab : 'currency';
      // never reopen INTO a hidden tab
      if ((last === 'desec' && !tabVis.desec) || (last === 'regex' && !tabVis.regex) || (last === 'grandex' && !tabVis.grandex) || (last === 'networth' && !tabVis.networth)) last = 'currency';
      setTab(last);
      if (state.active) render();
    }).catch(() => setTab('currency'));

    document.addEventListener('paste', async (e) => {
      const text = e.clipboardData && e.clipboardData.getData('text');
      if (!text) return;
      // paste on the Regex tab seeds the builder from the copied waystone/tablet
      const rxRoot = $('regex-root');
      if (rxRoot && !rxRoot.classList.contains('hidden')) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // typing a custom pattern, not seeding
        e.preventDefault();
        // parse first: the regex tab used to read the raw text, which only understands
        // an English client. The model carries canonical refs for every language.
        let model = null;
        try { model = await modelFromText(text); } catch { /* fall back to raw text */ }
        if (window.RegexTab) window.RegexTab.seedFromText(text, model);
        return;
      }
      // paste on the Desecrate tab loads the item straight into the EV view
      if (!$('desecrate-root').classList.contains('hidden')) {
        e.preventDefault();
        const model = await modelFromText(text);
        if (model) window.Desecrate.open(model, {});
        else if (window.Desecrate) { window.Desecrate.noticeBadPaste(); }
        return;
      }
      if (!state.active) return;
      e.preventDefault();
      tryParse(text);
    });
    // price-check hotkey in game: main copied the hovered item and showed the
    // overlay - jump straight to the Items tab with it parsed and searching
    if (window.api.onItemCopied) {
      window.api.onItemCopied((text) => { setTab(true); tryParse(text); });
    }
    if (window.api.onItemCopyFailed) {
      window.api.onItemCopyFailed(() => {
        setTab(true);
        const hk = String(state.itemHotkey || 'Ctrl+F').replace(/Control|CommandOrControl/g, 'Ctrl');
        state.notice = t('itemtab.notice.copy_failed', { hotkey: hk });
        render();
      });
    }
    // Rate-limit queuing: tell the user we're waiting, not stuck. A one-shot
    // string went stale the moment it was written ("continuing in 240s" still
    // saying 240 four minutes later reads as frozen), so hold a DEADLINE and
    // tick it down.
    if (window.api.onTrade2Wait) {
      window.api.onTrade2Wait(({ ms, banned }) => {
        if (!state.searching) return;
        setWait(Date.now() + ms, banned);
      });
    }
    // clicking the paste prompt reads the clipboard directly
    document.addEventListener('click', async (e) => {
      if (!state.active) return;
      if (e.target.closest && e.target.closest('.paste-prompt')) {
        tryParse(await window.api.readClipboard());
      }
    });

    try {
      const cfg = await window.api.getConfig();
      state.history = Array.isArray(cfg.itemHistory) ? cfg.itemHistory : [];
      state.ranges = cfg.itemRanges && typeof cfg.itemRanges === 'object' ? cfg.itemRanges : {};
      // drop stale un-namespaced range keys from before per-category learning
      for (const k of Object.keys(state.ranges)) if (!k.includes('|')) delete state.ranges[k];
      state.garbage = Array.isArray(cfg.garbagePool) ? cfg.garbagePool : [];
      state.assume = { q20: cfg.itemQ20 !== false, fillRunes: cfg.itemFillRunes !== false };
      state.showSliders = cfg.itemSliders !== false;
      state.opts.defaultLowerPct = typeof cfg.itemStatRange === 'number' ? cfg.itemStatRange : 15;
      state.opts.indexed = cfg.itemIndexed || null;
    } catch {}
  });
})();
