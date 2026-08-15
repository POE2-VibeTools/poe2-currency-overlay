// desecrate.js - the Desecrate tab: is this item worth Omen of Light spamming?
//
// Model: the item has a desecrated mod on side S (or an open S slot). One cycle =
// Omen of Light + Orb of Annulment (strips only the desecrated mod) + one bone at
// the Well of Souls -> 3 revealed choices, pick the best (6 with an Omen of
// Abyssal Echoes reroll). Choices draw from the item's regular mod pool PLUS the
// Abyssal liches' desecrated-exclusive pool, weighted by real spawn weights
// (desecration-pool.json, generated from RePoE). The user ticks which outcomes
// count as hits and the minimum acceptable tier; we compute the weight share,
// P(hit) per reveal, expected cycles and cost per route, and the net EV against
// the priced value of the hit item vs the item as it stands.
//
// Bone tiers: Preserved = any tier your item level allows. Ancient = offered mods
// have modifier level >= 40 (cuts the bottom tiers; costs more). Altered
// (collarbone, jewellery only) = otherworldly pool - no weight data yet, so its
// hit chance is a manual input.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ageStr(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return t('desecrate.history.age_seconds', { n: s });
    if (s < 3600) return t('desecrate.history.age_minutes', { n: Math.floor(s / 60) });
    if (s < 86400) return t('desecrate.history.age_hours', { n: Math.floor(s / 3600) });
    return t('desecrate.history.age_days', { n: Math.floor(s / 86400) });
  }

  let pool = null;
  fetch('item/desecration-pool.json').then((r) => r.json()).then((j) => {
    pool = j;
    window.__desecPool = j; // shared with the item-search picker (soul/otherworldly hash sets)
    if (state.model) { inferSide(); render(); }
  }).catch(() => {});

  // Which side does the current desecrated mod occupy? (that's the slot we
  // reroll, and it decides the whole candidate pool.) The advanced copy states
  // it outright - trust that first. Only fall back to a pool lookup, and then
  // ONLY against desecrated families: the same stat can be a regular prefix and
  // a desecrated suffix (accuracy is "Precise" the prefix AND a desecrated
  // suffix), and matching the regular family flips the side and hides the
  // entire real pool.
  // The mod leaving the item: the existing desecrated mod (re-desecrate door), or the
  // one the user says the bone consumed (fresh door on a full item). Same role in the
  // hit-value search and the display; only the COST model tells them apart, because a
  // fresh first roll needs no Omen of Light.
  const strippedMod = () => state.curDesMod || state.consumedMod;

  // A full item has no open affix for the desecrated mod to slide into. Counted over
  // affix mods only: props, runes, enchants, implicits and the synthesized pseudo rows
  // are not affixes, and a scope-split head is the same mod as its sub-row.
  function affixCount() {
    let n = 0;
    for (const m of (state.model && state.model.mods) || []) {
      if (m.prop || !m.text) continue;
      if (['rune', 'added-rune', 'enchant', 'implicit', 'pseudo'].includes(m.kind)) continue;
      if (m.foldHead && String(m.foldGroup || '').startsWith('scope-')) continue;
      n++;
    }
    return n;
  }
  const itemIsFull = () => affixCount() >= 6;
  // what the bone may consume: a non-fractured real affix
  const consumable = (m) => !m.prop && m.text
    && !['rune', 'added-rune', 'enchant', 'implicit', 'pseudo', 'fractured', 'desecrated'].includes(m.kind)
    && !(m.foldHead && String(m.foldGroup || '').startsWith('scope-'));

  function inferSide() {
    const m = strippedMod();
    if (!m) return;
    if (m.gen === 'prefix' || m.gen === 'suffix') { state.side = m.gen; return; }
    if (!pool) return;
    const ids = [m.id, ...(m.altIds || [])].filter(Boolean).map((x) => String(x).split('.').pop());
    const fam = pool.families.find((f) => f.d && f.hashes.some((h) => h && ids.includes(h)))
      || pool.families.find((f) => f.hashes.some((h) => h && ids.includes(h)));
    if (fam) state.side = fam.s === 'p' ? 'prefix' : 'suffix';
  }

  // trade category -> bone kind + fallback base tags (when EE2 has none for the base)
  const BONE_OF = (cat) => {
    if (!cat) return 'rib';
    if (cat.startsWith('jewel')) return 'cranium'; // regular jewels desecrate via Preserved Cranium
    if (cat.startsWith('weapon.') || cat === 'armour.quiver') return 'jawbone';
    if (cat.startsWith('accessory.')) return 'collarbone';
    return 'rib';
  };
  // which bone tiers each kind actually has. Cranium exists ONLY in the Preserved
  // tier (no Gnawed/Ancient/Altered Cranium), so jewel desecration is untiered.
  const BONE_TIERS = {
    jawbone: ['preserved', 'ancient'], rib: ['preserved', 'ancient'],
    collarbone: ['preserved', 'ancient', 'altered'], cranium: ['preserved'],
  };
  const boneTiers = () => BONE_TIERS[BONE_OF(state.model && state.model.category)] || ['preserved', 'ancient'];
  const FALLBACK_TAGS = {
    'accessory.ring': ['ring'], 'accessory.amulet': ['amulet'], 'accessory.belt': ['belt'],
    'armour.helmet': ['helmet', 'armour'], 'armour.chest': ['body_armour', 'armour'],
    'armour.gloves': ['gloves', 'armour'], 'armour.boots': ['boots', 'armour'],
    'armour.shield': ['shield', 'armour'], 'armour.buckler': ['shield', 'dex_shield', 'armour'],
    'armour.focus': ['focus', 'armour'], 'armour.quiver': ['quiver'],
    'weapon.bow': ['bow', 'ranged', 'two_hand_weapon', 'weapon'], 'weapon.crossbow': ['crossbow', 'ranged', 'two_hand_weapon', 'weapon'],
    'weapon.wand': ['wand', 'caster', 'one_hand_weapon', 'weapon'], 'weapon.staff': ['staff', 'caster', 'two_hand_weapon', 'weapon'],
    'weapon.sceptre': ['sceptre', 'caster', 'one_hand_weapon', 'weapon'], 'weapon.warstaff': ['warstaff', 'melee', 'two_hand_weapon', 'weapon'],
    'weapon.onesword': ['sword', 'melee', 'one_hand_weapon', 'weapon'], 'weapon.twosword': ['sword', 'melee', 'two_hand_weapon', 'weapon'],
    'weapon.oneaxe': ['axe', 'melee', 'one_hand_weapon', 'weapon'], 'weapon.twoaxe': ['axe', 'melee', 'two_hand_weapon', 'weapon'],
    'weapon.onemace': ['mace', 'melee', 'one_hand_weapon', 'weapon'], 'weapon.twomace': ['mace', 'melee', 'two_hand_weapon', 'weapon'],
    'weapon.claw': ['claw', 'melee', 'one_hand_weapon', 'weapon'], 'weapon.dagger': ['dagger', 'melee', 'one_hand_weapon', 'weapon'],
    'weapon.spear': ['spear', 'melee', 'one_hand_weapon', 'weapon'], 'weapon.flail': ['flail', 'melee', 'one_hand_weapon', 'weapon'],
    // jewels: base tags come from the item DB per base (Ruby=strjewel, Sapphire=intjewel,
    // Emerald=dexjewel, Diamond=all); this fallback covers all three when the base is unknown
    'jewel': ['strjewel', 'dexjewel', 'intjewel'], 'jewel.abyss': ['strjewel', 'dexjewel', 'intjewel'],
  };

  // consumable prices: poe2scout/CX apiIds, autofilled from the currency feed
  const PRICE_IDS = {
    light: 'omen-of-light', annul: 'annul', echoes: 'omen-of-abyssal-echoes',
    jawbone: { preserved: 'preserved-jawbone', ancient: 'ancient-jawbone' },
    rib: { preserved: 'preserved-rib', ancient: 'ancient-rib' },
    collarbone: { preserved: 'preserved-collarbone', ancient: 'ancient-collarbone', altered: 'altered-collarbone' },
    cranium: { preserved: 'preserved-cranium' },
  };

  const state = {
    model: null,          // the Price Check item model (shared shape)
    side: 'suffix',
    ilvl: 82,
    tags: [],
    curDesMod: null,      // the item's current desecrated-scope mod (if any)
    consumedMod: null,    // fresh desecration on a FULL item: which mod the bone ate
                          // (the choice happens in game at bone-click; the user tells us)
    hits: new Map(),      // family index -> min acceptable GLOBAL tier index (0 = T1)
    hitFilter: '',        // subset-word filter over the pick-your-hits list
    prices: {},           // key -> exalts internally (user-editable; null = unknown)
    units: {},            // key -> 'ex' | 'div' (display/edit unit per money field)
    alteredP: null,       // manual per-choice hit % for the altered route
    currentValue: null,   // exalts - item as it stands (auto-priced, editable)
    hitValue: null,       // exalts - item with a hit (priced via count-1 search)
    hitValueBusy: false,
    curValueBusy: false,
    notice: null,
    history: [],          // past evaluations, newest first (persisted)
    view: 'item',         // 'item' | 'history'
    histShown: 10,        // how many history rows are visible (paged 10 at a time)
  };

  // ---------- history ----------
  function loadHistory() {
    window.api.getConfig().then((c) => {
      state.history = Array.isArray(c.desecHistory) ? c.desecHistory : [];
      render(); // always re-render: history loads async, so an item already on screen needs the "back to checks" link added
    }).catch(() => {});
  }
  loadHistory();

  function saveHistory() {
    const rec = {
      ts: Date.now(),
      title: state.model.title || state.model.base,
      base: state.model.base,
      side: state.side,
      ilvl: state.ilvl,
      model: state.model,
      curDesText: state.curDesMod ? state.curDesMod.text : null,
      consumedText: state.consumedMod ? state.consumedMod.text : null,
      hits: [...state.hits].map(([fi, ti]) => [fi, ti]),
      prices: { ...state.prices },
      units: { ...state.units },
      currentValue: state.currentValue,
      hitValue: state.hitValue,
      alteredP: state.alteredP,
    };
    const key = (r) => `${r.base}|${r.curDesText || ''}|${(r.hits || []).map((h) => h[0]).join(',')}`;
    state.history = [rec, ...state.history.filter((r) => key(r) !== key(rec))].slice(0, 100);
    if (window.api.setDesecHistory) window.api.setDesecHistory(state.history);
  }

  function restore(rec) {
    state.model = rec.model;
    state.side = rec.side || 'suffix';
    state.ilvl = rec.ilvl || 82;
    state.curDesMod = (rec.model.mods || []).find((m) => m.text === rec.curDesText) || null;
    state.consumedMod = (rec.model.mods || []).find((m) => m.text === rec.consumedText) || null;
    state.hits = new Map(rec.hits || []);
    state.prices = { ...(rec.prices || {}) };
    state.units = { ...(rec.units || {}) };
    state.currentValue = rec.currentValue != null ? rec.currentValue : null;
    state.hitValue = rec.hitValue != null ? rec.hitValue : null;
    state.alteredP = rec.alteredP != null ? rec.alteredP : null;
    state.tags = baseTags();
    state.notice = null;
    state.view = 'item';
    render();
  }

  const divRate = () => {
    const r = window.currencyPriceOf ? window.currencyPriceOf('divine') : null;
    return r > 0 ? r : null;
  };
  // strip concrete values from a mod template: the tier dropdown carries the
  // numbers, the text names the mod ("#% to Fire Resistance")
  const genericText = (t) => String(t || '')
    .replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/g, '#')
    .replace(/-?\d+(?:\.\d+)?/g, '#')
    .replace(/\+#/g, '#')
    .replace(/# ?%/g, '#%');

  function boneKind() { return BONE_OF(state.model && state.model.category); }

  // money fields that read in divine by default: the item values and the pricey
  // Omen of Light, plus the Preserved Cranium (a divine-tier jewel bone). Others
  // stay in exalts. Only applies once a divine rate exists to convert against.
  const DIV_DEFAULT_KEYS = new Set(['cur', 'hit', 'light']);
  function defaultUnit(key) {
    if (DIV_DEFAULT_KEYS.has(key)) return 'div';
    if (key === 'bone_preserved' && boneKind() === 'cranium') return 'div';
    return 'ex';
  }

  // live subset-word filter over the pick-your-hits rows (same feel as the item
  // search picker). Applied in-place, so typing never triggers a full re-render
  // and the input keeps focus.
  function applyHitFilter(sec) {
    const q = String(state.hitFilter || '').toLowerCase().split(/\s+/).filter(Boolean);
    sec.querySelectorAll('.des-mod').forEach((r) => {
      const t = r.dataset.f || '';
      r.style.display = q.every((w) => t.includes(w)) ? '' : 'none';
    });
    // collapse an otherworldly group (subhead + list) that filtered down to nothing
    sec.querySelectorAll('.des-list-other').forEach((ol) => {
      const any = [...ol.querySelectorAll('.des-mod')].some((r) => r.style.display !== 'none');
      ol.style.display = any ? '' : 'none';
      const sub = ol.previousElementSibling;
      if (sub && sub.classList.contains('des-subhead')) sub.style.display = any ? '' : 'none';
    });
  }

  const ATTR_JEWEL = new Set(['strjewel', 'dexjewel', 'intjewel']);
  function baseTags() {
    const m = state.model;
    if (!m) return [];
    // the item DB's tags are defence-type tags (int_armour, dex_shield...);
    // spawn weights also key on slot tags (gloves, helmet...) - merge both
    const db = new Set();
    try {
      const hit = window.EE2.itemByRef('ITEM', m.base);
      if (hit && hit[0] && hit[0].tags) for (const t of hit[0].tags) db.add(t);
    } catch {}
    const tags = new Set(db);
    // merge category fallback for slot tags the base DB omits, but when the base
    // already names its attribute-jewel tag (Sapphire=intjewel), don't let the
    // catch-all fallback widen it into str/dex mods it can't roll
    const basePins = [...db].some((t) => ATTR_JEWEL.has(t));
    for (const t of (FALLBACK_TAGS[m.category] || [])) {
      if (basePins && ATTR_JEWEL.has(t) && !db.has(t)) continue;
      tags.add(t);
    }
    return [...tags];
  }

  // first matching spawn-weight tag wins (the game's semantics); 'default' catches all
  function weightFor(sw, tagSet) {
    for (const [tag, w] of sw) {
      if (tag === 'default' || tagSet.has(tag)) return w;
    }
    return 0;
  }

  // hashes already on the item (any scope) - a family offering one of these is excluded
  function itemHashes() {
    const out = new Set();
    for (const m of (state.model && state.model.mods) || []) {
      if (m.prop || !m.id) continue;
      out.add(String(m.id).split('.').pop());
      for (const a of m.altIds || []) out.add(String(a).split('.').pop());
    }
    return out;
  }

  // eligible (family, tier) entries for a bone tier. Returns per-family eligible
  // tier indexes + weights, plus the total pool weight.
  function eligiblePool(bone) {
    if (!pool) return { entries: [], total: 0 };
    const tagSet = new Set(state.tags);
    const onItem = itemHashes();
    const sideKey = state.side === 'prefix' ? 'p' : 's';
    const entries = [];
    let total = 0;
    pool.families.forEach((fam, fi) => {
      if (fam.s !== sideKey) return;
      // otherworldly mods (d=2) only exist in the ALTERED-bone pool - the regular
      // Preserved/Ancient routes never reach them.
      if (fam.d === 2 && bone !== 'altered') return;
      // exclusion: same stat line already on the item (approximates group rules).
      // The current desecrated mod is being stripped each cycle, so its own
      // family stays rollable.
      const cur = state.curDesMod && String(state.curDesMod.id || '').split('.').pop();
      const isCurFam = cur && fam.hashes.includes(cur);
      if (!isCurFam && fam.hashes.some((h) => h && onItem.has(h))) return;
      const tiers = [];
      fam.tiers.forEach((t, ti) => {
        if (t.lvl > state.ilvl) return;
        if (bone === 'ancient' && t.lvl < 40) return;
        const w = weightFor(t.sw, tagSet);
        if (w > 0) { tiers.push({ ti, w, lvl: t.lvl, lo: t.lo, hi: t.hi }); total += w; }
      });
      if (tiers.length) entries.push({ fi, fam, tiers });
    });
    return { entries, total };
  }

  // P(one revealed choice is an accepted hit) for a bone tier
  function pChoice(bone) {
    const { entries, total } = eligiblePool(bone);
    if (!total) return 0;
    let hitW = 0;
    for (const e of entries) {
      const minTi = state.hits.get(e.fi);
      if (minTi == null) continue;
      for (const t of e.tiers) if (t.ti <= minTi) hitW += t.w;
    }
    return hitW / total;
  }

  function priceOf(key) {
    if (state.prices[key] != null) return state.prices[key];
    return null;
  }

  function autofillPrices() {
    const get = (apiId) => (window.currencyPriceOf ? window.currencyPriceOf(apiId) : null);
    const bone = boneKind();
    const dr = divRate();
    const fill = (key, apiId) => {
      if (state.prices[key] == null && apiId) {
        const v = get(apiId);
        if (v != null) {
          state.prices[key] = Math.round(v * 10) / 10;
          // anything worth a div reads in div - nobody prices omens in 5000 ex
          if (state.units[key] == null && dr && v >= dr) state.units[key] = 'div';
        }
      }
    };
    fill('light', PRICE_IDS.light);
    fill('annul', PRICE_IDS.annul);
    fill('echoes', PRICE_IDS.echoes);
    fill('bone_preserved', PRICE_IDS[bone] && PRICE_IDS[bone].preserved);
    fill('bone_ancient', PRICE_IDS[bone] && PRICE_IDS[bone].ancient);
    fill('bone_altered', PRICE_IDS[bone] && PRICE_IDS[bone].altered);
  }

  // one route's numbers. p = per-choice hit chance; reveal = 3 choices, echoes
  // reroll once more (used only when the first 3 all miss).
  function routeMath(p, bonePrice) {
    if (!(p > 0)) return null;
    // Abyssal Echoes is assumed, always: if you're paying divs for Omen of
    // Light, you damn well reroll for a chaos. It's an omen - active before
    // the reveal, consumed WITH it - so it's a flat cost on every cycle,
    // buying 6 looks per bone.
    const pHit = 1 - Math.pow(1 - p, 6);
    if (!(pHit > 0)) return null;
    const attempts = 1 / pHit;
    const light = priceOf('light') || 0;
    const annul = priceOf('annul') || 0;
    const echoes = priceOf('echoes') || 0;
    // first cycle needs no strip when the slot is already open (no desecrated mod)
    const stripCycles = state.curDesMod ? attempts : Math.max(0, attempts - 1);
    const cost = attempts * ((bonePrice || 0) + echoes) + stripCycles * (light + annul);
    return { p, pHit, attempts, cost };
  }

  // unit as icon (Settings > "Show currency icons instead of names") or the
  // plain "div"/"ex" abbreviation, whichever the toggle calls for
  const curUnit = (apiId, abbr) => (window.currencyIconTag && window.currencyIconTag(apiId)) || abbr;

  // Same icon-or-abbr swap, but for the CLICKABLE ex/div flip control (.des-unit
  // in moneyField below): no title on the icon itself - an inner title would
  // shadow the control's own title, which must state both the currency name
  // and the flip action so the click affordance still reads with an icon.
  const unitCtrlHtml = (u) => {
    const name = u === 'div' ? 'Divine' : 'Exalted';
    if (window.currencyIconsOn && window.currencyIconsOn()) {
      const url = window.currencyIconUrl && window.currencyIconUrl(u === 'div' ? 'divine' : 'exalted');
      if (url) return `<img class="cur-icon-inline" src="${esc(url)}" alt="${esc(name)}">`;
    }
    return esc(u);
  };

  // HTML string ("N <icon-or-'ex'/'div'>") for a route/verdict cost or EV - only
  // for innerHTML sites, since it may contain an <img> tag.
  function fmtEx(v) {
    if (v == null) return t('desecrate.common.unknown_value');
    const div = window.currencyPriceOf ? window.currencyPriceOf('divine') : null;
    if (div > 0 && Math.abs(v) >= div) return `${(v / div).toFixed(1)} ${curUnit('divine', 'div')}`;
    return `${Math.round(v * 10) / 10} ${curUnit('exalted', 'ex')}`;
  }

  // ---------- pricing searches ----------
  // cheapest-cluster floor (in exalts) for a model, optionally with an extra
  // count-1 group appended (the hit set). Both the item's own price and the hit
  // price use the same recipe (-15% mins, second-cheapest listing) so the EV
  // delta compares like with like.
  async function floorOf(model, extraCountFilters) {
    const compiled = window.ItemQuery.compileQuery(model, { defaultLowerPct: 15 });
    if (extraCountFilters && extraCountFilters.length) {
      (compiled.query.stats = compiled.query.stats || []).push({ type: 'count', value: { min: 1 }, filters: extraCountFilters });
    }
    const league = await window.ItemTab.resolveLeague();
    const res = await window.api.trade2SearchFetch(league, { query: compiled.query, sort: compiled.sort }, 10);
    if (!res.ok) throw new Error(res.error);
    const listings = res.data.listings || [];
    const priced = listings.map((l) => l.listing && l.listing.price).filter((p) => p && p.amount != null);
    const inEx = (p) => {
      if (p.currency === 'exalted') return p.amount;
      const r = window.currencyPriceOf ? window.currencyPriceOf(p.currency) : null;
      return r > 0 ? p.amount * r : null;
    };
    const ex = priced.map(inEx).filter((v) => v != null).sort((a, b) => a - b);
    const floor = ex.length ? Math.round(ex[Math.min(1, ex.length - 1)] * 10) / 10 : null;
    return { floor, total: res.data.total || 0, priced: ex.length };
  }
  const setUnitFor = (key, exVal) => {
    const dr = divRate();
    if (state.units[key] == null && dr && exVal != null && exVal >= dr) state.units[key] = 'div';
  };

  async function priceCurrentItem() {
    if (!state.model || state.curValueBusy || state.currentValue != null) return;
    state.curValueBusy = true; render();
    try {
      const { floor } = await floorOf(state.model);
      if (floor != null) { state.currentValue = floor; setUnitFor('cur', floor); saveHistory(); }
    } catch (err) {
      state.notice = t('desecrate.notice.price_current_failed', { error: err.message });
    }
    state.curValueBusy = false;
    render();
  }

  async function priceHitSet() {
    if (!state.model || !state.hits.size || state.hitValueBusy) return;
    state.hitValueBusy = true; state.notice = null; render();
    try {
      // the item minus its current desecrated mod, plus any accepted hit at its
      // accepted-tier-or-better floor (count 1, either scope). The desecrated mod
      // may be split into an explicit head + own row - drop the whole scope group
      // so the stripped stat isn't left behind as an explicit filter.
      const gone = strippedMod();
      const curGroup = gone && String(gone.foldGroup || '').startsWith('scope-') ? gone.foldGroup : null;
      const mods = (state.model.mods || []).filter((m) => m !== gone && !(curGroup && m.foldGroup === curGroup));
      const filters = [];
      for (const [fi, minTi] of state.hits) {
        const fam = pool.families[fi];
        // min roll = the middle of the ACCEPTED tier's range (the dropdown pick),
        // never lowered by the stat-range %
        const acc = fam.tiers[minTi];
        const mid = acc && acc.lo != null && acc.hi != null
          ? Math.round(((acc.lo + acc.hi) / 2) * 10) / 10
          : null;
        for (const h of fam.hashes) {
          if (!h) continue;
          for (const scope of ['desecrated', 'explicit']) {
            filters.push({ id: `${scope}.${h}`, value: mid != null ? { min: mid } : undefined });
          }
        }
      }
      const { floor, total, priced } = await floorOf({ ...state.model, mods }, filters);
      if (floor != null) {
        state.hitValue = floor; setUnitFor('hit', floor); saveHistory();
        if (priced < 4) state.notice = t('desecrate.notice.thin_market', { count: priced, plural: priced === 1 ? '' : 's' });
      }
      else state.notice = t('desecrate.notice.no_listings', { total });
    } catch (err) {
      state.notice = t('desecrate.notice.hitset_search_failed', { error: err.message });
    }
    state.hitValueBusy = false;
    render();
  }

  // ---------- rendering ----------
  function render() {
    const root = $('desecrate-root');
    if (!root) return;
    // ticking a hit re-renders; the pool list must not jump back to the top
    const oldList = root.querySelector('.des-list');
    const keepScroll = oldList ? oldList.scrollTop : 0;
    root.innerHTML = '';
    if (!state.model || state.view === 'history') {
      if (state.model) {
        const back = el('div', 'back-link', t('desecrate.nav.back_to_item'));
        back.onclick = () => { state.view = 'item'; render(); };
        root.appendChild(back);
      }
      if (!state.model) {
        root.appendChild(el('div', 'des-empty-lead', t('desecrate.empty.lead')));
      }
      root.appendChild(el('div', 'paste-prompt des-prompt', t('desecrate.empty.paste_prompt')));
      if (!state.model && window.ItemTab && window.ItemTab.sampleModel) {
        const sample = el('button', 'sample-btn', t('desecrate.empty.sample_button'));
        sample.onclick = async () => {
          const m = await window.ItemTab.sampleModel();
          if (m) window.Desecrate.open(m, { currentValue: 12 });
        };
        root.appendChild(sample);
      }
      if (state.history.length) {
        root.appendChild(el('div', 'history-title', t('desecrate.history.title')));
        const shown = Math.min(state.history.length, state.histShown || 10);
        state.history.slice(0, shown).forEach((rec) => {
          const it = el('div', 'hist-item');
          const hits = (rec.hits || []).length;
          it.innerHTML = `<span class="hist-base">${esc(rec.title || rec.base)}</span>`
            + `<span class="hist-sum">${esc(rec.side || '')} &middot; ${tn('desecrate.history.hit_count', hits, { count: hits })}</span>`
            + `<span class="hist-age">${ageStr(rec.ts)}</span>`;
          it.onclick = () => restore(rec);
          root.appendChild(it);
        });
        if (state.history.length > shown) {
          const more = el('button', 'load-more', t('desecrate.history.load_more', { count: state.history.length - shown }));
          more.onclick = () => { state.histShown = shown + 10; render(); };
          root.appendChild(more);
        }
      }
      return;
    }
    if (!pool) { root.appendChild(el('div', 'notice', t('desecrate.notice.loading_pool'))); return; }
    autofillPrices();

    const wrap = el('div');
    if (state.history.length) {
      const back = el('div', 'back-link', t('desecrate.nav.back_to_history'));
      back.title = t('desecrate.history.back_tooltip');
      back.onclick = () => { state.view = 'history'; render(); };
      wrap.appendChild(back);
    }
    const head = el('div', 'item-head');
    head.appendChild(el('span', 'item-name rare', esc(state.model.title || state.model.base)));
    head.appendChild(el('span', 'item-base', esc(state.model.base)));
    const meta = el('span', 'item-meta des-meta', t('desecrate.item.level_label'));
    const ilvlIn = el('input', 'des-inline-num');
    ilvlIn.type = 'number'; ilvlIn.min = 1; ilvlIn.max = 100; ilvlIn.value = state.ilvl;
    ilvlIn.title = t('desecrate.item.level_tooltip');
    ilvlIn.onchange = () => {
      const n = parseInt(ilvlIn.value, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 100) { state.ilvl = n; state.hitValue = null; render(); }
    };
    meta.appendChild(ilvlIn);
    head.appendChild(meta);
    wrap.appendChild(head);

    // ----- the item itself, tight: stat chips + its mods, reroll target marked -----
    const card = el('div', 'des-item');
    // header carries the slot line (no separate banner - the highlighted mod
    // below already shows WHICH mod, and this says which SLOT)
    const head01 = el('div', 'des-item-head');
    head01.innerHTML = `<span class="des-num">01</span> ${t('desecrate.section.item_title')}`;
    const h01r = el('span', 'des-right');
    // fresh desecration on a full item: the bone will consume an affix, and only the
    // user knows which one they gave it (the choice happens in game at bone-click)
    const needsPick = !state.curDesMod && itemIsFull();
    if (state.curDesMod) {
      h01r.innerHTML = t('desecrate.item.rerolling_slot', { side: esc(state.side) });
      h01r.title = t('desecrate.item.reroll_tooltip', { side: state.side });
    } else if (needsPick) {
      h01r.innerHTML = t(state.consumedMod
        ? 'desecrate.item.consumed_slot' : 'desecrate.item.pick_consumed_prompt');
      h01r.title = t('desecrate.item.pick_consumed_tooltip');
    } else {
      h01r.innerHTML = t('desecrate.item.open_slot', { side: esc(state.side) });
      h01r.title = t('desecrate.item.open_slot_tooltip');
      const swap = el('span', 'notice-act', t('desecrate.item.swap_side_button', { other_side: state.side === 'prefix' ? 'suffix' : 'prefix' }));
      swap.onclick = () => { state.side = state.side === 'prefix' ? 'suffix' : 'prefix'; state.hits.clear(); state.hitValue = null; render(); };
      h01r.appendChild(swap);
    }
    head01.appendChild(h01r);
    card.appendChild(head01);
    const chips = el('div', 'des-ichips');
    for (const m of state.model.mods || []) {
      if (m.prop && m.value != null) chips.appendChild(el('span', 'des-ichip', esc(m.text)));
    }
    if (chips.childNodes.length) card.appendChild(chips);
    const imods = el('div', 'des-imods');
    for (const m of state.model.mods || []) {
      if (m.prop || !m.text) continue;
      // the Price Check search splits a desecrated/fractured mod into an explicit
      // "head" row + its own sub-row (same stat, two scopes). That's one mod - skip
      // the head so the card shows it once, as its true desecrated/fractured self.
      if (m.foldHead && String(m.foldGroup || '').startsWith('scope-')) continue;
      const gone = strippedMod();
      const line = el('div', 'des-imod' + (m === gone ? ' cur' : '') + (m.kind === 'rune' || m.kind === 'added-rune' || m.kind === 'enchant' ? ' aux' : ''));
      line.innerHTML = esc(m.text) + (m === gone ? ` <span class="des-imod-tag">${t('desecrate.item.annulled_badge')}</span>` : '');
      // full item, fresh desecration: the eligible mod lines are the picker - click
      // the one the bone consumed (non-fractured affixes only; click again to unpick)
      if (needsPick && consumable(m)) {
        line.classList.add('des-imod-pick');
        line.title = t('desecrate.item.pick_line_tooltip');
        line.onclick = () => {
          state.consumedMod = state.consumedMod === m ? null : m;
          state.hits.clear();
          state.hitValue = null;
          inferSide();
          render();
        };
      }
      imods.appendChild(line);
    }
    if (imods.childNodes.length) card.appendChild(imods);
    wrap.appendChild(card);

    if (state.notice) wrap.appendChild(el('div', 'notice', esc(state.notice)));

    // Step 1 blocks the rest (Drew's 3.0 spec): on a full item the outcomes and costs
    // depend on which mod left, and only the user knows. Everything below waits.
    if (needsPick && !state.consumedMod) {
      wrap.appendChild(el('div', 'notice', t('desecrate.item.pick_first_notice')));
      root.appendChild(wrap);
      return;
    }

    // ----- hit set picker -----
    // built from the ALTERED superset so otherworldly outcomes are tickable too
    // (they resolve to nothing on non-jewellery, and score 0 on the regular
    // routes - only the Altered route gives them a real hit chance).
    const { entries } = eligiblePool('altered');
    const sec = el('div', 'des-sec');
    sec.appendChild(el('div', 'des-sec-head', `<span class="des-num">02</span> ${t('desecrate.section.hits_title')} <span class="des-dim">${t('desecrate.section.hits_hint')}</span> <span class="des-right">${t('desecrate.section.hits_counter', { ticked: state.hits.size, total: entries.length })}</span>`));
    // a filter bar to jump to the outcomes you want (only worth showing on long lists)
    if (entries.length > 10) {
      const fin = el('input', 'des-hit-filter');
      fin.type = 'text';
      fin.placeholder = t('desecrate.outcomes.filter_placeholder');
      fin.value = state.hitFilter || '';
      fin.oninput = () => { state.hitFilter = fin.value; applyHitFilter(sec); };
      sec.appendChild(fin);
    }
    // one checkable row per outcome
    const hitRow = (e) => {
      const other = e.fam.d === 2;
      const row = el('div', 'des-mod' + (state.hits.has(e.fi) ? ' on' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = state.hits.has(e.fi);
      cb.onchange = () => {
        if (cb.checked) state.hits.set(e.fi, e.tiers[0].ti); // defaults to the best tier
        else state.hits.delete(e.fi);
        state.hitValue = null;
        saveHistory();
        render();
      };
      row.appendChild(cb);
      if (e.fam.d) {
        const badge = el('span', 'des-lich' + (other ? ' des-other' : ''), other ? t('desecrate.outcomes.otherworldly_badge') : esc(e.fam.name));
        badge.title = other
          ? t('desecrate.outcomes.otherworldly_tooltip')
          : t('desecrate.outcomes.desecrated_exclusive_tooltip');
        row.appendChild(badge);
      }
      if (state.hits.has(e.fi)) {
        const sel = el('select', 'des-tier');
        sel.title = t('desecrate.outcomes.tier_select_tooltip');
        for (const tier of e.tiers) { // NOT `t`: a local named t shadows the translator
          const o = el('option', null, `${t('desecrate.outcomes.tier_option_label', { tier: tier.ti + 1 })}${tier.lo != null ? ` (${tier.lo}-${tier.hi})` : ''}`);
          o.value = String(tier.ti);
          sel.appendChild(o);
        }
        sel.value = String(state.hits.get(e.fi));
        sel.onchange = () => { state.hits.set(e.fi, Number(sel.value)); state.hitValue = null; saveHistory(); render(); };
        row.appendChild(sel);
      }
      const txt = el('span', 'des-text', esc(genericText(e.fam.text)));
      txt.title = e.tiers.map((tr) => t('desecrate.outcomes.tier_detail_tooltip', { tier: tr.ti + 1, level: tr.lvl, range: tr.lo != null ? ` (${tr.lo}-${tr.hi})` : '', weight: tr.w })).join('\n');
      row.appendChild(txt);
      row.dataset.f = `${genericText(e.fam.text)} ${e.fam.name || ''}`.toLowerCase(); // filter key
      return row;
    };
    // The two pools are separated: normal desecration (any bone) vs otherworldly
    // (Altered bone only). Ticking an otherworldly outcome commits you to Altered.
    const normal = entries.filter((e) => e.fam.d !== 2)
      .sort((a, b) => (b.fam.d - a.fam.d) || a.fam.text.localeCompare(b.fam.text));
    const other = entries.filter((e) => e.fam.d === 2)
      .sort((a, b) => a.fam.text.localeCompare(b.fam.text));
    const list = el('div', 'des-list');
    normal.forEach((e) => list.appendChild(hitRow(e)));
    sec.appendChild(list);
    if (other.length) {
      const oh = el('div', 'des-subhead',
        t('desecrate.outcomes.otherworldly_subhead', { count: other.length, bone: esc(boneKind()) }));
      sec.appendChild(oh);
      const olist = el('div', 'des-list des-list-other');
      other.forEach((e) => olist.appendChild(hitRow(e)));
      sec.appendChild(olist);
    }
    requestAnimationFrame(() => { list.scrollTop = keepScroll; });
    if (state.hitFilter) applyHitFilter(sec); // keep the filter applied across re-renders
    wrap.appendChild(sec);

    // money field: stored in exalts, displayed/edited in ex or div - the unit
    // label toggles and converts. Anything >= 1 div autofills as div.
    // caption on top; input, unit toggle and an optional trailer (the price-it
    // button) all share ONE horizontal row beside the box
    const moneyField = (label, key, getEx, setEx, title, busy, trailer) => {
      const f = el('label', 'des-price');
      if (title) f.title = title;
      f.appendChild(el('span', 'des-plab', label));
      const row = el('div', 'des-inrow');
      const dr = divRate();
      const u = (state.units[key] || defaultUnit(key)) === 'div' && dr ? 'div' : 'ex';
      const i = el('input'); i.type = 'number'; i.min = 0; i.step = 'any';
      const exVal = getEx();
      i.value = exVal != null ? (u === 'div' ? Math.round((exVal / dr) * 10) / 10 : Math.round(exVal * 10) / 10) : '';
      i.placeholder = busy ? t('desecrate.common.busy_ellipsis') : t('desecrate.common.unknown_value');
      i.onchange = () => {
        const n = parseFloat(i.value);
        setEx(Number.isFinite(n) ? (u === 'div' ? n * dr : n) : null);
        render();
      };
      row.appendChild(i);
      const us = el('span', 'des-unit', unitCtrlHtml(u));
      const otherName = u === 'div' ? 'Exalted' : 'Divine';
      const curName = u === 'div' ? 'Divine' : 'Exalted';
      us.title = `${curName} — click to switch to ${otherName}`;
      us.onclick = (ev) => {
        ev.preventDefault();
        if (!divRate()) return;
        state.units[key] = u === 'div' ? 'ex' : 'div';
        render();
      };
      row.appendChild(us);
      if (trailer) row.appendChild(trailer);
      f.appendChild(row);
      return f;
    };
    const priceField = (label, key, title) => moneyField(label, key,
      () => state.prices[key], (v) => { state.prices[key] = v; }, title);

    // ----- 03: values & costs (one card) -----
    const vc = el('div', 'des-sec');
    vc.appendChild(el('div', 'des-sec-head', `<span class="des-num">03</span> ${t('desecrate.section.values_title')} <span class="des-dim">${t('desecrate.section.values_hint', { bone: esc(boneKind()) })}</span>`));
    // outcomes: the two values the whole EV hinges on - given prominence
    const outc = el('div', 'des-outcomes');
    outc.appendChild(moneyField(t('desecrate.values.item_now_label'), 'cur',
      () => state.currentValue, (v) => { state.currentValue = v; },
      t('desecrate.values.item_now_tooltip'),
      state.curValueBusy));
    const pbtn = el('button', 'mini-btn', state.hitValueBusy ? t('desecrate.common.busy_ellipsis') : t('desecrate.values.price_it_button'));
    pbtn.disabled = state.hitValueBusy || !state.hits.size;
    pbtn.title = state.hits.size ? t('desecrate.values.price_it_tooltip_ready') : t('desecrate.values.price_it_tooltip_disabled');
    pbtn.onclick = (ev) => { ev.preventDefault(); priceHitSet(); };
    const hv = moneyField(t('desecrate.values.item_with_hit_label'), 'hit',
      () => state.hitValue, (v) => { state.hitValue = v; },
      t('desecrate.values.item_with_hit_tooltip'),
      state.hitValueBusy, pbtn);
    outc.appendChild(hv);
    vc.appendChild(outc);
    // costs: live consumable prices - compact, editable assumptions under the outcomes
    const costs = el('div', 'des-costs');
    costs.appendChild(priceField(t('desecrate.costs.omen_of_light_label'), 'light', t('desecrate.costs.omen_of_light_tooltip')));
    costs.appendChild(priceField(t('desecrate.costs.annulment_label'), 'annul'));
    costs.appendChild(priceField(boneKind() === 'cranium' ? t('desecrate.costs.cranium_label') : t('desecrate.costs.preserved_bone_label'), 'bone_preserved'));
    if (boneTiers().includes('ancient')) costs.appendChild(priceField(t('desecrate.costs.ancient_bone_label'), 'bone_ancient'));
    // The Altered bone is the only way into the otherworldly pool and it's the
    // pricey one - show it for jewellery, auto-priced, and flag it the moment an
    // otherworldly outcome is ticked (you're now committed to Altered).
    if (boneKind() === 'collarbone') {
      const needsAltered = [...state.hits.keys()].some((fi) => pool && pool.families[fi] && pool.families[fi].d === 2);
      const af = priceField(t('desecrate.costs.altered_bone_label'), 'bone_altered',
        t('desecrate.costs.altered_bone_tooltip'));
      if (needsAltered) af.classList.add('des-price-req');
      costs.appendChild(af);
    }
    costs.appendChild(priceField(t('desecrate.costs.abyssal_echoes_label'), 'echoes',
      t('desecrate.costs.abyssal_echoes_tooltip')));
    vc.appendChild(costs);
    wrap.appendChild(vc);

    // ----- routes -----
    const routes = el('div', 'des-sec');
    routes.appendChild(el('div', 'des-sec-head', `<span class="des-num">04</span> ${t('desecrate.section.routes_title')}`));
    const table = el('div', 'des-routes');
    table.appendChild(el('div', 'des-rt-head', `<span>${t('desecrate.routes.col_route')}</span><span>${t('desecrate.routes.col_hit_reveal')}</span><span>${t('desecrate.routes.col_bones_needed')}</span><span>${t('desecrate.routes.col_expected_cost')}</span><span>${t('desecrate.routes.col_net_ev')}</span>`));
    const uplift = state.hitValue != null && state.currentValue != null ? state.hitValue - state.currentValue : null;
    const addRoute = (label, p, bonePrice, note) => {
      const m = routeMath(p, bonePrice);
      const row = el('div', 'des-rt');
      if (!m) {
        row.innerHTML = `<span>${esc(label)}</span><span class="des-dim des-span4">${esc(note || t('desecrate.routes.no_hits_note'))}</span>`;
        table.appendChild(row);
        return;
      }
      const ev = uplift != null ? uplift - m.cost : null;
      row.innerHTML =
        `<span>${esc(label)}</span>` +
        `<span title="${t('desecrate.routes.hit_reveal_tooltip')}">${(m.pHit * 100).toFixed(1)}%</span>` +
        `<span title="${t('desecrate.routes.bones_needed_tooltip')}">${m.attempts.toFixed(1)}</span>` +
        `<span>${fmtEx(m.cost)}</span>` +
        `<span class="${ev == null ? 'des-dim' : ev >= 0 ? 'up' : 'down'}">${ev == null ? t('desecrate.routes.ev_pending') : (ev >= 0 ? '+' : '') + fmtEx(ev)}</span>`;
      table.appendChild(row);
    };
    addRoute(t('desecrate.routes.label_preserved'), pChoice('preserved'), priceOf('bone_preserved'));
    if (boneTiers().includes('ancient')) addRoute(t('desecrate.routes.label_ancient'), pChoice('ancient'), priceOf('bone_ancient'));
    // Altered adds the OTHERWORLDLY pool to the reveal, so tick an otherworldly
    // outcome (or any regular one) and this route prices reaching it.
    if (boneKind() === 'collarbone') {
      addRoute(t('desecrate.routes.label_altered'), pChoice('altered'), priceOf('bone_altered'),
        t('desecrate.routes.altered_hint'));
    }
    routes.appendChild(table);
    if (uplift != null) {
      // label = what the user reads (translated, matching the routes table above);
      // the id stays English - it keys bone data and prices
      const routeDefs = [[t('desecrate.routes.label_preserved'), 'preserved', 'bone_preserved']];
      if (boneTiers().includes('ancient')) routeDefs.push([t('desecrate.routes.label_ancient'), 'ancient', 'bone_ancient']);
      if (boneTiers().includes('altered')) routeDefs.push([t('desecrate.routes.label_altered'), 'altered', 'bone_altered']);
      const best = routeDefs.map(([label, bone, priceKey]) => {
        const m = routeMath(pChoice(bone), priceOf(priceKey));
        return m ? { label, ev: uplift - m.cost } : null;
      }).filter(Boolean).sort((a, b) => b.ev - a.ev)[0];
      if (best) {
        const positive = best.ev >= 0;
        const vd = el('div', 'des-verdict ' + (positive ? 'up' : 'down'));
        vd.innerHTML =
          '<div class="des-vtext">'
          + `<div class="des-vtitle">${positive ? t('desecrate.verdict.worth_it') : t('desecrate.verdict.not_worth_it')}</div>`
          + (positive
              ? t('desecrate.verdict.positive_detail', { route: esc(best.label) })
              : t('desecrate.verdict.negative_detail', { route: esc(best.label) }))
          + '</div>'
          + `<div class="des-ev">${positive ? '+' : '−'}${fmtEx(Math.abs(best.ev))}<small>${t('desecrate.verdict.expected_ev')}</small></div>`;
        routes.appendChild(vd);
      }
    }
    wrap.appendChild(routes);
    root.appendChild(wrap);
  }

  // ---------- entry ----------
  window.Desecrate = {
    // re-render from current state with no changes of its own - used when a
    // global setting the render reads (e.g. currencyIcons) flips while this
    // tab is open, since state itself didn't change.
    refresh() { render(); },
    noticeBadPaste() {
      state.notice = t('desecrate.notice.bad_paste');
      render();
    },
    open(model, ctx) {
      state.model = model;
      state.ilvl = model.itemLevel || 82;
      state.curDesMod = (model.mods || []).find((m) => m.kind === 'desecrated' && !m.prop) || null;
      state.consumedMod = null;
      // side: the stripped slot's side. Desecrated mods don't carry generation in
      // our model - infer from the pool (which side offers this stat line).
      state.side = 'suffix';
      inferSide();
      state.hits.clear();
      state.hitFilter = '';
      state.hitValue = null;
      state.alteredP = null;
      state.notice = null;
      state.units = {};
      state.view = 'item';
      state.currentValue = ctx && ctx.currentValue != null ? ctx.currentValue : null;
      if (state.currentValue != null) setUnitFor('cur', state.currentValue);
      state.tags = baseTags();
      render();
      // no floor handed over? price the item as it stands (one search)
      if (state.currentValue == null) priceCurrentItem();
    },
    render,
  };
})();
