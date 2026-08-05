'use strict';

let config = null;          // { hotkey, league, buckets }
let catalog = {};           // apiId -> { price, text, icon, category }
let pairs = {};             // "a|b" (sorted) -> { a: relPrice, b: relPrice }
let league = '';
let fetchedAt = 0;
let fullCatalog = null;     // { league, groups: [{category,label,items}] }
let pickerMode = null;      // { type: 'add-item', bucketId } | { type: 'add-bucket' }
let refreshing = false;
let dragState = null;       // { bucketId, apiId } while a currency row is being dragged
let dragReordered = false;  // set true when a drag ends as an in-bucket reorder (vs dropped outside)
let skipRemoveConfirm = false; // "don't ask again this session" for pair removal; resets on restart/update

const $ = (id) => document.getElementById(id);

// ---------- formatting ----------
function fmt(v) {
  if (v == null || !isFinite(v) || v <= 0) return '-';
  if (v >= 1000) return Math.round(v).toLocaleString();
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toPrecision(2);
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return t('currency.time.just_now');
  if (s < 60) return t('currency.time.seconds_ago', { count: s });
  const m = Math.round(s / 60);
  return t('currency.time.minutes_ago', { count: m });
}

function shortName(text) {
  return (text || '').replace(/^Omen of /, t('currency.row.omen_prefix'));
}

// escape API-derived strings before they enter innerHTML - a hijacked data
// feed must never be able to inject markup into the renderer
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---------- data ----------
function itemInfo(ref) {
  const live = catalog[ref.apiId];
  return {
    apiId: ref.apiId,
    text: window.gameName((live && live.text) || ref.text || ref.apiId),
    icon: (live && live.icon) || ref.icon || '',
    price: live ? live.price : null,
    logs: (live && live.logs) || []
  };
}

// Ratio history of item vs base over the log window (each log point = item's exalt price).
// Item and base logs are aligned by calendar date.
function buildSeries(itemRef, baseRef) {
  const it = catalog[itemRef.apiId];
  if (!it || !it.logs || it.logs.length === 0) return null;
  const ba = catalog[baseRef.apiId];
  const baseIsExalt = baseRef.apiId === 'exalted';
  const dayKey = (t) => String(t).slice(0, 10);
  const baseByDay = {};
  if (!baseIsExalt) {
    if (!ba || !ba.logs) return null;
    for (const b of ba.logs) if (b.p > 0) baseByDay[dayKey(b.t)] = b.p;
  }
  const pts = [];
  for (const a of it.logs) {
    if (!(a.p > 0)) continue;
    const bp = baseIsExalt ? 1 : baseByDay[dayKey(a.t)];
    if (!bp) continue;
    pts.push({ t: a.t, v: a.p / bp, ex: a.p, q: a.q });
  }
  if (pts.length < 2) return null;
  return {
    pts,
    valid: pts,
    first: pts[0],
    last: pts[pts.length - 1],
    min: Math.min(...pts.map((p) => p.v)),
    max: Math.max(...pts.map((p) => p.v))
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// 7d sparkline: translucent area fill under a directional stroke (up = green,
// down = red), coloured to match the row's delta. All geometry/colour lands on
// SVG presentation attributes (points/d/fill/stroke), which CSP allows - unlike
// style="" attributes, which style-src 'self' silently strips.
function makeSpark(series) {
  const W = 44, H = 15;      // mock viewBox
  const X0 = 1, X1 = 43;     // horizontal insets
  const YT = 3.5, YB = 12;   // plot band; baseline sits at H-1
  const base = H - 1;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark-svg');
  const n = series.pts.length;
  const span = series.max - series.min || 1;
  const xAt = (i) => X0 + (i / Math.max(1, n - 1)) * (X1 - X0);
  const yAt = (v) => YB - ((v - series.min) / span) * (YB - YT);
  const pts = series.pts.map((p, i) => [xAt(i), yAt(p.v)]);
  const line = pts
    .map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1))
    .join(' ');
  const areaPts =
    pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` ${pts[pts.length - 1][0].toFixed(1)},${base} ${pts[0][0].toFixed(1)},${base}`;
  const up = series.last.v >= series.first.v;
  const stroke = up ? '#8ec97a' : '#c98a80';
  const fill = up ? 'rgba(142,201,122,.14)' : 'rgba(208,138,128,.14)';
  const poly = document.createElementNS(SVG_NS, 'polygon');
  poly.setAttribute('points', areaPts);
  poly.setAttribute('fill', fill);
  svg.appendChild(poly);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', line);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', stroke);
  path.setAttribute('stroke-width', '1.2');
  svg.appendChild(path);
  return svg;
}

function fmtQty(q) {
  if (q == null) return '-';
  if (q >= 1e6) return t('currency.fmt.million_suffix', { value: (q / 1e6).toFixed(1) });
  if (q >= 1e3) return t('currency.fmt.thousand_suffix', { value: (q / 1e3).toFixed(1) });
  return String(q);
}

function sparkTooltipHtml(series, itemText, baseText, baseIsExalt) {
  const delta = ((series.last.v - series.first.v) / series.first.v) * 100;
  const sign = delta >= 0 ? '+' : '';
  const cls = baseIsExalt ? 'tip-row' : 'tip-row c4';
  const ba = abbr(baseText) || t('currency.tip.col_base_fallback');

  const header = baseIsExalt
    ? `<div class="${cls} tip-cols"><span>${t('currency.tip.col_day')}</span><span>${t('currency.tip.col_ex')}</span><span>${t('currency.tip.col_qty')}</span></div>`
    : `<div class="${cls} tip-cols"><span>${t('currency.tip.col_day')}</span><span>${esc(ba)}</span><span>${t('currency.tip.col_ex')}</span><span>${t('currency.tip.col_qty')}</span></div>`;

  const rows = series.valid
    .map((p, i) => {
      const isLast = i === series.valid.length - 1;
      const day = new Date(p.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const cells = baseIsExalt
        ? `<span>${day}</span><span>${fmt(p.ex)}</span><span>${fmtQty(p.q)}</span>`
        : `<span>${day}</span><span>${fmt(p.v)}</span><span>${fmt(p.ex)}</span><span>${fmtQty(p.q)}</span>`;
      return `<div class="${cls}${isLast ? ' now' : ''}">${cells}</div>`;
    })
    .join('');

  const scoutUrl = 'https://poe2scout.com/economy/currency?search=' + encodeURIComponent(itemText);
  return (
    `<div class="tip-head">${esc(itemText)}</div>` +
    `<div class="tip-sub">${t('currency.tip.priced_in', { base: esc(baseText) })}</div>` +
    `<div class="tip-sum"><span>${t('currency.tip.days_suffix', { count: series.valid.length })} <b class="${delta >= 0 ? 'up' : 'down'}">${sign}${delta.toFixed(1)}%</b></span>` +
    `<span>${t('currency.tip.low', { value: fmt(series.min) })}</span><span>${t('currency.tip.high', { value: fmt(series.max) })}</span></div>` +
    header +
    rows +
    `<a class="tip-source" data-href="${esc(scoutUrl)}" title="${t('currency.tip.source_link_title')}">${t('currency.tip.source_link')}</a>`
  );
}

let pinnedTipEl = null; // click a tooltip cell to lock its tooltip on screen

function positionTip(el) {
  const tip = $('spark-tip');
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  tip.style.left = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2)) + 'px';
  tip.style.top = (r.top - th - 8 > 4 ? r.top - th - 8 : r.bottom + 8) + 'px';
}

let lastTipSrcEl = null; // element the visible tooltip is anchored to

function showTipFor(el, buildHtml, pinned) {
  lastTipSrcEl = el;
  const tip = $('spark-tip');
  tip.innerHTML =
    buildHtml() +
    (pinned ? `<div class="tip-pin">${t('currency.tip.pinned_hint')}</div>` : '');
  tip.classList.toggle('pinned', !!pinned);
  tip.classList.remove('hidden');
  positionTip(el);
}

let pinReleasedAt = 0; // hover-reshow cooldown after any release
let lastPinToggleAt = 0; // double-click flap guard

function unpinTip() {
  // whatever released the pin, the source cell must not hover-reshow until the
  // cursor genuinely leaves it and returns
  if (pinnedTipEl) pinnedTipEl._suppressHover = true;
  pinnedTipEl = null;
  pinReleasedAt = Date.now();
  const tip = $('spark-tip');
  tip.classList.remove('pinned');
  tip.classList.add('hidden');
}

let tipHideTimer = null;
let tipShowTimer = null;

function attachTip(el, buildHtml) {
  el.addEventListener('mouseenter', () => {
    if (pinnedTipEl) return; // a pinned tooltip stays put
    if (el._suppressHover) return; // just unpinned here: stay hidden until re-entry
    if (Date.now() - pinReleasedAt < 350) return; // release cooldown: no instant re-show
    clearTimeout(tipHideTimer);
    // hover-intent delay: brushing past a cell (e.g. reaching for the edit
    // button just past the arb % column) must NOT pop the tooltip over it
    clearTimeout(tipShowTimer);
    tipShowTimer = setTimeout(() => {
      if (pinnedTipEl || el._suppressHover) return;
      showTipFor(el, buildHtml, false);
    }, 240);
  });
  el.addEventListener('mouseleave', () => {
    el._suppressHover = false;
    clearTimeout(tipShowTimer); // cancel a pending hover-intent show
    if (pinnedTipEl) return;
    // grace period: moving the mouse INTO the tooltip keeps it open (see
    // tooltip's own mouseenter in main), so the copy button is reachable
    // without pinning
    clearTimeout(tipHideTimer);
    tipHideTimer = setTimeout(() => {
      if (!pinnedTipEl) $('spark-tip').classList.add('hidden');
    }, 220);
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(tipShowTimer); // a click pins immediately; drop any pending show
    if (Date.now() - lastPinToggleAt < 233) return; // swallow double-click flapping (was 350, -33%)
    lastPinToggleAt = Date.now();
    if (pinnedTipEl === el) {
      unpinTip();
      // releasing must LOOK released even though the cursor still hovers the
      // cell - suppress hover-reshow until the mouse leaves and returns
      el._suppressHover = true;
      return;
    }
    pinnedTipEl = el;
    showTipFor(el, buildHtml, true);
  });
}

// The tip is position:fixed - scrolling the list slides rows underneath a
// pinned tip, parking it over the very row it came from. Follow the anchor on
// any scroll (capture: #buckets scrolls don't bubble) and on resize; release
// the pin when its row scrolls out of view or was rebuilt away.
document.addEventListener('scroll', () => {
  const tip = $('spark-tip');
  if (tip.classList.contains('hidden')) return;
  const anchor = pinnedTipEl || lastTipSrcEl;
  if (!anchor) return;
  if (!anchor.isConnected) { unpinTip(); return; }
  const r = anchor.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) { unpinTip(); return; }
  positionTip(anchor);
}, true);
window.addEventListener('resize', () => {
  if (pinnedTipEl && pinnedTipEl.isConnected) positionTip(pinnedTipEl);
});

function attachSparkTip(el, series, itemText, baseText, baseIsExalt) {
  attachTip(el, () => sparkTooltipHtml(series, itemText, baseText, baseIsExalt));
}

// ---------- arbitrage route ----------
const MAJORS = ['exalted', 'chaos', 'divine', 'annul'];

// A pair rate is only trusted when it agrees with CURRENT smoothed prices to
// within this tolerance. Beyond it, the rate is last-fills data lagging the
// live market and gets flagged stale instead of driving any math.
const STALE_GAP_PCT = 25;
// Minimum traded volume for a pair to participate in route legs at all.
const MIN_LEG_VOLUME = 300;

// true when the pair's executed-trade rate is corroborated by current prices
function pairIsCurrent(aId, bId) {
  if (ovrRate(aId, bId) != null) return true; // user-entered rate: trusted by definition
  const v = pairVal(aId, bId);
  const a = catalog[aId];
  const b = catalog[bId];
  if (v == null || !a || !b || !(a.price > 0) || !(b.price > 0)) return false;
  const crossV = a.price / b.price;
  const gap = (Math.max(v, crossV) / Math.min(v, crossV) - 1) * 100;
  return gap < STALE_GAP_PCT;
}

// Parse a user-typed rate: plain number ("0.25"), fraction ("1/4"), or
// ratio ("1:4") - fraction and ratio both mean numerator/denominator.
function parseRate(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (s === '') return null;
  const frac = s.match(/^(\d*\.?\d+)\s*[/:]\s*(\d*\.?\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (isFinite(num) && isFinite(den) && num > 0 && den > 0) return num / den;
    return null;
  }
  const v = Number(s);
  return isFinite(v) && v > 0 ? v : null;
}

// manual override rate for the DIRECTED pair a->b (how many b for 1 a), if
// overrides are enabled and the user entered one; null otherwise
function ovrRate(a, b) {
  const o = config && config.overrides;
  // no enable gate: any rate the user has typed simply wins; blank uses market
  if (!o || !o.rates) return null;
  const v = o.rates[`${a}>${b}`];
  if (typeof v === 'number' && v > 0) return v;
  // one typed rate serves both directions; an explicit reverse entry wins above
  const inv = o.rates[`${b}>${a}`];
  if (typeof inv === 'number' && inv > 0) return 1 / inv;
  return null;
}

// When you pinned that rate. Your own numbers go stale exactly like the feed
// does - a rate typed three hours ago shouldn't keep looking authoritative.
// Stored in a PARALLEL map so every existing reader of .rates is untouched.
function ovrAt(a, b) {
  const o = config && config.overrides;
  if (!o || !o.ratesAt) return null;
  return o.ratesAt[`${a}>${b}`] || o.ratesAt[`${b}>${a}`] || null;
}
function ovrAgeStr(a, b) {
  const at = ovrAt(a, b);
  if (!at) return '';
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return t('currency.time.just_now');
  if (m < 60) return t('currency.time.minutes_ago', { count: m });
  const h = Math.floor(m / 60);
  return h < 24 ? t('currency.time.hours_ago', { count: h }) : t('currency.time.days_ago', { count: Math.floor(h / 24) });
}
const OVR_STALE_MS = 3 * 60 * 60 * 1000; // past this, a pinned rate needs a look
function ovrIsStale(a, b) {
  const at = ovrAt(a, b);
  return !!at && Date.now() - at > OVR_STALE_MS;
}

// single writer for manual rates - keeps the canonical direction and the
// timestamp in lockstep no matter which surface (Settings grid, bucket row,
// route tooltip, Arb tab) is doing the editing
function setOvrRate(a, b, rate) {
  config.overrides = config.overrides || { enabled: false, rates: {} };
  config.overrides.rates = config.overrides.rates || {};
  config.overrides.ratesAt = config.overrides.ratesAt || {};
  const fwd = `${a}>${b}`, rev = `${b}>${a}`;
  delete config.overrides.rates[rev];      // one canonical direction per pair
  delete config.overrides.ratesAt[rev];
  if (rate == null || !(rate > 0)) {
    delete config.overrides.rates[fwd];
    delete config.overrides.ratesAt[fwd];
  } else {
    config.overrides.rates[fwd] = rate;
    config.overrides.ratesAt[fwd] = Date.now();
    config.overrides.enabled = true;       // typing a rate turns overrides on
  }
  return window.api.setOverrides(config.overrides);
}

// value of 1 `a` expressed in `b`, from the direct pair snapshot (null if no pair)
function marketPairVal(a, b) {
  const pd = pairs[[a, b].sort().join('|')];
  if (!pd || !(pd[a] > 0) || !(pd[b] > 0)) return null;
  return pd[a] / pd[b];
}

// How much of the pair actually traded, per side. NOT derived from
// lowest_ratio/highest_ratio: those are raw extremes with no percentiles behind
// them, so one misclicked fill (seen live: an omen clearing at 224ex with a 5ex
// low) makes a pair look 45x more volatile than it trades. Volume can't be
// distorted that way.
function pairLiquidity(a, b) {
  const key = [a, b].sort().join('|');
  const pd = pairs[key];
  if (!pd) return null;
  // crossed storage: pd[a] holds the volume of b and vice versa
  const unitsOfA = pd[b], unitsOfB = pd[a];
  if (!(unitsOfA > 0) || !(unitsOfB > 0)) return null;
  return { units: unitsOfA, other: unitsOfB, hours: pd.__hours || 1 };
}

// the real current market rate for the grid: live order book first, then the
// direct executed pair, else the cross rate from exalt-denominated prices
function bestMarketRate(a, b) {
  const live = liveBookRate(a, b);
  if (live != null) return live;
  const direct = marketPairVal(a, b);
  if (direct != null) return direct;
  const pa = catalog[a] && catalog[a].price;
  const pb = catalog[b] && catalog[b].price;
  if (pa > 0 && pb > 0) return pa / pb;
  return null;
}

// effective pair value: the user's manual override wins, market otherwise
// a fresh live order-book rate beats the hourly executed digest: it is what Ange
// shows RIGHT NOW, and multi-leg arb can't afford hours-old averages
const LIVE_FRESH_MS = 10 * 60 * 1000;
// The live book is the TRADE SITE's bulk exchange - a different, far thinner
// market than the in-game Currency Exchange, and outside the majors it is
// dominated by price-fixing bait. Trust it only for major-to-major pairs, and
// only when it agrees with GGG's own executed-trade data to within a sane band;
// anything further apart means the book is being manipulated, not that the
// market moved.
const LIVE_SANITY_BAND = 0.35;
function liveBookRate(a, b) {
  if (!MAJORS.includes(a) || !MAJORS.includes(b)) return null;
  const li = liveInfo(a, b);
  if (!li || li.count < 3 || Date.now() - li.at >= LIVE_FRESH_MS) return null;
  const ref = marketPairVal(a, b); // GGG Currency Exchange, executed trades
  if (ref > 0 && Math.abs(li.rate - ref) / ref > LIVE_SANITY_BAND) return null;
  return li.rate;
}

function pairVal(a, b) {
  const ov = ovrRate(a, b);
  if (ov != null) return ov; // the user's number is law
  const live = liveBookRate(a, b);
  if (live != null) return live;
  return marketPairVal(a, b);
}

// Ange trades WHOLE items - there is no way to spend 1.3 divine - so a leg quoted as
// "1 divine -> 2.4 exalted" is not an instruction anyone can follow. Express the rate as
// the smallest whole-number ratio that still matches it, via continued-fraction
// convergents: 2.4 becomes "5 divine -> 12 exalted". Bounded by `maxDen` so the answer
// stays a tradeable size, and by `tol` so scaling up never quietly changes the rate.
function wholeRatio(rate, maxDen = 999, tol = 0.005) {
  if (!(rate > 0) || !Number.isFinite(rate)) return null;
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, x = rate;
  let bestP = null, bestQ = null;
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(x);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (k1 > maxDen) break;
    if (h1 >= 1 && k1 >= 1) {
      bestP = h1; bestQ = k1;
      if (Math.abs(h1 / k1 - rate) / rate <= tol) break;
    }
    const frac = x - a;
    if (frac < 1e-9) break;
    x = 1 / frac;
  }
  if (!(bestP >= 1) || !(bestQ >= 1)) return null;
  // never return a ratio we could not actually hit: quoting "1 -> 1" for a rate of
  // 1.0101 is a 1% lie in the user's favour, and they trade on it
  const err = Math.abs(bestP / bestQ - rate) / rate;
  if (err > tol) return null;
  return { from: bestQ, to: bestP, err };
}

function legStr(fromText, toText, ratePerFrom) {
  const r = wholeRatio(ratePerFrom);
  if (r) return `${fmtQty(r.from)} ${fromText} → ${fmtQty(r.to)} ${toText}`;
  // unrepresentable as a sane whole ratio - fall back to the old one-sided form
  if (ratePerFrom >= 1) return `1 ${fromText} → ${fmt(ratePerFrom)} ${toText}`;
  return `${fmt(1 / ratePerFrom)} ${fromText} → 1 ${toText}`;
}

function nameOf(apiId) {
  const c = catalog[apiId];
  // the feed is English-only; show the name the player's own client uses
  return window.gameName((c && c.text) || apiId);
}

function pairVol(a, b) {
  const pd = pairs[[a, b].sort().join('|')];
  return pd && pd.__vol > 0 ? pd.__vol : 0;
}

// Build the best 3-trade loop for an arb row. base/item are apiIds; direct = item's value in base.
// Middle currency chosen by LIQUIDITY (the thinnest leg's volume), not by paper ROI  - 
// stale illiquid pairs produce fantasy ROIs that no real order will ever fill.
// Ange charges a flat gold fee per ITEM RECEIVED, regardless of what you paid for it:
// buying 10 exalted costs 1,200g whether it cost you 10 divine or 10,000. So a loop's
// gold bill scales with the UNIT COUNT flowing through it, which is why routing size
// through a low-value currency drains gold - 37k exalted is ~4.4M gold on that leg
// alone. (Drew, in-game, 2026-08-04.)
const GOLD_PER_ITEM = 120;

// Gold + per-leg quantities for a route, starting from `qty` units of the base.
// Returns null when the route has no numeric rates (nothing to size).
function arbGoldPlan(route, qty) {
  if (!route || !route.legRates || !(qty > 0)) return null;
  const legs = [];
  let held = qty, gold = 0;
  for (let i = 0; i < route.legRates.length; i++) {
    const got = held * route.legRates[i];
    const g = Math.ceil(got) * GOLD_PER_ITEM; // you pay per whole item received
    gold += g;
    legs.push({ spent: held, got, gold: g, pair: route.legPairs[i] });
    held = got;
  }
  return { legs, gold, endsWith: held, profit: held - qty };
}

function buildArbRoute(baseId, itemId, direct, cross) {
  const below = direct < cross; // item cheap on the direct pair
  let best = null;
  for (const m of MAJORS) {
    if (m === baseId || m === itemId) continue;
    // Ange charges gold per unit traded: routing through exalted means moving
    // thousands of low-value units, which nukes gold. Let arbitragers exclude it.
    if (config.excludeExaltedArb && m === 'exalted') continue;
    const vXM = pairVal(itemId, m); // 1 item in m units
    const vMB = pairVal(m, baseId); // 1 m in base units
    if (!vXM || !vMB) continue;
    // every middle leg must be executable at CURRENT prices: its pair rate must
    // agree with the smoothed market and have real traded volume - otherwise
    // the loop's "profit" is stacked stale fills, not something you can trade
    if (!pairIsCurrent(itemId, m) || !pairIsCurrent(m, baseId)) continue;
    // overridden legs skip the volume floor - the user vouches for the rate
    const volXM = ovrRate(itemId, m) != null ? Infinity : pairVol(itemId, m);
    const volMB = ovrRate(m, baseId) != null ? Infinity : pairVol(m, baseId);
    const liq = Math.min(volXM, volMB);
    if (liq < MIN_LEG_VOLUME) continue;
    const final = below ? (1 / direct) * vXM * vMB : direct / (vMB * vXM);
    if (final <= 1.02) continue; // a route must PROFIT (>+2%) or it is not a route
    if (!best || liq > best.liq || (liq === best.liq && final > best.final)) {
      best = { m, vXM, vMB, final, liq };
    }
  }
  if (!best) return null;

  const B = nameOf(baseId);
  const X = nameOf(itemId);
  const M = nameOf(best.m);
  const steps = below
    ? [
        t('currency.arb.step_direct', { from: B, to: X, leg: legStr(B, X, 1 / direct) }),
        t('currency.arb.step_via', { from: X, to: M, leg: legStr(X, M, best.vXM) }),
        t('currency.arb.step_via', { from: M, to: B, leg: legStr(M, B, best.vMB) })
      ]
    : [
        t('currency.arb.step_via', { from: B, to: M, leg: legStr(B, M, 1 / best.vMB) }),
        t('currency.arb.step_via', { from: M, to: X, leg: legStr(M, X, 1 / best.vXM) }),
        t('currency.arb.step_direct', { from: X, to: B, leg: legStr(X, B, direct) })
      ];
  const legPairs = below
    ? [
        { have: baseId, want: itemId },
        { have: itemId, want: best.m },
        { have: best.m, want: baseId }
      ]
    : [
        { have: baseId, want: best.m },
        { have: best.m, want: itemId },
        { have: itemId, want: baseId }
      ];
  // Per-leg multiplier: units RECEIVED per unit spent on that leg. The product is
  // best.final, i.e. what 1 unit in becomes after the loop. Kept numeric (the `steps`
  // strings are display) so the gold estimate can size each leg.
  const legRates = below
    ? [1 / direct, best.vXM, best.vMB]
    : [1 / best.vMB, 1 / best.vXM, direct];
  return { below, middle: M, steps, legPairs, legRates, loopRoi: (best.final - 1) * 100 };
}

// ---------- live rates (GGG trade-site bulk listings) ----------
let liveRates = {}; // 'have|want' -> { best, median, count, at }

// rate of 1 a expressed in b from live listings, whichever direction we hold
function liveInfo(aId, bId) {
  const direct = liveRates[`${bId}|${aId}`]; // have b, want a: a-per-b -> invert
  const inverse = liveRates[`${aId}|${bId}`]; // have a, want b: b-per-a
  if (inverse && inverse.median) return { rate: inverse.median, count: inverse.count, at: inverse.at };
  if (direct && direct.median) return { rate: 1 / direct.median, count: direct.count, at: direct.at };
  return null;
}


// Cheapest way to acquire the base currency, paying with one of the majors.
function bestAcquire(baseId) {
  let best = null;
  for (const m of MAJORS) {
    if (m === baseId) continue;
    const vBM = pairVal(baseId, m); // 1 base in m units
    const mInfo = catalog[m];
    if (!vBM || !mInfo || !(mInfo.price > 0)) continue;
    if (!pairIsCurrent(baseId, m)) continue; // acquisition quote must be executable at current prices
    const costEx = vBM * mInfo.price;
    if (!best || costEx < best.costEx) best = { m, vBM, costEx };
  }
  return best;
}

// How much of this pair actually changed hands in the last hour. Volume is the
// one figure here that outliers can't distort: a single fat-fingered fill moves
// GGG's lowest_ratio by 45x but barely dents a 400k-unit total. It answers the
// question that matters before you commit to a rate - can this market absorb
// what I want to trade, or am I about to be the only order in it?
function volumeTooltipHtml(baseId, itemId, liq) {
  lastArbCtx = { baseId, itemId, pairOnly: true };
  const B = nameOf(baseId);
  const X = nameOf(itemId);
  const manual = ovrRate(itemId, baseId) != null;
  const deep = liq.units >= 500;
  const thin = liq.units < 50;
  return (
    `<div class="tip-head">${t('currency.tip.traded_last_hour')}</div>` +
    `<div class="tip-sub">${t('currency.tip.x_against_b', { item: esc(X), base: esc(B) })}</div>` +
    (manual ? `<div class="tip-step tip-manual"><span>✎</span><span>${t('currency.tip.manual_rate_note')}</span></div>` : '') +
    `<div class="tip-step"><span>·</span><span>${t('currency.tip.changed_hands', { units: fmtQty(liq.units), item: esc(X) })}</span></div>` +
    `<div class="tip-step"><span>·</span><span>${t('currency.tip.against_units', { units: fmtQty(liq.other), base: esc(B) })}</span></div>` +
    `<div class="tip-roi">` +
    (deep
      ? t('currency.tip.market_deep')
      : thin
        ? t('currency.tip.market_thin')
        : t('currency.tip.market_moderate')) +
    `</div>`
  );
}

let arbQty = 100; // starting size for the gold estimate; session-only, per-tooltip edit
let lastArbCopyText = ''; // plain-text version of the last-shown route, for the copy button
let lastArbCtx = null; // route context for the live check button

function arbTooltipHtml(baseId, itemId, direct, cross, gapPct) {
  const B = nameOf(baseId);
  const X = nameOf(itemId);
  const route = buildArbRoute(baseId, itemId, direct, cross);
  const acq = bestAcquire(baseId);
  lastArbCtx = { baseId, itemId, route, acq };

  const headText = route
    ? t('currency.arb.route_head', { sign: route.loopRoi >= 0 ? '+' : '', pct: route.loopRoi.toFixed(1) })
    : t('currency.arb.gap_head', { pct: gapPct.toFixed(1) });
  const subText = t('currency.arb.sub', { item: X, direct: fmt(direct), cross: fmt(cross), baseAbbr: abbr(nameOf(baseId)) || '' });

  let html =
    `<div class="tip-head tip-head-row"><span>${esc(headText)}</span><span class="tip-head-btns">` +
    `<button class="tip-fix" title="${t('currency.arb.fix_rate_btn_title')}">${t('currency.arb.fix_rate_btn')}</button>` +
    `<button class="tip-copy" title="${t('currency.arb.copy_route_btn_title')}">${t('currency.arb.copy_route_btn')}</button></span></div>` +
    `<div class="tip-sub">${esc(subText)}</div>`;

  const lines = [t('currency.arb.copy_prefix', { headline: headText }), subText.trim()];
  let n = 1;
  const acqLine = t('currency.arb.acquire_base', { base: B }) + (acq ? t('currency.arb.acquire_cheapest_suffix', { leg: legStr(nameOf(acq.m), B, 1 / acq.vBM) }) : '');
  html += `<div class="tip-step"><span>${n}.</span><span>${esc(acqLine)}</span></div>`;
  lines.push(`${n}. ${acqLine}`);
  n++;

  if (route) {
    for (const s of route.steps) {
      html += `<div class="tip-step"><span>${n}.</span><span>${esc(s)}</span></div>`;
      lines.push(`${n}. ${s}`);
      n++;
    }
    const roiVars = { sign: route.loopRoi >= 0 ? '+' : '', pct: route.loopRoi.toFixed(1) };
    const roiLine = t('currency.arb.loop_roi', roiVars).replace(/<\/?b>/g, '');
    html +=
      `<div class="tip-roi">${t('currency.arb.loop_roi', roiVars).replace('<b>', `<b class="${route.loopRoi >= 0 ? 'up' : 'down'}">`)}</div>`;
    lines.push(roiLine);

    // Gold cost. A route can be +12% and still stall halfway because the gold ran out,
    // which is exactly what one user hit: ~5M gold to move 37k exalted. The size box
    // lets you check the bill BEFORE starting rather than discovering it mid-loop.
    const plan = arbGoldPlan(route, arbQty);
    if (plan) {
      const goldClass = plan.gold >= 1000000 ? 'down' : '';
      html += `<div class="tip-gold">`
        + `<span class="tip-gold-lab">${esc(t('currency.arb.gold_size_label'))}</span>`
        + `<input class="tip-gold-qty" type="text" inputmode="numeric" value="${esc(String(arbQty))}" `
        + `title="${esc(t('currency.arb.gold_size_tooltip'))}">`
        + `<span class="tip-gold-unit">${esc(abbr(nameOf(baseId)) || nameOf(baseId))}</span>`
        + `<span class="tip-gold-cost">${t('currency.arb.gold_cost', { gold: fmtQty(plan.gold) }).replace('<b>', `<b class="${goldClass}">`)}</span>`
        + `</div>`;
      html += `<div class="tip-step"><span>·</span><span class="tip-dim2 tip-gold-ret">`
        + esc(t('currency.arb.gold_returns', {
            end: fmtQty(Math.round(plan.endsWith)),
            unit: abbr(nameOf(baseId)) || nameOf(baseId),
            profit: (plan.profit >= 0 ? '+' : '') + fmtQty(Math.round(plan.profit)),
          }))
        + `</span></div>`;
      lines.push(t('currency.arb.gold_cost', { gold: fmtQty(plan.gold) }).replace(/<\/?b>/g, ''));
    }
    // The loop is only as executable as its THINNEST leg - the rate on a pair
    // that barely trades is a couple of fills, not a market you can move size
    // into. (Volume, not GGG's ratio extremes: one misclicked fill distorts
    // those wildly, volume it can't touch.)
    let thin = null;
    for (const lp of route.legPairs) {
      const lq = pairLiquidity(lp.have, lp.want);
      if (lq && (!thin || lq.units < thin.lq.units)) thin = { pa: lp.have, pb: lp.want, lq };
    }
    if (thin) {
      const legTxt = `${abbr(nameOf(thin.pa))}→${abbr(nameOf(thin.pb))}`;
      const few = thin.lq.units < 50;
      const note = few
        ? t('currency.tip.leg_barely_trades')
        : t('currency.tip.leg_enough_volume');
      html += `<div class="tip-step"><span>·</span><span class="tip-dim2">`
        + t('currency.tip.thinnest_leg', { leg: esc(legTxt), units: fmtQty(thin.lq.units), note: esc(note) })
          .replace('<b>', `<b class="${few ? 'down' : 'up'}">`)
        + `</span></div>`;
      lines.push(t('currency.tip.thinnest_leg', { leg: legTxt, units: fmtQty(thin.lq.units), note }).replace(/<\/?b>/g, '').replace(/\.$/, ''));
    }
  } else {
    const line = direct < cross
      ? t('currency.arb.buy_direct', { item: X, base: B, pct: gapPct.toFixed(1) })
      : t('currency.arb.sell_direct', { item: X, base: B, pct: gapPct.toFixed(1) });
    html +=
      `<div class="tip-step"><span>${n}.</span><span>${esc(line)}</span></div>` +
      `<div class="tip-roi">${t('currency.arb.no_route_html', { pct: gapPct.toFixed(1) })}</div>`;
    lines.push(`${n}. ${line}`, t('currency.arb.no_route_plain', { pct: gapPct.toFixed(1) }));
  }
  lastArbCopyText = lines.join('\n').replace(/→/g, '->');
  html += `<div class="tip-out"></div>`;
  return html;
}

// One-click correction straight from the route: the feed is hourly and can lag a
// fast market, so typing the number you can actually see in game beats arguing
// with the data. Writes the same manual override the Settings grid uses.
function openRateFix() {
  const tip = $('spark-tip');
  if (!lastArbCtx || !tip) return;
  const out = tip.querySelector('.tip-out');
  if (!out) return;
  const legs = [];
  const seen = new Set();
  const addLeg = (a, b) => {
    const k = [a, b].sort().join('|');
    if (a === b || seen.has(k)) return;
    seen.add(k);
    legs.push({ a, b });
  };
  if (lastArbCtx.acq) addLeg(lastArbCtx.acq.m, lastArbCtx.baseId);
  for (const lp of (lastArbCtx.route && lastArbCtx.route.legPairs) || []) addLeg(lp.have, lp.want);
  if (!legs.length) addLeg(lastArbCtx.itemId, lastArbCtx.baseId);

  let h = `<div class="tip-sec"><div class="tip-sec-head">${t('currency.arb.fix_rate_header')}</div>`;
  for (let i = 0; i < legs.length; i++) {
    const { a, b } = legs[i];
    const cur = pairVal(a, b);
    h += `<div class="tip-step tip-fix-row"><span>·</span><span>1 ${esc(abbr(nameOf(a)) || nameOf(a))} = `
      + `<input class="tip-fix-in" data-a="${esc(a)}" data-b="${esc(b)}" value="${cur > 0 ? fmt(cur) : ''}" `
      + `placeholder="?" /> ${esc(abbr(nameOf(b)) || nameOf(b))}</span></div>`;
  }
  h += `<div class="tip-step"><span>·</span><span class="tip-dim2">${t('currency.arb.fix_rate_help')}</span></div></div>`;
  out.innerHTML = h;
  const first = out.querySelector('.tip-fix-in');
  if (first) { first.focus(); first.select(); }
  for (const inp of out.querySelectorAll('.tip-fix-in')) {
    inp.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      await setOvrRate(inp.dataset.a, inp.dataset.b, parseRate(inp.value));
      inp.classList.add('saved');
      render();
    });
  }
}

let lastDataSig = '';
async function refresh(force) {
  if (refreshing) return;
  refreshing = true;
  $('btn-refresh').style.opacity = '0.4';
  let dataChanged = true;
  if (force) window.api.checkUpdates(); // manual refresh doubles as an update check
  try {
    const res = await window.api.fetchPrices(force);
    if (res.error) {
      showStatus(t('currency.status.fetch_failed', { error: res.error }));
    } else {
      catalog = res.catalog;
      pairs = res.pairs || {};
      league = res.league;
      fetchedAt = res.fetchedAt;
      // skip the re-render (and its visible repaint) when nothing actually changed,
      // e.g. reopening the overlay within the fetch-cache window
      const sig = JSON.stringify([res.league, res.catalog, res.pairs]);
      dataChanged = sig !== lastDataSig;
      lastDataSig = sig;
      showStatus(res.errors && res.errors.length ? t('currency.status.partial_data', { errors: res.errors.join('; ') }) : null);
    }
  } catch (err) {
    showStatus(t('currency.status.fetch_failed', { error: err.message }));
  }
  refreshing = false;
  $('btn-refresh').style.opacity = '';
  if (dataChanged) render();
  else updateMeta();
  updateFeedStatus(); // the pair source (GGG exchange vs poe2scout) is known post-fetch
}

function showStatus(msg) {
  const el = $('status');
  if (!msg) {
    el.classList.add('hidden');
  } else {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

// ---------- rendering ----------
function updateMeta() {
  // league is a pill chip now - just the name, no leading dot (empty => hidden via :empty)
  $('league-label').textContent = league || '';
  // visible freshness text left of the icon buttons, plus the refresh tooltip
  const fresh = fetchedAt ? timeAgo(fetchedAt) : '';
  const fl = $('fresh-label');
  if (fl) fl.textContent = fresh;
  $('btn-refresh').title = fetchedAt ? t('currency.footer.refresh_title_updated', { time: timeAgo(fetchedAt) }) : t('currency.footer.refresh_title');
}

let renderToken = 0;

function clearDropMarkers() {
  document.querySelectorAll('.row.drop-before, .row.drop-after, .bucket.drop-before, .bucket.drop-after')
    .forEach((r) => r.classList.remove('drop-before', 'drop-after'));
}

// bucket-card drag (header grab). Separate from dragState, which tracks the
// payment-row drag inside a bucket - the two must never be confused.
let bucketDrag = null;

// Move a whole bucket card above or below another. config.buckets order IS the
// display order, so this is a splice + persist.
function moveBucket(fromId, targetId, after) {
  if (!fromId || fromId === targetId) return;
  const arr = (config.buckets || []).filter((b) => b.id !== fromId);
  const moved = (config.buckets || []).find((b) => b.id === fromId);
  const i = arr.findIndex((b) => b.id === targetId);
  if (!moved || i < 0) return;
  arr.splice(after ? i + 1 : i, 0, moved);
  config.buckets = arr;
  logAction(`bucket moved: ${moved.base.apiId}`);
  persistBuckets();
  render();
}

// Move a currency row within its bucket (never across buckets - the caller only
// invokes this when source and target share bucketId). Persists + re-renders.
function reorderWithinBucket(bucketId, fromApiId, toApiId, after) {
  if (fromApiId === toApiId) return;
  const bucket = (config.buckets || []).find((b) => b.id === bucketId);
  if (!bucket || !Array.isArray(bucket.items)) return;
  const items = bucket.items;
  const fromIdx = items.findIndex((x) => x.apiId === fromApiId);
  const targetIdx = items.findIndex((x) => x.apiId === toApiId);
  if (fromIdx < 0 || targetIdx < 0) return;
  const [moved] = items.splice(fromIdx, 1);
  // recompute the target index after removal, then insert before/after it
  let insertAt = items.findIndex((x) => x.apiId === toApiId);
  if (after) insertAt += 1;
  items.splice(insertAt, 0, moved);
  window.api.saveBuckets(config.buckets);
  logAction(`reorder ${fromApiId} within ${bucket.base.apiId}`);
  render();
}

// Remove a currency from its bucket. Shared by the row X and the drag-out-of-bucket
// gesture. Confirms first (with a "don't ask again this session" checkbox) unless
// the user already opted out this session. skipRemoveConfirm is a module var, so it
// resets naturally on every app restart / update.
async function removeCurrencyPair(bucket, apiId) {
  if (!bucket || !Array.isArray(bucket.items) || !bucket.items.some((x) => x.apiId === apiId)) return;
  if (!skipRemoveConfirm) {
    const res = await confirmDialog(
      t('currency.confirm.remove_payment', { item: nameOf(apiId) || apiId, base: nameOf(bucket.base.apiId) || t('currency.common.bucket_fallback') }),
      { confirmLabel: t('currency.common.remove'), danger: true, checkboxLabel: t('currency.confirm.dont_ask_again') });
    if (!res.confirmed) { render(); return; } // re-render drops any leftover drag markers
    if (res.dontAsk) skipRemoveConfirm = true;
  }
  bucket.items = bucket.items.filter((x) => x.apiId !== apiId);
  logAction(`remove pair ${apiId} from ${bucket.base.apiId}`);
  persistBuckets();
  render();
}

function render() {
  unpinTip(); // rebuilt DOM invalidates the pinned element
  updateMeta();

  // Build the new content off-screen and swap it in atomically AFTER all icons
  // have decoded - rebuilding in place recreates every <img>, whose async decode
  // makes icons blink out for a frame (the reopen "flicker").
  const container = document.createDocumentFragment();

  for (const bucket of config.buckets) {
    const base = itemInfo(bucket.base);
    const el = document.createElement('div');
    el.className = 'bucket';
    el.dataset.base = bucket.base.apiId;

    const collapsed = !!bucket.collapsed;
    if (collapsed) el.classList.add('collapsed');
    const head = document.createElement('div');
    head.className = 'bucket-head';
    // drag the card by its header to reorder the buckets themselves (the grip
    // inside a row reorders payments WITHIN a bucket - different drag, see below)
    head.draggable = true;
    head.addEventListener('dragstart', (e) => {
      bucketDrag = bucket.id;
      el.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', bucket.id);
        e.dataTransfer.setDragImage(el, 24, 14);
      } catch {}
    });
    head.addEventListener('dragend', () => { el.classList.remove('dragging'); clearDropMarkers(); bucketDrag = null; });
    el.addEventListener('dragover', (e) => {
      if (!bucketDrag || bucketDrag === bucket.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = el.getBoundingClientRect();
      clearDropMarkers();
      el.classList.add((e.clientY - r.top) > r.height / 2 ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (e) => {
      if (!bucketDrag || bucketDrag === bucket.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      moveBucket(bucketDrag, bucket.id, (e.clientY - r.top) > r.height / 2);
      clearDropMarkers();
      bucketDrag = null;
    });
    const bucketTip = () => {
      let h = `<div class="tip-head">${esc(base.text)}</div>`;
      h += `<div class="tip-sub">${t('currency.tip.bucket_sub')}</div>`;
      if (base.price != null) h += `<div class="tip-step"><span>·</span><span>${t('currency.tip.current_value', { amount: fmt(base.price), divAside: window.divAsideHtml(base.price, 'exalted') })}</span></div>`;
      h += `<div class="tip-step"><span>·</span><span>${t('currency.tip.bucket_rows_hint')}</span></div>`;
      h += `<div class="tip-step"><span>·</span><span>${t('currency.tip.bucket_best_hint', { base: esc(base.text) })}</span></div>`;
      return h;
    };
    // header: [chevron] [icon] Name  buying  ->  [+ payment]  [x]
    // ("buying" carries margin-right:auto, pushing the buttons to the right)
    const chev = document.createElement('button');
    chev.className = 'bucket-chev';
    chev.title = collapsed ? t('currency.bucket.expand_title') : t('currency.bucket.collapse_title');
    chev.textContent = collapsed ? '▸' : '▾';
    chev.addEventListener('click', () => {
      bucket.collapsed = !collapsed;
      logAction(`bucket ${bucket.base.apiId} ${bucket.collapsed ? 'collapsed' : 'expanded'}`);
      persistBuckets();
      render();
    });
    head.appendChild(chev);
    if (base.icon) {
      const img = document.createElement('img');
      img.src = base.icon;
      attachTip(img, bucketTip);
      head.appendChild(img);
    }
    const title = document.createElement('span');
    title.className = 'bucket-title';
    title.textContent = base.text;
    attachTip(title, bucketTip);
    head.appendChild(title);
    const buyLab = document.createElement('span');
    buyLab.className = 'bucket-buy';
    buyLab.textContent = t('currency.bucket.buying_label');
    head.appendChild(buyLab);

    const addBtn = document.createElement('button');
    addBtn.className = 'bucket-add';
    addBtn.title = t('currency.bucket.add_payment_title');
    addBtn.textContent = t('currency.bucket.add_payment');
    addBtn.addEventListener('click', () => openPicker({ type: 'add-item', bucketId: bucket.id }));
    head.appendChild(addBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'bucket-del';
    delBtn.title = t('currency.bucket.remove_title', { base: base.text });
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', async () => {
      const n = bucket.items.length;
      const ok = await confirmDialog(
        t('currency.confirm.remove_bucket', { base: base.text, payment_suffix: n ? ` and its ${n} payment${n === 1 ? '' : 's'}` : '' }),
        { confirmLabel: t('currency.common.remove'), danger: true });
      if (!ok) return;
      config.buckets = config.buckets.filter((b) => b.id !== bucket.id);
      logAction(`remove bucket ${bucket.base.apiId}`);
      persistBuckets();
      render();
    });
    head.appendChild(delBtn);
    el.appendChild(head);

    // column-label strip: mirrors the .row grid so Trend/Price/Vol/Arb sit above
    // their cells - the columns become self-documenting instead of needing the
    // tour to name them. Only rendered when there are payment rows to label.
    if (bucket.items.length && !collapsed) {
      const cols = document.createElement('div');
      cols.className = 'bucket-cols';
      cols.innerHTML =
        '<span></span>' +
        '<span></span>' +
        `<span>${t('currency.bucket.col_pay_with')}</span>` +
        `<span>${t('currency.bucket.col_trend')}</span><span>${t('currency.bucket.col_price')}</span><span>${t('currency.bucket.col_vol')}</span><span>${t('currency.bucket.col_arb')}</span><span></span>`;
      el.appendChild(cols);
    }

    // Best value: bucket base = what you BUY, rows = what you PAY with.
    // Effective cost of 1 base in exalts when paying with item X, via the direct pair.
    const payCosts = {};
    for (const ref of bucket.items) {
      const live = catalog[ref.apiId];
      const baseLive = catalog[bucket.base.apiId];
      const ov = ovrRate(ref.apiId, bucket.base.apiId);
      const directRate = ov != null ? ov : marketPairVal(ref.apiId, bucket.base.apiId); // base units per 1 item
      if (directRate > 0 && live && live.price > 0) {
        // exclude stale pairs (direct rate wildly off the smoothed cross rate) -
        // they produce phantom "cheapest" routes at prices that no longer exist.
        // Manual overrides are exempt: the user vouches for their own rate.
        if (ov == null && baseLive && baseLive.price > 0) {
          const crossRate = live.price / baseLive.price;
          const gapPct = (Math.max(directRate, crossRate) / Math.min(directRate, crossRate) - 1) * 100;
          if (gapPct >= STALE_GAP_PCT) continue;
        }
        payCosts[ref.apiId] = (1 / directRate) * live.price;
      }
    }
    const evaluable = Object.keys(payCosts);
    const bestPay =
      evaluable.length >= 2
        ? evaluable.reduce((a, b) => (payCosts[a] <= payCosts[b] ? a : b))
        : null;

    // Collapsed: the rows go away but the ANSWER stays - which payment is
    // cheapest right now and what it costs. A collapsed bucket you can't read is
    // just a hidden bucket.
    if (collapsed) {
      const sum = document.createElement('span');
      sum.className = 'bucket-sum';
      if (bestPay) {
        const bi = itemInfo(bucket.items.find((r) => r.apiId === bestPay) || { apiId: bestPay });
        sum.innerHTML = t('currency.bucket.collapsed_best', { item: esc(bi.text), cost: fmt(payCosts[bestPay]), divAside: base.apiId === 'divine' ? '' : window.divAsideHtml(payCosts[bestPay], 'exalted') });
        sum.title = t('currency.bucket.collapsed_best_title', { base: base.text });
      } else {
        const n = bucket.items.length;
        sum.textContent = n ? tn('currency.bucket.payment_count', n, { count: n }) : t('currency.bucket.no_payments');
      }
      head.insertBefore(sum, addBtn);
    }

    for (const ref of (collapsed ? [] : bucket.items)) {
      const it = itemInfo(ref);
      const isBest = bestPay && ref.apiId === bestPay;
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.item = ref.apiId;
      if (isBest) row.classList.add('best');

      // drag-to-reorder handle (leftmost column). Reorders rows WITHIN this bucket
      // only - see dragState guard on bucket.id in the row drop handler below.
      const handle = document.createElement('span');
      handle.className = 'row-drag';
      handle.textContent = '⠿'; // braille 6-dot grip
      handle.title = t('currency.row.drag_title');
      handle.setAttribute('aria-label', t('currency.row.drag_title'));
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
        dragState = { bucketId: bucket.id, apiId: ref.apiId };
        dragReordered = false;
        row.classList.add('dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', ref.apiId);
          e.dataTransfer.setDragImage(row, 24, row.offsetHeight / 2);
        } catch {}
      });
      handle.addEventListener('dragend', () => { row.classList.remove('dragging'); clearDropMarkers(); dragState = null; });
      row.appendChild(handle);

      // drop target: only reacts to a drag from the SAME bucket
      row.addEventListener('dragover', (e) => {
        if (!dragState || dragState.bucketId !== bucket.id || dragState.apiId === ref.apiId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = row.getBoundingClientRect();
        const after = (e.clientY - r.top) > r.height / 2;
        clearDropMarkers();
        row.classList.add(after ? 'drop-after' : 'drop-before');
      });
      row.addEventListener('dragleave', () => { row.classList.remove('drop-before', 'drop-after'); });
      row.addEventListener('drop', (e) => {
        if (!dragState || dragState.bucketId !== bucket.id) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const after = (e.clientY - r.top) > r.height / 2;
        dragReordered = true; // consumed as an in-bucket reorder, not a drop-outside
        reorderWithinBucket(bucket.id, dragState.apiId, ref.apiId, after);
        clearDropMarkers();
      });

      // rates computed up front so every column's tooltip can reference them
      const cross =
        it.price != null && base.price != null && base.price > 0 && it.price > 0
          ? it.price / base.price
          : null;
      const ovDirect = ovrRate(ref.apiId, bucket.base.apiId);
      const marketDirect = marketPairVal(ref.apiId, bucket.base.apiId);
      const direct = ovDirect != null ? ovDirect : marketDirect;
      const isManual = ovDirect != null;

      // vs-best badge: best row shows savings over the runner-up, others show their penalty
      let payBadge = null;
      if (payCosts[ref.apiId] != null && bestPay && evaluable.length >= 2) {
        if (isBest) {
          const next = Math.min(...evaluable.filter((id) => id !== bestPay).map((id) => payCosts[id]));
          payBadge = { pct: (next / payCosts[bestPay] - 1) * 100, good: true };
        } else {
          payBadge = { pct: (payCosts[ref.apiId] / payCosts[bestPay] - 1) * 100, good: false };
        }
      }

      const itemTip = () => {
        let h = `<div class="tip-head">${esc(it.text)}</div>`;
        const catLabel = (catalog[ref.apiId] && catalog[ref.apiId].category) || ref.category || '';
        h += `<div class="tip-sub">${esc(catLabel)}${isBest ? ' ' + t('currency.tip.best_value_suffix') : ''}</div>`;
        if (it.price != null) h += `<div class="tip-step"><span>·</span><span>${t('currency.tip.exalt_value', { amount: fmt(it.price), divAside: window.divAsideHtml(it.price, 'exalted') })}</span></div>`;
        if (cross != null) h += `<div class="tip-step"><span>·</span><span>${t('currency.tip.value_in_base', { base: esc(base.text), amount: fmt(cross) })}</span></div>`;
        if (payCosts[ref.apiId] != null) {
          // no "(1.0 div)" when the base IS divine - that's tautology, not help
          const costAside = base.apiId === 'divine' ? '' : window.divAsideHtml(payCosts[ref.apiId], 'exalted');
          h += `<div class="tip-step"><span>·</span><span>${t('currency.tip.buying_cost', { base: esc(base.text), amount: fmt(payCosts[ref.apiId]), divAside: costAside })}</span></div>`;
          if (payBadge) {
            h += payBadge.good
              ? `<div class="tip-step"><span>·</span><span>${t('currency.tip.cheapest_badge', { pct: payBadge.pct.toFixed(1) })}</span></div>`
              : `<div class="tip-step"><span>·</span><span>${t('currency.tip.expensive_badge', { pct: payBadge.pct.toFixed(1) })}</span></div>`;
          }
        }
        return h;
      };

      const img = document.createElement('img');
      if (it.icon) img.src = it.icon;
      else img.style.visibility = 'hidden';
      attachTip(img, itemTip);
      row.appendChild(img);

      const name = document.createElement('span');
      name.className = 'name';
      const nameText = document.createElement('span');
      nameText.className = 'name-text';
      nameText.textContent = shortName(it.text);
      name.appendChild(nameText);
      attachTip(name, itemTip);
      if (isBest) {
        // best row: one green "BEST +x%" pill (savings over the runner-up)
        const chip = document.createElement('span');
        chip.className = 'best-chip';
        chip.textContent = payBadge
          ? t('currency.row.best_chip_pct', { pct: payBadge.pct.toFixed(payBadge.pct >= 10 ? 0 : 1) })
          : t('currency.row.best_chip');
        chip.title = t('currency.row.best_chip_title', { base: bucket.base.text || bucket.base.apiId });
        name.appendChild(chip);
      } else if (payBadge) {
        // other rows: dim red penalty vs the best row
        const b = document.createElement('span');
        b.className = 'pay-pct bad';
        b.textContent = `−${payBadge.pct.toFixed(payBadge.pct >= 10 ? 0 : 1)}%`;
        name.appendChild(b);
      }
      row.appendChild(name);

      // 7d price history sparkline + delta
      const sparkCell = document.createElement('span');
      sparkCell.className = 'spark';
      const series = buildSeries(ref, bucket.base);
      if (series) {
        sparkCell.appendChild(makeSpark(series));
        const delta = ((series.last.v - series.first.v) / series.first.v) * 100;
        const dl = document.createElement('span');
        dl.className = 'delta ' + (delta >= 0 ? 'up' : 'down');
        dl.textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1) + '%';
        sparkCell.appendChild(dl);
        attachSparkTip(sparkCell, series, it.text, base.text, bucket.base.apiId === 'exalted');
      } else {
        sparkCell.title = t('currency.row.no_history_title');
      }
      row.appendChild(sparkCell);

      const main = document.createElement('span');
      main.className = 'rate-main';
      const gapCol = document.createElement('span');
      gapCol.className = 'gap-col';
      const arbCol = document.createElement('span');
      arbCol.className = 'arb-col';

      if (cross != null || direct != null) {
        // The DIRECT pair is the real market - GGG's executed trades on exactly
        // this pair. `cross` is only an estimate (each side's exalt price
        // divided) and belongs as a fallback, not the headline. Showing both
        // side by side made them read as a bid/ask spread, which they never
        // were: they're two guesses at one number, and we were leading with the
        // weaker one.
        const shown = direct != null ? direct : cross;
        main.textContent = fmt(shown);
        // persistent 9px sub-line: the inverse ratio when the rate is < 1,
        // otherwise the pay-currency unit ("chaos each")
        const sub = document.createElement('span');
        sub.className = 'main-ratio';
        if (shown > 0 && shown < 1) {
          sub.textContent = `1 : ${fmt(1 / shown)}`;
        } else {
          const unit = abbr(it.text) || shortName(it.text).toLowerCase();
          sub.textContent = t('currency.row.unit_each', { unit });
        }
        main.appendChild(sub);
        attachTip(main, () => {
          const b = abbr(base.text) || '';
          const it2 = shortName(it.text);
          const src = isManual ? t('currency.tip.rate_source_manual')
            : direct != null ? t('currency.tip.rate_source_exchange')
              : t('currency.tip.rate_source_estimated', { exalted: esc(nameOf('exalted')) });
          // when the price is <1, the inverse (pay-currency per 1 of what you're
          // buying) is the number people actually want - lead with it, show both
          const head = shown > 0 && shown < 1
            ? `<div class="tip-head">${t('currency.tip.value_per_one', { value: fmt(1 / shown), currencyX: esc(it2), currencyY: esc(b) })}</div>` +
              `<div class="tip-sub">${t('currency.tip.value_per_one', { value: fmt(shown), currencyX: esc(b), currencyY: esc(it2) })}</div>`
            : `<div class="tip-head">${t('currency.tip.value_per_one', { value: fmt(shown), currencyX: esc(b), currencyY: esc(it2) })}</div>`;
          return head + `<div class="tip-step"><span>·</span><span class="tip-dim2">${t('currency.tip.rate_source_line', { src })}</span></div>`;
        });
        if (direct != null && cross != null) {
          // no second ratio in the row: it was the same price from a weaker
          // source, and side by side the pair read as a bid/ask that does not
          // exist. The disagreement still matters when it is LARGE - that is
          // the stale-rate warning below - but as a number it only confused.
          const baseId = bucket.base.apiId;
          const itemId = ref.apiId;
          const gap = (Math.max(direct, cross) / Math.min(direct, cross) - 1) * 100;
          // Past ~40% the "gap" is almost never arbitrage - it's the direct
          // pair's executed-trade rate lagging a fast-moving market (thin pairs
          // keep quoting the last fills long after the orderbook moved on).
          const stale = !isManual && gap >= STALE_GAP_PCT;
          const hot = gap >= 3 && !stale;
          if (isManual) {
            gapCol.classList.add('manual');
            main.classList.add('manual');
          }
          if (stale) {
            gapCol.textContent = '⚠';
            gapCol.classList.add('stale');
            main.classList.add('stale');
            const staleTip = () => {
              lastArbCtx = { baseId, itemId, pairOnly: true };
              return `<div class="tip-head">${t('currency.tip.stale_head')}</div>` +
              `<div class="tip-sub">${t('currency.tip.stale_sub', { item: esc(nameOf(itemId)), base: esc(nameOf(baseId)) })}</div>` +
              `<div class="tip-step"><span>·</span><span>${t('currency.tip.stale_smoothed', { value: fmt(cross) })}</span></div>` +
              `<div class="tip-step"><span>·</span><span>${t('currency.tip.stale_direct', { value: fmt(direct) })}</span></div>` +
              `<div class="tip-roi">${t('currency.tip.stale_explanation', { pct: gap.toFixed(0) })}</div>`;
            };
            attachTip(gapCol, staleTip);
          } else {
            // Volume, not "market gap" and not a swing %. The gap compared the
            // direct pair to a blended cross rate - true but unactionable. The
            // swing read GGG's ratio extremes, which one misclick distorts
            // wildly. Volume is the honest third option: it says whether the
            // rate above is backed by a real market you can trade into.
            const liq = pairLiquidity(itemId, baseId);
            if (liq) {
              gapCol.textContent = fmtQty(liq.units);
              if (liq.units >= 500) gapCol.classList.add('hot');
              const volTip = () => volumeTooltipHtml(baseId, itemId, liq);
              attachTip(gapCol, volTip);
            } else {
              gapCol.textContent = '';
              gapCol.title = t('currency.row.no_volume_title');
            }
          }
          if (hot) {
            const route = buildArbRoute(baseId, itemId, direct, cross);
            if (route) {
              const r = route.loopRoi;
              arbCol.textContent = (r >= 0 ? '+' : '') + r.toFixed(Math.abs(r) >= 10 ? 0 : 1) + '%';
              if (r >= 3) arbCol.classList.add('hot');
              attachTip(arbCol, () => arbTooltipHtml(baseId, itemId, direct, cross, gap));
            } else {
              arbCol.textContent = ' - ';
              arbCol.title = t('currency.row.no_route_title');
            }
          }
        }
      } else {
        main.textContent = ' - ';
      }
      row.appendChild(main);
      row.appendChild(gapCol);
      row.appendChild(arbCol);

      const actions = document.createElement('span');
      actions.className = 'row-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'row-edit';
      editBtn.textContent = '✎';
      editBtn.title = isManual
        ? t('currency.row.edit_rate_title_manual')
        : t('currency.row.edit_rate_title_default');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const openEditor = () => startInlineOverride(row, ref, bucket.base, direct != null ? direct : cross);
        if (!isManual) { openEditor(); return; }
        // a manual rate already drives this row: offer edit or clear instead of
        // dropping straight into the editor
        showOvrMenu(editBtn, openEditor, async () => {
          try {
            await setOvrRate(ref.apiId, bucket.base.apiId, null);
            render();
          } catch {}
        });
      });
      actions.appendChild(editBtn);
      const del = document.createElement('button');
      del.className = 'row-del';
      del.title = t('currency.row.remove_title');
      del.textContent = '✕';
      del.addEventListener('click', () => removeCurrencyPair(bucket, ref.apiId));
      actions.appendChild(del);
      row.appendChild(actions);
      if (isManual) row.classList.add('has-ovr');

      el.appendChild(row);
    }

    container.appendChild(el);
  }

  if (!config.buckets || config.buckets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'buckets-empty';
    empty.textContent = t('currency.bucket.empty_state');
    container.appendChild(empty);
  }

  const token = ++renderToken;
  const imgs = Array.from(container.querySelectorAll('img'));
  const allDecoded = Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
  // don't let a slow icon hold the UI hostage; 250ms then swap regardless
  Promise.race([allDecoded, new Promise((r) => setTimeout(r, 250))]).then(() => {
    if (token === renderToken) $('buckets').replaceChildren(container);
  });
}

function abbr(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('exalted')) return 'ex';
  if (t.includes('divine')) return 'div';
  if (t.includes('chaos orb')) return 'chaos';
  if (t.includes('annul')) return 'annul';
  if (t.includes('mirror')) return 'mirror';
  if (t.includes('vaal orb')) return 'vaal';
  if (t.includes('regal orb')) return 'regal';
  if (t.includes('alchemy')) return 'alch';
  if (t.startsWith('omen')) return 'omen';
  if (t.includes('essence')) return 'ess';
  return '';
}

function persistBuckets() {
  window.api.saveBuckets(config.buckets);
}

// ---------- picker ----------
async function openPicker(mode) {
  pickerMode = mode;
  $('picker').classList.remove('hidden');
  $('picker-search').value = '';
  $('picker-list').innerHTML = `<div class="picker-empty">${t('currency.picker.loading')}</div>`;
  $('picker-search').focus();

  if (!fullCatalog) {
    const res = await window.api.fetchCatalog();
    if (res.error) {
      $('picker-list').innerHTML = `<div class="picker-empty">${t('currency.picker.fetch_failed', { error: res.error })}</div>`;
      return;
    }
    fullCatalog = res;
  }
  renderPickerList($('picker-search').value); // honor anything typed while loading
}

function closePicker() {
  pickerMode = null;
  $('picker').classList.add('hidden');
}

function renderPickerList(query) {
  if (!fullCatalog) return;
  const q = query.trim().toLowerCase();
  const list = $('picker-list');
  list.innerHTML = '';
  let shown = 0;

  const excluded = new Set();
  if (pickerMode && pickerMode.type === 'add-item') {
    const bucket = config.buckets.find((b) => b.id === pickerMode.bucketId);
    if (bucket) {
      excluded.add(bucket.base.apiId);
      for (const it of bucket.items) excluded.add(it.apiId);
    }
  } else if (pickerMode && pickerMode.type === 'add-default') {
    for (const d of config.defaultItems || []) excluded.add(d.apiId);
  } else if (pickerMode && pickerMode.type === 'add-bucket') {
    // can't make two buckets for the same currency (they'd share data-base)
    for (const b of config.buckets || []) excluded.add(b.base.apiId);
  }

  for (const group of fullCatalog.groups) {
    const matches = group.items.filter(
      (i) => !excluded.has(i.apiId) && (!q
        || i.text.toLowerCase().includes(q)
        || window.gameName(i.text).toLowerCase().includes(q))
    );
    if (matches.length === 0) continue;

    const cat = document.createElement('div');
    cat.className = 'picker-cat';
    cat.textContent = window.gameName(group.label);
    list.appendChild(cat);

    for (const item of matches) {
      const el = document.createElement('div');
      el.className = 'picker-item';
      el.dataset.api = item.apiId;
      if (window.tutPickRestrict && item.apiId !== window.tutPickRestrict) el.classList.add('pi-disabled');
      const img = document.createElement('img');
      img.src = item.icon || '';
      el.appendChild(img);
      const nm = document.createElement('span');
      nm.className = 'pi-name';
      nm.textContent = window.gameName(item.text); // feed is English; show the client's name
      el.appendChild(nm);
      const pr = document.createElement('span');
      pr.className = 'pi-price';
      // narrow column: swap the unit rather than appending, so a 12500 ex
      // currency reads "31 div" instead of overflowing
      if (item.price != null) {
        const d = divEquivalent(item.price);
        pr.textContent = d ? t('currency.picker.price_div', { amount: d }) : t('currency.picker.price_ex', { amount: fmt(item.price) });
        pr.title = t('currency.picker.price_title', { amount: fmt(item.price), divine_suffix: d ? ` (${d} divine)` : '' });
      } else {
        pr.textContent = '';
      }
      el.appendChild(pr);
      el.addEventListener('click', () => pickItem(item));
      list.appendChild(el);
      shown++;
      if (shown > 300) break;
    }
    if (shown > 300) break;
  }

  if (shown === 0) {
    list.innerHTML = `<div class="picker-empty">${t('currency.picker.no_matches')}</div>`;
  }
}

function pickItem(item) {
  // during guided tutorial steps only the instructed currency is selectable
  if (window.tutPickRestrict && item.apiId !== window.tutPickRestrict) return;
  const ref = { apiId: item.apiId, category: item.category, text: item.text, icon: item.icon };
  logAction(`pick ${item.apiId} (${(pickerMode && pickerMode.type) || '?'})`);
  if (pickerMode.type === 'add-item') {
    const bucket = config.buckets.find((b) => b.id === pickerMode.bucketId);
    if (bucket && !bucket.items.some((x) => x.apiId === item.apiId)) {
      bucket.items.push(ref);
    }
    persistBuckets();
  } else if (pickerMode.type === 'add-bucket') {
    // seed with default currencies (minus the base itself - can't trade X for X)
    const seed = config.autoAddDefaults
      ? (config.defaultItems || []).filter((d) => d.apiId !== ref.apiId).map((d) => ({ ...d }))
      : [];
    config.buckets.push({
      id: `b-${Date.now()}`,
      base: ref,
      items: seed
    });
    persistBuckets();
  } else if (pickerMode.type === 'add-default') {
    if (!(config.defaultItems || []).some((x) => x.apiId === item.apiId)) {
      config.defaultItems = [...(config.defaultItems || []), ref];
      window.api.setDefaults(config.defaultItems, config.autoAddDefaults);
      renderDefaults();
    }
  }
  catalog[item.apiId] = item; // have price already from picker data
  // Adding payments (to a bucket or to the defaults list) is usually a batch job -
  // keep the picker open so you can add several in a row. The just-added item drops
  // out of the list (renderPickerList excludes it). Keep the typed text but re-focus
  // and SELECT it, so the next keystroke replaces it for a new search while pressing
  // Enter again would still add the next match. Only add-bucket closes.
  const keepOpen = pickerMode.type === 'add-item' || pickerMode.type === 'add-default';
  render();
  if (keepOpen) {
    const s = $('picker-search');
    renderPickerList(s ? s.value : '');
    if (s) { s.focus(); s.select(); }
  } else {
    closePicker();
  }
  refresh(false); // make sure any newly-referenced category is loaded
}

// tiny anchored menu for the pencil on a manually-rated row: edit or clear
function showOvrMenu(anchor, onEdit, onClear) {
  const old = document.getElementById('ovr-menu');
  if (old) old.remove();
  const m = document.createElement('div');
  m.id = 'ovr-menu';
  const cleanup = () => { m.remove(); document.removeEventListener('mousedown', dismiss, true); };
  const dismiss = (ev) => { if (!m.contains(ev.target)) cleanup(); };
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); cleanup(); fn(); });
    m.appendChild(b);
  };
  mk(t('currency.menu.edit_rate'), t('currency.menu.edit_rate_title'), onEdit);
  mk(t('currency.menu.clear_rate'), t('currency.menu.clear_rate_title'), onClear);
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.max(6, Math.min(window.innerWidth - m.offsetWidth - 6, r.left - m.offsetWidth + r.width))}px`;
  m.style.top = `${Math.min(window.innerHeight - m.offsetHeight - 6, r.bottom + 4)}px`;
  document.addEventListener('mousedown', dismiss, true);
}

// ---------- inline pair-rate override editor ----------
function startInlineOverride(row, ref, base, effRate) {
  if (row.querySelector('.inline-ovr')) return; // already editing
  const itemId = ref.apiId;
  const baseId = base.apiId;
  const itemShort = shortName(nameOf(itemId));
  const baseShort = shortName(nameOf(baseId));

  // hide the rate cells while editing
  const cells = row.querySelectorAll('.spark, .rate-main, .gap-col, .arb-col');
  cells.forEach((c) => c.classList.add('hidden'));

  const ed = document.createElement('div');
  ed.className = 'inline-ovr';

  const itemIn = document.createElement('input');
  itemIn.className = 'ovr-in';
  const eq = document.createElement('span');
  eq.className = 'inline-ovr-lab';
  const baseIn = document.createElement('input');
  baseIn.className = 'ovr-in';
  const labA = document.createElement('span');
  labA.className = 'inline-ovr-lab';
  labA.textContent = itemShort;
  labA.title = nameOf(itemId);
  eq.textContent = '=';
  const labB = document.createElement('span');
  labB.className = 'inline-ovr-lab';
  labB.textContent = baseShort;
  labB.title = nameOf(baseId);

  // prefill with the effective rate, phrased with both sides >= 1 like the game does
  if (effRate != null && effRate > 0) {
    if (effRate >= 1) { itemIn.value = '1'; baseIn.value = fmt(effRate).replace(/,/g, ''); }
    else { itemIn.value = fmt(1 / effRate).replace(/,/g, ''); baseIn.value = '1'; }
  }

  const ok = document.createElement('button');
  ok.className = 'mini-btn';
  ok.textContent = '✓';
  ok.title = t('currency.inline.save_title');
  const cancel = document.createElement('button');
  cancel.className = 'mini-btn';
  cancel.textContent = '✕';
  cancel.title = t('currency.inline.cancel_title');

  ed.append(itemIn, labA, eq, baseIn, labB, ok, cancel);
  row.appendChild(ed);
  itemIn.focus();
  itemIn.select();

  const close = () => { ed.remove(); cells.forEach((c) => c.classList.remove('hidden')); };
  const save = async () => {
    const n = parseRate(itemIn.value);
    const m = parseRate(baseIn.value);
    if (n == null || m == null) { itemIn.focus(); return; }
    await setOvrRate(itemId, baseId, m / n); // value of 1 item in base units
    render();
  };
  ok.addEventListener('click', save);
  cancel.addEventListener('click', close);
  for (const inp of [itemIn, baseIn]) {
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') save();
      else if (e.key === 'Escape') close();
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
  }
}

function renderDefaults() {
  const wrap = $('default-items');
  wrap.innerHTML = '';
  const items = config.defaultItems || [];
  if (items.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'chips-empty';
    empty.textContent = t('currency.settings.defaults_empty');
    wrap.appendChild(empty);
    return;
  }
  for (const d of items) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    if (d.icon) {
      const img = document.createElement('img');
      img.src = d.icon;
      chip.appendChild(img);
    }
    const nm = document.createElement('span');
    nm.textContent = shortName(d.text || d.apiId);
    chip.appendChild(nm);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = t('currency.settings.remove_default_title');
    del.addEventListener('click', () => {
      config.defaultItems = config.defaultItems.filter((x) => x.apiId !== d.apiId);
      window.api.setDefaults(config.defaultItems, config.autoAddDefaults);
      renderDefaults();
    });
    chip.appendChild(del);
    wrap.appendChild(chip);
  }
}

// custom slider whose thumb reaches the true 0% and 100% positions (native range
// inputs inset the thumb by its radius and can't). opts: {min,max,step,value,onInput,onChange}
function makeSlider(el, opts) {
  const { min, max } = opts;
  const step = opts.step || 1;
  const clamp = (v) => Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
  let value = clamp(opts.value);
  const track = document.createElement('div'); track.className = 'cs-track';
  const fill = document.createElement('div'); fill.className = 'cs-fill';
  const thumb = document.createElement('div'); thumb.className = 'cs-thumb';
  track.append(fill);
  // optional fixed notch (e.g. the item's own roll) - never moves with the thumb
  if (opts.marker != null && max > min && opts.marker >= min && opts.marker <= max) {
    const mark = document.createElement('div');
    mark.className = 'cs-mark';
    mark.style.left = ((opts.marker - min) / (max - min)) * 100 + '%';
    if (opts.markerTitle) mark.title = opts.markerTitle;
    track.appendChild(mark);
  }
  track.append(thumb);
  el.innerHTML = '';
  el.appendChild(track);
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  const render = () => {
    const pct = ((value - min) / (max - min)) * 100;
    fill.style.width = pct + '%';
    thumb.style.left = pct + '%';
    el.setAttribute('aria-valuenow', String(value));
  };
  const setFromX = (clientX) => {
    const r = track.getBoundingClientRect();
    const p = r.width ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
    const v = clamp(min + p * (max - min));
    if (v !== value) { value = v; render(); if (opts.onInput) opts.onInput(value); }
  };
  let dragging = false;
  el.addEventListener('mousedown', (e) => { dragging = true; el.focus(); setFromX(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => { if (dragging) setFromX(e.clientX); });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; if (opts.onChange) opts.onChange(value); } });
  el.addEventListener('keydown', (e) => {
    let v = value;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v -= step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v += step;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    v = clamp(v);
    if (v !== value) { value = v; render(); if (opts.onInput) opts.onInput(value); if (opts.onChange) opts.onChange(value); }
  });
  render();
  return { get value() { return value; } };
}
window.makeSlider = makeSlider; // shared with the item tab's per-mod sliders

// Numeric value boxes select-all on focus, so clicking in and typing REPLACES
// the number instead of appending to it. Deliberately narrow: only inputs whose
// entire value is a number - free-text fields keep normal caret behavior.
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t && t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'number')
      && /^-?\d+(\.\d+)?$/.test(t.value)) {
    try { t.select(); } catch {}
  }
});
// currency price lookup (exalt-denominated) for the Desecrate tab's cost autofill
window.currencyPriceOf = (apiId) => (catalog && catalog[apiId] && catalog[apiId].price > 0 ? catalog[apiId].price : null);
window.attachTip = attachTip;   // shared hover-intent tooltips (same look, same pinning)

// ---------- currency icon accessibility bridge (Price Check / Desecrate) ----------
// Settings > "Show currency icons instead of names" (config.currencyIcons) swaps a
// currency's unit/name for its icon on the Price Check and Desecrate tabs. Those
// tabs (item-ui.js, item-tab.js, desecrate.js) are plain classic scripts sharing
// this window, so - like currencyPriceOf above - they read the toggle and icon
// URLs through this bridge instead of the `config`/`catalog` bindings directly.
// Does NOT touch the currency overlay itself.
window.currencyIconsOn = () => !!(config && config.currencyIcons);
// apiId ('divine', 'exalted', 'chaos', ...) or the short forms 'div'/'ex' -> icon
// URL, or '' if unknown/not loaded yet.
window.currencyIconUrl = (apiId) => {
  const id = apiId === 'ex' ? 'exalted' : apiId === 'div' ? 'divine' : apiId;
  return (catalog && catalog[id] && catalog[id].icon) || '';
};
// `<img class="cur-icon-inline">` for apiId's icon (title/alt = full display
// name), or null when the toggle is off or no icon is known - callers keep
// their own text fallback in that case. (-inline, not .cur-icon: that class is
// already taken by item.css's fixed 40x40 currency-header logo on Price Check.)
window.currencyIconTag = (apiId) => {
  if (!window.currencyIconsOn()) return null;
  const url = window.currencyIconUrl(apiId);
  if (!url) return null;
  const id = apiId === 'ex' ? 'exalted' : apiId === 'div' ? 'divine' : apiId;
  const name = esc(nameOf(id));
  return `<img class="cur-icon-inline" src="${esc(url)}" title="${name}" alt="${name}">`;
};

// ---------- shared money readability ----------
// Thousands of exalts stop meaning anything - anything worth a divine or more
// gets its divine equivalent alongside. ONLY for absolute prices; exchange
// RATES between two currencies are ratios and must never be converted.
function divEquivalent(amountEx) {
  const div = window.currencyPriceOf('divine');
  if (!(div > 0) || !(amountEx > 0) || amountEx < div) return null;
  const d = amountEx / div;
  return d >= 10 ? String(Math.round(d)) : String(Math.round(d * 10) / 10);
}
// plain text for title="" attributes: "8888 exalted (22 div)"
window.divAsideText = (amount, currency) => {
  const cur = String(currency || '');
  if (cur === 'divine' || cur === 'div') return '';
  const rate = window.currencyPriceOf(cur === 'ex' ? 'exalted' : cur);
  if (!(rate > 0)) return '';
  const d = divEquivalent(amount * rate);
  return d ? ` (${d} div)` : '';
};
// HTML for rendered markup. When the currency-icon toggle is on, the "div" unit
// swaps to the divine icon too - matching the main price's unit (curUnitHtml), so
// the parenthetical isn't left as the only place still spelling out "div".
window.divAsideHtml = (amount, currency) => {
  const t = window.divAsideText(amount, currency); // " (8.6 div)" or ""
  if (!t) return '';
  const num = t.trim().replace(/^\(/, '').replace(/\s*div\)$/, ''); // "8.6"
  const icon = window.currencyIconTag && window.currencyIconTag('div');
  return ` <span class="cur-div">(${esc(num)} ${icon || 'div'})</span>`;
};
window.divEquivalent = divEquivalent;

// The suggested floor prints in whatever currency the comparables listed in, and
// "0.7 div" tells you nothing unless you know the exchange by heart (user
// feedback). So show the same money in the other majors beside it. Same rule as
// divEquivalent: absolute PRICES only, never an exchange ratio.
const ASIDE_MAJORS = ['exalted', 'divine', 'chaos'];
const ASIDE_UNIT = { exalted: 'ex', divine: 'div', chaos: 'chaos' };
const asideRate = (apiId) => (apiId === 'exalted' ? (window.currencyPriceOf('exalted') || 1) : window.currencyPriceOf(apiId));
function asideQty(amountEx, apiId) {
  const rate = asideRate(apiId);
  if (!(rate > 0) || !(amountEx > 0)) return null;
  const q = amountEx / rate;
  if (q < 0.05) return null; // "0.008 div" is noise, not help
  if (q >= 1000) return `${Math.round(q / 100) / 10}k`;
  if (q >= 100) return String(Math.round(q));
  if (q >= 10) return String(Math.round(q * 10) / 10);
  return String(Math.round(q * 100) / 100);
}
// every major except the one the price is already quoted in
function majorAsides(amount, currency) {
  const cur = String(currency || '');
  const src = cur === 'ex' ? 'exalted' : cur === 'div' ? 'divine' : cur;
  const rate = asideRate(src);
  if (!(rate > 0) || !(amount > 0)) return [];
  const amountEx = amount * rate;
  const out = [];
  for (const m of ASIDE_MAJORS) {
    if (m === src) continue;
    const qty = asideQty(amountEx, m);
    if (qty) out.push({ apiId: m, unit: ASIDE_UNIT[m], qty });
  }
  return out;
}
window.majorAsideText = (amount, currency) => {
  const a = majorAsides(amount, currency);
  return a.length ? ` (≈ ${a.map((x) => `${x.qty} ${x.unit}`).join(' · ')})` : '';
};
window.majorAsideHtml = (amount, currency) => {
  const a = majorAsides(amount, currency);
  if (!a.length) return '';
  const parts = a.map((x) => {
    const icon = window.currencyIconTag && window.currencyIconTag(x.apiId);
    return `${esc(x.qty)} ${icon || esc(x.unit)}`;
  });
  return ` <span class="cur-aside">≈ ${parts.join(' · ')}</span>`;
};

// ---------- settings ----------
async function initSettings() {
  // click-to-record hotkey capture, shared by all three binds
  const bindHotkeyInput = (input, getCur, trySet) => {
    input.value = getCur();
    input.addEventListener('focus', () => {
      input.classList.add('recording');
      input.value = t('currency.settings.hotkey_recording');
    });
    input.addEventListener('blur', () => {
      input.classList.remove('recording');
      input.value = getCur();
    });
    input.addEventListener('keydown', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { input.blur(); return; }
      const acc = eventToAccelerator(e);
      if (!acc) return; // modifier-only press; keep waiting
      const ok = await trySet(acc);
      if (ok) {
        input.blur();
        showStatus(null);
      } else {
        showStatus(t('currency.settings.hotkey_conflict', { acc }));
      }
    });
  };
  bindHotkeyInput($('hotkey-input'), () => config.hotkey, async (acc) => {
    const ok = await window.api.setHotkey(acc);
    if (ok) config.hotkey = acc;
    return ok;
  });
  bindHotkeyInput($('item-hotkey-input'), () => config.itemHotkey || '', async (acc) => {
    const ok = await window.api.setItemHotkeys({ pin: acc, temp: config.itemHotkeyTemp });
    if (ok) {
      config.itemHotkey = acc;
      if (window.ItemTab && window.ItemTab.setItemHotkey) window.ItemTab.setItemHotkey(acc);
    }
    return ok;
  });
  bindHotkeyInput($('item-hotkey-temp-input'), () => config.itemHotkeyTemp || '', async (acc) => {
    const ok = await window.api.setItemHotkeys({ pin: config.itemHotkey, temp: acc });
    if (ok) config.itemHotkeyTemp = acc;
    return ok;
  });
  const stashHkInput = $('stash-hotkey-input');
  if (stashHkInput) bindHotkeyInput(stashHkInput, () => config.stashHotkey || '', async (acc) => {
    const ok = await window.api.setStashHotkey(acc);
    if (ok) config.stashHotkey = acc;
    return ok;
  });

  // ---------- command hotkeys (Settings → Hotkeys) ----------
  // Rows of {command, accelerator}. Curated dropdown + a Custom… option for
  // anything else (argument commands, new patch commands). The fences (must
  // be a /command; deny-listed foot-guns rejected) are enforced in main;
  // renderer mirrors them only for live feedback.
  let safeCommands = ['/hideout'];
  let deniedCommands = [];
  const cmdRowsEl = $('cmd-hotkeys-rows');
  const cmdOk = (c) => {
    const v = String(c || '').trim();
    return v.startsWith('/') && v.length > 1 && !/[\r\n]/.test(v) && !deniedCommands.includes(v.split(/\s+/)[0].toLowerCase());
  };
  const saveCmdHotkeys = () => window.api.setCommandHotkeys(config.commandHotkeys || []);
  // Focus detection is Win32-only so far: on other platforms the command lands in
  // whatever window has the keyboard. Say so rather than let it surprise someone.
  {
    const note = document.querySelector('.cmdhk-nofocus');
    if (note && window.api.platform && window.api.platform !== 'win32') note.classList.remove('hidden');
  }
  const renderCmdHotkeys = () => {
    if (!cmdRowsEl) return;
    cmdRowsEl.innerHTML = '';
    const rows = Array.isArray(config.commandHotkeys) ? config.commandHotkeys : (config.commandHotkeys = []);
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'cmdhk-empty';
      empty.textContent = t('currency.settings.cmdhk_empty');
      cmdRowsEl.appendChild(empty);
    }
    rows.forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'cmdhk-row';
      const isCustom = !safeCommands.includes(row.command);
      const cmdSel = document.createElement('select');
      cmdSel.className = 'cmdhk-cmd';
      cmdSel.title = t('currency.settings.cmdhk_select_title');
      for (const c of safeCommands) {
        const o = document.createElement('option');
        o.value = c; o.textContent = c;
        if (!isCustom && c === row.command) o.selected = true;
        cmdSel.appendChild(o);
      }
      const oCustom = document.createElement('option');
      oCustom.value = '__custom__'; oCustom.textContent = t('currency.settings.cmdhk_custom_option');
      if (isCustom) oCustom.selected = true;
      cmdSel.appendChild(oCustom);
      cmdSel.addEventListener('change', async () => {
        if (cmdSel.value === '__custom__') {
          row.command = '/';
          renderCmdHotkeys(); // row re-renders; the custom input focuses itself
          return;
        }
        row.command = cmdSel.value;
        logAction(`cmd-hotkey command: ${cmdSel.value}`);
        await saveCmdHotkeys();
        renderCmdHotkeys();
      });
      div.appendChild(cmdSel);
      if (isCustom) {
        const custom = document.createElement('input');
        custom.className = 'cmdhk-custom' + (cmdOk(row.command) ? '' : ' cmdhk-bad');
        custom.placeholder = t('currency.settings.cmdhk_custom_placeholder');
        custom.title = t('currency.settings.cmdhk_custom_title');
        custom.value = row.command === '/' ? '' : row.command;
        custom.addEventListener('input', () => {
          custom.classList.toggle('cmdhk-bad', !cmdOk(custom.value));
        });
        custom.addEventListener('change', async () => {
          const v = custom.value.trim();
          if (!cmdOk(v)) return; // stays red; not saved
          row.command = v;
          logAction(`cmd-hotkey custom: ${v}`);
          await saveCmdHotkeys();
        });
        div.appendChild(custom);
        if (row.command === '/') setTimeout(() => custom.focus(), 0);
      }
      const field = document.createElement('div');
      field.className = 'kb-field';
      const input = document.createElement('input');
      input.className = 'kb-input'; input.readOnly = true; input.placeholder = t('currency.settings.cmdhk_bind_placeholder');
      const hint = document.createElement('span');
      hint.className = 'kb-hint'; hint.textContent = t('currency.settings.cmdhk_bind_hint');
      field.appendChild(input); field.appendChild(hint);
      div.appendChild(field);
      bindHotkeyInput(input, () => row.accelerator || '', async (acc) => {
        row.accelerator = acc;
        logAction(`cmd-hotkey bind: ${row.command} -> ${acc}`);
        await saveCmdHotkeys();
        return true;
      });
      const del = document.createElement('button');
      del.className = 'cmdhk-del'; del.textContent = '✕'; del.title = t('currency.settings.cmdhk_remove_title');
      del.addEventListener('click', async () => {
        rows.splice(i, 1);
        await saveCmdHotkeys();
        renderCmdHotkeys();
      });
      div.appendChild(del);
      cmdRowsEl.appendChild(div);
    });
  };
  window.api.getSafeCommands().then((l) => {
    if (l && Array.isArray(l.commands) && l.commands.length) {
      safeCommands = l.commands;
      deniedCommands = Array.isArray(l.denied) ? l.denied : [];
    }
    renderCmdHotkeys();
  }).catch(() => renderCmdHotkeys());
  const cmdAdd = $('cmd-hotkeys-add');
  if (cmdAdd) cmdAdd.addEventListener('click', async () => {
    (config.commandHotkeys = config.commandHotkeys || []).push({ command: safeCommands[0] || '/hideout', accelerator: '' });
    logAction('cmd-hotkey row added');
    await saveCmdHotkeys();
    renderCmdHotkeys();
  });

  const sel = $('league-select');
  sel.value = config.league || 'auto';
  const leagues = await window.api.listLeagues();
  if (Array.isArray(leagues)) {
    for (const l of leagues) {
      const opt = document.createElement('option');
      opt.value = l.value;
      opt.textContent = l.isCurrent ? t('currency.settings.league_current', { league: l.value }) : l.value;
      sel.appendChild(opt);
    }
    sel.value = config.league || 'auto';
  }
  sel.addEventListener('change', async () => {
    config.league = sel.value;
    await window.api.setLeague(sel.value);
    fullCatalog = null;
    catalog = {};
    refresh(true);
  });

  const scaleLabel = $('scale-value');
  scaleLabel.textContent = `${config.uiScale || 100}%`;
  makeSlider($('scale-slider'), {
    min: 50, max: 200, step: 5, value: config.uiScale || 100,
    onInput: (v) => { scaleLabel.textContent = `${v}%`; },
    onChange: (v) => { config.uiScale = v; window.api.setUiScale(v); applyScaleCompensation(); }
  });
  applyScaleCompensation();

  const bgLabel = $('bg-value');
  const bg0 = config.bgOpacity != null ? config.bgOpacity : 100;
  bgLabel.textContent = `${bg0}%`;
  makeSlider($('bg-slider'), {
    min: 10, max: 100, step: 2, value: bg0,
    onInput: (v) => { bgLabel.textContent = `${v}%`; document.documentElement.style.setProperty('--bg-alpha', String(v / 100)); },
    onChange: (v) => { config.bgOpacity = v; window.api.setBgOpacity(v); }
  });

  const chk = $('auto-defaults');
  chk.checked = !!config.autoAddDefaults;
  chk.addEventListener('change', () => {
    config.autoAddDefaults = chk.checked;
    window.api.setDefaults(config.defaultItems || [], config.autoAddDefaults);
  });
  $('btn-add-default').addEventListener('click', () => openPicker({ type: 'add-default' }));
  renderDefaults();

  renderOverridesGrid();

  const exArb = $('exclude-exalted-arb');
  exArb.checked = !!config.excludeExaltedArb;
  exArb.addEventListener('change', async () => {
    config.excludeExaltedArb = exArb.checked;
    logAction(`exclude exalted from arb: ${exArb.checked}`);
    await window.api.setExcludeExaltedArb(exArb.checked);
    render(); // routes recompute immediately
  });

  // Price Check / Desecrate icon-swap (does not affect the currency overlay,
  // so no render() call here - only those two tabs' own re-render, in case
  // one is open right now).
  const curIcons = $('currency-icons');
  curIcons.checked = !!config.currencyIcons;
  curIcons.addEventListener('change', async () => {
    config.currencyIcons = curIcons.checked;
    logAction(`currency icons: ${curIcons.checked}`);
    await window.api.setCurrencyIcons(curIcons.checked);
    if (window.ItemTab && window.ItemTab.refresh) window.ItemTab.refresh();
    if (window.Desecrate && window.Desecrate.refresh) window.Desecrate.refresh();
    if (window.NetWorth && window.NetWorth.render) window.NetWorth.render();
  });

  const dysFont = $('dyslexic-font');
  if (dysFont) {
    dysFont.checked = !!config.dyslexicFont;
    dysFont.addEventListener('change', async () => {
      config.dyslexicFont = dysFont.checked;
      document.documentElement.classList.toggle('dyslexic-font', dysFont.checked);
      logAction(`dyslexic font: ${dysFont.checked}`);
      await window.api.setDyslexicFont(dysFont.checked);
    });
  }

  // Optional-tab visibility (Regex / Desecrate). item-tab.js owns the tab bar,
  // so the toggles hand the change to window.setTabVisibility.
  const wireTabToggle = (elId, cfgKey, visKey) => {
    const t = $(elId);
    if (!t) return;
    t.checked = config[cfgKey] !== false;
    t.addEventListener('change', async () => {
      config[cfgKey] = t.checked;
      logAction(`${visKey} tab visible: ${t.checked}`);
      await window.api.setTabShown(visKey, t.checked);
      if (window.setTabVisibility) window.setTabVisibility(visKey, t.checked);
    });
  };
  // a tab's own ✕ hides it too - keep the matching Settings switch in sync
  const TAB_TOGGLE_ID = { regex: 'show-regex-tab', grandex: 'show-grandex-tab', networth: 'show-networth-tab', desec: 'show-desecrate-tab' };
  const TAB_TOGGLE_CFG = { regex: 'showRegexTab', grandex: 'showGrandExTab', networth: 'showNetWorthTab', desec: 'showDesecrateTab' };
  window.setTabToggleChecked = (visKey, checked) => {
    const t = $(TAB_TOGGLE_ID[visKey]);
    if (t) t.checked = !!checked;
    if (TAB_TOGGLE_CFG[visKey]) config[TAB_TOGGLE_CFG[visKey]] = !!checked;
  };
  // ---- language ----
  // One control drives BOTH the interface catalog and the item parser; they can't
  // drift apart. Changing it reloads the window rather than re-rendering in place:
  // the parser has to re-init against different data files, and a reload re-runs
  // every module's own boot path instead of us trying to reproduce it by hand.
  {
    const sel = $('lang-select');
    if (sel && window.I18N) {
      for (const l of window.I18N.LANGS) {
        const o = document.createElement('option');
        o.value = l.code;
        // each language names itself - a Russian speaker looks for "Русский". No
        // coverage percentage: that's a QA metric, and a player reading "(97%)" learns
        // nothing except that the app looks unfinished. Shown only when debugging.
        o.textContent = l.label + (window.api.debug && l.code !== 'en'
          ? ` (${window.I18N.coverage(l.code).pct}%)` : '');
        sel.appendChild(o);
      }
      sel.value = window.I18N.lang();
      sel.addEventListener('change', async () => {
        try { await window.api.setLanguage(sel.value); } catch {}
        logAction(`language: ${sel.value}`);
        location.reload();
      });
    }
  }
  wireTabToggle('show-regex-tab', 'showRegexTab', 'regex');
  wireTabToggle('show-grandex-tab', 'showGrandExTab', 'grandex');
  wireTabToggle('show-networth-tab', 'showNetWorthTab', 'networth');
  wireTabToggle('show-desecrate-tab', 'showDesecrateTab', 'desec');

  // Live-rate sliders (Tab-visible + Background). 4 stops: quiet/low/medium/high.
  const RATE_KEYS = ['quiet', 'low', 'medium', 'high'];
  const RATE_LABEL = { quiet: t('currency.settings.rate_quiet'), low: t('currency.settings.rate_low'), medium: t('currency.settings.rate_medium'), high: t('currency.settings.rate_high') };
  const wireRateSlider = (sliderId, valueId, cfgKey, defIdx) => {
    const s = $(sliderId), v = $(valueId);
    if (!s) return;
    const cur = RATE_KEYS.indexOf(config[cfgKey]);
    s.value = String(cur >= 0 ? cur : defIdx);
    const labels = s.parentElement.querySelectorAll('.live-labels [data-rate]');
    const paint = () => {
      const key = RATE_KEYS[Number(s.value)] || 'quiet';
      if (v) v.textContent = RATE_LABEL[key];
      labels.forEach((el) => el.classList.toggle('active', el.dataset.rate === key));
    };
    const commit = () => {
      const key = RATE_KEYS[Number(s.value)] || 'quiet';
      config[cfgKey] = key;
      logAction(`${cfgKey} = ${key}`);
      window.api.setCurrencyRates(cfgKey === 'currencyTabRate' ? { tab: key } : { bg: key });
    };
    paint();
    s.addEventListener('input', paint);
    s.addEventListener('change', commit);
    labels.forEach((el) => el.addEventListener('click', () => {
      s.value = String(RATE_KEYS.indexOf(el.dataset.rate)); paint(); commit();
    }));
  };
  wireRateSlider('currency-tabrate', 'tabrate-value', 'currencyTabRate', 2);
  wireRateSlider('currency-bgrate', 'bgrate-value', 'currencyBgRate', 0);

  // mod-slider visibility. The q20 / filled-rune assumptions now live as a live
  // toggle on the Price Check page (Miscellaneous); their config values persist
  // there and are preserved untouched here.
  const sliders = $('item-sliders');
  sliders.checked = config.itemSliders !== false;
  const pushItemOpts = async () => {
    config.itemSliders = sliders.checked;
    logAction(`item search opts: sliders=${sliders.checked}`);
    await window.api.setItemSearchOpts({ q20: config.itemQ20 !== false, fillRunes: config.itemFillRunes !== false, sliders: sliders.checked });
    if (window.ItemTab && window.ItemTab.setSearchAssumptions) {
      window.ItemTab.setSearchAssumptions(config.itemQ20 !== false, config.itemFillRunes !== false, sliders.checked);
    }
  };
  sliders.addEventListener('change', pushItemOpts);

  // trade-site login: opens GGG's own login page; on close we probe the session
  // (one trade search) and report. Credentials never touch this app.
  const loginBtn = $('btn-poe-login');
  const loginStatus = $('poe-login-status');
  loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true;
    loginStatus.textContent = t('currency.settings.poe_login_wait');
    try {
      await window.api.poeLogin();
      loginStatus.textContent = t('currency.settings.poe_login_checking');
      const league = config.league && config.league !== 'auto'
        ? config.league
        : ((await window.api.trade2Leagues())[0] || 'Standard');
      const authed = await window.api.trade2AuthCheck(league, true);
      loginStatus.textContent = authed
        ? t('currency.settings.poe_login_success')
        : t('currency.settings.poe_login_not_authed');
      if (window.ItemTab && window.ItemTab.setAuthed) window.ItemTab.setAuthed(authed);
    } catch (err) {
      loginStatus.textContent = t('currency.settings.poe_login_check_failed', { error: err.message });
    }
    loginBtn.disabled = false;
  });
}

const OVR_IDS = ['exalted', 'chaos', 'divine', 'annul'];
const OVR_SHORT = { exalted: 'Exalt', chaos: 'Chaos', divine: 'Div', annul: 'Annul' };

function renderOverridesGrid() {
  const grid = $('ovr-grid');
  grid.innerHTML = '';
  const rates = (config.overrides && config.overrides.rates) || {};
  // axes match Ange's in-game screen: rows = what you WANT (left), columns = what you HAVE (top)
  const corner = document.createElement('span');
  corner.className = 'ovr-h ovr-corner';
  corner.innerHTML = t('currency.settings.ovr_corner_label');
  corner.title = t('currency.settings.ovr_corner_title');
  grid.appendChild(corner);
  for (const from of OVR_IDS) {
    const h = document.createElement('span');
    h.className = 'ovr-h';
    h.textContent = t('currency.settings.ovr_have_label', { short: OVR_SHORT[from] });
    grid.appendChild(h);
  }
  for (const to of OVR_IDS) {
    const lab = document.createElement('span');
    lab.className = 'ovr-h';
    lab.textContent = t('currency.settings.ovr_want_label', { short: OVR_SHORT[to] });
    grid.appendChild(lab);
    for (const from of OVR_IDS) {
      if (to === from) {
        const dash = document.createElement('span');
        dash.className = 'ovr-dash';
        dash.textContent = '-';
        grid.appendChild(dash);
        continue;
      }
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'ovr-in';
      inp.dataset.key = `${from}>${to}`;
      const cur = rates[`${from}>${to}`];
      if (typeof cur === 'number' && cur > 0) { inp.value = String(cur); inp.classList.add('set'); }
      const mkt = bestMarketRate(from, to);
      inp.placeholder = mkt != null ? fmt(mkt) : '-';
      inp.title = t('currency.settings.ovr_cell_title', { from: nameOf(from), to: nameOf(to) });
      // auto-apply: committing a cell (Enter or click-out) saves it immediately and
      // recomputes routes; clearing it reverts that pair to live market data.
      const commit = () => {
        const v = parseRate(inp.value);
        if (v != null && v > 0) {
          inp.value = String(parseFloat(v.toPrecision(6))); // show the decimal
          inp.classList.add('set');
        } else {
          inp.value = '';
          inp.classList.remove('set');
        }
        inp.dataset.committed = '1';
        setOvrRate(from, to, v != null && v > 0 ? v : null).catch(() => {});
        render();
      };
      inp.addEventListener('input', () => { delete inp.dataset.committed; });
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') inp.blur(); // blur handler commits
      });
      grid.appendChild(inp);
    }
  }
}

function showUpdateBanner(s) {
  if (!s || s.status === 'idle') return;
  const banner = $('update-banner');
  const text = $('update-text');
  const btn = $('btn-update');
  banner.classList.remove('hidden');
  if (s.status === 'downloading') {
    text.textContent = t('currency.update.downloading', { version: s.version });
    btn.classList.add('hidden');
  } else if (s.status === 'ready') {
    text.textContent = t('currency.update.ready', { version: s.version });
    btn.textContent = t('currency.update.btn_restart');
    btn.classList.remove('hidden');
  } else if (s.status === 'installing') {
    text.textContent = t('currency.update.installing', { version: s.version });
    btn.classList.add('hidden');
  } else if (s.status === 'manual') {
    text.textContent = t('currency.update.available', { version: s.version });
    btn.textContent = t('currency.update.btn_download');
    btn.classList.remove('hidden');
  }
}

// The window zoom scales everything uniformly; icons and padding grow slower.
// Icons move at 50% of the scale rate, padding at ~67% - the CSS counter-scales
// them against the zoom via these variables.
function applyScaleCompensation() {
  const z = (config.uiScale || 100) / 100;
  const iconK = (1 + (z - 1) * 0.5) / z;
  const padK = (1 + (z - 1) * (2 / 3)) / z;
  const root = document.documentElement.style;
  root.setProperty('--icon-k', iconK.toFixed(4));
  root.setProperty('--pad-k', padK.toFixed(4));
}

async function updateFeedStatus() {
  try {
    const s = await window.api.getFeedStatus();
    const el = $('feed-status');
    if (s.live) {
      el.textContent = t('currency.footer.feed_live', { upstream: s.upstream });
      el.classList.add('live');
      el.title = s.base;
    } else if (s.cx) {
      el.textContent = t('currency.footer.feed_ggg');
      el.classList.add('live');
      el.title = t('currency.footer.feed_ggg_title', { cxPairs: s.cxPairs });
    } else {
      el.textContent = t('currency.footer.feed_public');
      el.classList.remove('live');
      el.title = t('currency.footer.feed_public_title');
    }
  } catch {}
}

function eventToAccelerator(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  let key = null;
  if (/^F\d{1,2}$/.test(e.key)) key = e.key;
  else if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (e.key === ' ') key = 'Space';
  else if (['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(e.key)) key = e.key;
  else if (['~', '`'].includes(e.key)) key = '`';

  if (!key) return null;
  // bare letter/digit hotkeys would swallow game input - require a modifier for those
  if (mods.length === 0 && !/^F\d{1,2}$/.test(key) && !['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(key)) {
    return null;
  }
  return [...mods, key].join('+');
}

// ---------- activity log (attached to bug reports for debugging) ----------
const ACTIVITY_LOG = [];
function logAction(msg) {
  try {
    const t = new Date().toISOString().slice(11, 19);
    ACTIVITY_LOG.push(`${t} ${msg}`);
    if (ACTIVITY_LOG.length > 60) ACTIVITY_LOG.shift();
  } catch {}
}
window.logAction = logAction; // tutorial.js and others log through this
window.addEventListener('error', (e) => {
  logAction(`ERROR ${e.message || ''} @${(e.filename || '').split('/').pop()}:${e.lineno || ''}`);
});
window.addEventListener('unhandledrejection', (e) => {
  logAction(`REJECTION ${(e.reason && e.reason.message) || e.reason || ''}`);
});

// ---------- release notes (what's-new popup + Settings history) ----------
const RELEASE_NOTES = Array.isArray(window.RELEASE_NOTES) ? window.RELEASE_NOTES : [];

function noteAnchorId(version) { return 'notes-v-' + String(version).replace(/\./g, '-'); }
function renderNoteEntry(rel) {
  // A note ending in ':' is a SECTION HEADING, not a bullet - lets an entry group its
  // lines ("User feedback changes:" / "Bug fixes:") without them rendering as stray bullets.
  const lis = (rel.notes || [])
    .map((n) => (/:\s*$/.test(n) ? `<li class="notes-sec">${esc(n)}</li>` : `<li>${esc(n)}</li>`))
    .join('');
  const date = rel.date ? `<span class="notes-rel-date">${esc(rel.date)}</span>` : '';
  const sub = rel.title ? `<div class="notes-rel-sub">${esc(rel.title)}</div>` : '';
  return `<div class="notes-rel" id="${noteAnchorId(rel.version)}"><div class="notes-rel-head"><span class="notes-rel-ver">v${esc(rel.version)}</span>${date}</div>${sub}<ul class="notes-list">${lis}</ul></div>`;
}

let notesMode = 'latest';
// Both modes now show the FULL history in one scrollable body (newest first) with a
// version sidebar (click to jump). 'latest' = the one-time post-update popup, opened
// scrolled to the newest and dismissable ONLY by its button (no backdrop/X). 'history'
// = opened from Settings, closable any normal way.
function highlightNavFor(version) {
  const nav = $('notes-nav'); if (!nav) return;
  const v = String(version).replace(/\./g, '-');
  nav.querySelectorAll('.notes-nav-item').forEach((x) => x.classList.toggle('active', x.dataset.v === v));
}
function openNotes(mode) {
  const modal = $('notes-modal');
  const body = $('notes-body');
  const nav = $('notes-nav');
  if (!modal || !body || !RELEASE_NOTES.length) return;
  notesMode = mode === 'history' ? 'history' : 'latest';
  body.innerHTML = RELEASE_NOTES.map(renderNoteEntry).join('');

  // version sidebar: one entry per release, click to scroll to it. Hidden when there's
  // only a single version (nothing to navigate between).
  if (nav) {
    if (RELEASE_NOTES.length > 1) {
      nav.classList.remove('hidden');
      nav.innerHTML = RELEASE_NOTES.map((r, i) =>
        `<button class="notes-nav-item${i === 0 ? ' active' : ''}" data-v="${esc(String(r.version).replace(/\./g, '-'))}">v${esc(r.version)}</button>`).join('');
      nav.querySelectorAll('.notes-nav-item').forEach((b) => b.addEventListener('click', () => {
        const el = document.getElementById('notes-v-' + b.dataset.v);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        highlightNavFor(b.dataset.v.replace(/-/g, '.'));
      }));
      // keep the sidebar in sync as the user scrolls the body
      body.onscroll = () => {
        let cur = null;
        for (const r of body.querySelectorAll('.notes-rel')) {
          if (r.offsetTop - body.scrollTop <= 48) cur = r.id.replace('notes-v-', '');
        }
        if (cur) nav.querySelectorAll('.notes-nav-item').forEach((x) => x.classList.toggle('active', x.dataset.v === cur));
      };
    } else {
      nav.classList.add('hidden');
      nav.innerHTML = '';
      body.onscroll = null;
    }
  }

  if (notesMode === 'history') {
    $('notes-title').textContent = t('currency.notes.title_history');
    $('notes-sub').textContent = t('currency.notes.subtitle_history');
    $('notes-close').classList.remove('hidden'); // history: X is fine
    $('notes-dismiss').textContent = t('currency.notes.btn_close');
  } else {
    $('notes-title').textContent = t('currency.notes.title_latest');
    $('notes-sub').textContent = t('currency.notes.updated_to', { version: RELEASE_NOTES[0].version });
    $('notes-close').classList.add('hidden'); // one-time popup: button-only dismiss
    $('notes-dismiss').textContent = t('currency.notes.btn_got_it');
  }
  body.scrollTop = 0; // open at the newest release
  modal.classList.remove('hidden');
}

function closeNotes() {
  const modal = $('notes-modal');
  if (modal) modal.classList.add('hidden');
  // whichever way it closes, the newest version has now been seen - never re-pop it
  const latest = RELEASE_NOTES[0] && RELEASE_NOTES[0].version;
  if (latest) window.api.setSeenVersion(latest).catch(() => {});
}

// show the popup once, on the first launch after the app version changes. Brand-new
// users (mid first-run tutorial) are skipped so onboarding isn't double-stacked - we
// just stamp the current version so their NEXT update shows notes normally.
async function maybeShowPatchNotes() {
  if (!RELEASE_NOTES.length) return;
  const latest = RELEASE_NOTES[0].version;
  let version = latest;
  try { version = await window.api.getAppVersion(); } catch {}
  if (config && config.lastSeenVersion === version) return; // already seen this build
  if (config && !config.tutorialDone) { // brand-new install: let the tutorial lead
    window.api.setSeenVersion(version).catch(() => {});
    return;
  }
  if (RELEASE_NOTES[0].version !== version) { // no notes authored for this build yet
    window.api.setSeenVersion(version).catch(() => {});
    return;
  }
  openNotes('latest');
}

// ---------- support / feedback ----------
const KOFI_URL = 'https://ko-fi.com/tryfoundry';
const FAQ_URL = 'https://poe2-vibetools.github.io/poe2-currency-overlay/faq.html';
let fbKind = 'feedback';

function openFeedback(kind) {
  fbKind = kind === 'bug' ? 'bug' : 'feedback';
  const isBug = fbKind === 'bug';
  $('fb-title').textContent = isBug ? t('currency.feedback.title_bug') : t('currency.feedback.title_feedback');
  $('fb-type-row').classList.toggle('hidden', isBug); // bugs need no type picker
  $('fb-note').classList.toggle('hidden', !isBug);
  $('fb-details').placeholder = isBug
    ? t('currency.feedback.placeholder_bug')
    : t('currency.feedback.placeholder_feedback');
  $('fb-details').value = '';
  $('fb-contact').value = '';
  $('fb-status').textContent = '';
  $('fb-status').className = 'fb-status';
  $('fb-send').disabled = false;
  logAction(`open ${fbKind} form`);
  $('feedback-modal').classList.remove('hidden');
  $('fb-details').focus();
}
function closeFeedback() { $('feedback-modal').classList.add('hidden'); }
// accidental dismiss (backdrop / Esc) shouldn't throw away a written report
async function maybeCloseFeedback() {
  if ($('fb-details').value.trim()
    && !(await confirmDialog(t('currency.feedback.discard_confirm'), { confirmLabel: t('currency.feedback.btn_discard'), danger: true }))) return;
  closeFeedback();
}

// styled replacement for window.confirm: a small modal that matches the app,
// resolving a Promise<boolean>. Message is set via textContent (no HTML injection),
// so it's safe with arbitrary strings. Enter = confirm, Esc / backdrop = cancel.
// Resolves false/true normally. When opts.checkboxLabel is set, a checkbox is shown
// and it resolves { confirmed, dontAsk } instead (so callers can read the checkbox).
function confirmDialog(message, opts = {}) {
  const hasBox = !!opts.checkboxLabel;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal';
    overlay.innerHTML =
      '<div class="cf-card">'
      + '<div class="cf-msg"></div>'
      + (hasBox ? '<label class="cf-skip"><input type="checkbox" class="cf-skip-box"><span></span></label>' : '')
      + '<div class="cf-actions">'
      + `<button class="cf-btn cf-cancel">${esc(opts.cancelLabel || t('currency.dialog.btn_cancel_default'))}</button>`
      + `<button class="cf-btn cf-ok${opts.danger ? ' danger' : ''}">${esc(opts.confirmLabel || t('currency.dialog.btn_ok_default'))}</button>`
      + '</div></div>';
    overlay.querySelector('.cf-msg').textContent = String(message == null ? '' : message);
    if (hasBox) overlay.querySelector('.cf-skip span').textContent = opts.checkboxLabel;
    const box = () => !!(hasBox && overlay.querySelector('.cf-skip-box').checked);
    const result = (ok) => (hasBox ? { confirmed: ok, dontAsk: ok && box() } : ok);
    const done = (ok) => { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(result(ok)); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    overlay.querySelector('.cf-cancel').addEventListener('click', () => done(false));
    overlay.querySelector('.cf-ok').addEventListener('click', () => done(true));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { const b = overlay.querySelector('.cf-ok'); if (b) b.focus(); });
  });
}
async function sendFeedback() {
  const details = $('fb-details').value.trim();
  if (!details) { $('fb-details').focus(); return; }
  const status = $('fb-status');
  $('fb-send').disabled = true;
  status.textContent = t('currency.feedback.status_sending');
  status.className = 'fb-status';
  const isBug = fbKind === 'bug';
  const ok = await window.api.submitFeedback({
    kind: fbKind,
    type: isBug ? 'Bug' : $('fb-type').value,
    details,
    contact: $('fb-contact').value.trim(),
    log: isBug ? ACTIVITY_LOG.join('\n') : ''
  });
  if (ok) {
    status.textContent = t('currency.feedback.status_sent');
    status.className = 'fb-status ok';
    setTimeout(closeFeedback, 1100);
  } else {
    status.textContent = t('currency.feedback.status_failed');
    status.className = 'fb-status err';
    $('fb-send').disabled = false;
  }
}

// ---------- wiring ----------
async function main() {
  config = await window.api.getConfig();
  // apply saved background opacity before first paint (no flash at the default)
  document.documentElement.style.setProperty('--bg-alpha', String((config.bgOpacity != null ? config.bgOpacity : 100) / 100));
  // dyslexia-friendly font (OpenDyslexic) - applied app-wide via a root class
  document.documentElement.classList.toggle('dyslexic-font', !!config.dyslexicFont);

  // footer items are role=button spans - wire click AND Enter/Space so they work by keyboard
  const onActivate = (id, fn) => {
    const el = $(id);
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  };
  onActivate('btn-bug', () => openFeedback('bug'));
  onActivate('lnk-feedback', () => openFeedback('feedback'));
  onActivate('lnk-coffee', () => window.api.openExternal(KOFI_URL));
  onActivate('lnk-help', () => window.api.openExternal(FAQ_URL));
  // same actions mirrored inside Settings (real buttons handle keyboard natively)
  onActivate('set-bug', () => openFeedback('bug'));
  onActivate('set-feedback', () => openFeedback('feedback'));
  onActivate('set-help', () => window.api.openExternal(FAQ_URL));
  onActivate('set-support', () => window.api.openExternal(KOFI_URL));
  $('fb-cancel').addEventListener('click', closeFeedback);
  $('fb-send').addEventListener('click', sendFeedback);
  $('feedback-modal').addEventListener('click', (e) => { if (e.target.id === 'feedback-modal') maybeCloseFeedback(); });

  // release-notes viewer (Settings) + the what's-new popup's own controls
  onActivate('btn-release-notes', () => openNotes('history'));
  // clicking the version in the titlebar opens the patch-notes viewer
  const verEl = $('app-version');
  if (verEl) { verEl.title = t('currency.footer.version_title'); verEl.addEventListener('click', () => openNotes('history')); }
  $('notes-close').addEventListener('click', closeNotes);
  $('notes-dismiss').addEventListener('click', closeNotes);
  // backdrop click closes only the Settings viewer; the one-time popup is button-only
  $('notes-modal').addEventListener('click', (e) => { if (e.target.id === 'notes-modal' && notesMode === 'history') closeNotes(); });

  // Dropping a currency row anywhere OTHER than a reorder within its own bucket
  // (empty space, another bucket) = offer to remove it. Only preventDefault while a
  // currency drag is live so we don't interfere with any other drag interactions.
  document.addEventListener('dragover', (e) => { if (dragState) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!dragState) return;
    e.preventDefault();
    const ctx = dragState; // capture: dragend clears dragState before an async confirm resolves
    if (!dragReordered) {
      const bucket = (config.buckets || []).find((b) => b.id === ctx.bucketId);
      if (bucket) removeCurrencyPair(bucket, ctx.apiId);
    }
    clearDropMarkers();
  });

  $('btn-refresh').addEventListener('click', () => { logAction('refresh (manual)'); refresh(true); });
  $('btn-hide').addEventListener('click', () => window.api.hide());
  // the nav rail is a SWITCHER, not a scroll-jump: it shows one section card at a
  // time (the content is short enough that scrolling to a section did nothing).
  const setSettingsSection = (sec) => {
    document.querySelectorAll('.set-nav').forEach((n) => n.classList.toggle('active', n.dataset.sec === sec));
    document.querySelectorAll('#settings .set-card').forEach((c) => c.classList.toggle('sec-on', c.id === 'sec-' + sec));
    if (sec === 'networth' && window.NetWorth && window.NetWorth.renderSettings) window.NetWorth.renderSettings(document.getElementById('nw-set-root'));
  };
  // let the Net Worth tab jump straight into its settings section
  window.openNetWorthSettings = () => {
    $('settings').classList.remove('hidden');
    const sc = document.querySelector('#settings .set-scroll'); if (sc) sc.scrollTop = 0;
    setSettingsSection('networth');
  };
  $('btn-settings').addEventListener('click', () => {
    const opening = $('settings').classList.contains('hidden');
    $('settings').classList.toggle('hidden');
    if (opening) {
      renderOverridesGrid(); // refresh the grid's live market placeholders
      const sc = document.querySelector('#settings .set-scroll');
      if (sc) sc.scrollTop = 0;
      setSettingsSection('general'); // always open on the App section
    }
  });
  // "close & return" hides settings; the nav rail switches the visible section
  const setClose = $('set-close');
  if (setClose) setClose.addEventListener('click', () => $('settings').classList.add('hidden'));
  document.querySelectorAll('.set-nav').forEach((nav) => {
    nav.addEventListener('click', () => setSettingsSection(nav.dataset.sec));
  });
  $('btn-quit').addEventListener('click', () => window.api.quit());
  $('btn-add-bucket').addEventListener('click', () => openPicker({ type: 'add-bucket' }));
  $('picker-close').addEventListener('click', closePicker);
  $('picker-search').addEventListener('input', (e) => renderPickerList(e.target.value));
  $('picker-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#picker-list .picker-item:not(.pi-disabled)');
      if (first) first.click(); // typed to one result? Enter picks it
    }
  });
  $('picker').addEventListener('click', (e) => {
    if (e.target.id === 'picker') closePicker();
  });

  // The overlay is shown inactive and never steals focus on its own. The instant
  // the user clicks into it they want to interact - and typing needs OS keyboard
  // focus - so claim it on the first click into an unfocused window. (No click on
  // the overlay during a Ctrl+F, so game focus is untouched there.)
  document.addEventListener('mousedown', () => {
    if (!document.hasFocus() && window.api.focusOverlay) window.api.focusOverlay();
  }, true);

  // click anywhere in the app outside the settings panel closes it (but not
  // during the tutorial, which drives settings itself, and not on sub-overlays
  // launched from settings like the picker/feedback/pencil menu)
  document.addEventListener('mousedown', (e) => {
    const s = $('settings');
    if (s.classList.contains('hidden')) return;
    if (document.body.classList.contains('tut-active')) return;
    if (s.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#btn-settings, #picker, #feedback-modal, #ovr-menu')) return;
    s.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('feedback-modal').classList.contains('hidden')) maybeCloseFeedback();
      else if (pinnedTipEl) unpinTip();
      else if (pickerMode) closePicker();
      else if (!$('settings').classList.contains('hidden')) $('settings').classList.add('hidden');
      else window.api.hide();
    }
  });
  // clicking anywhere that isn't a tooltip cell releases a pinned tooltip -
  // but clicks INSIDE the tooltip (copying, selecting text) never unpin it
  document.addEventListener('click', () => {
    if (pinnedTipEl) unpinTip();
  });
  const tipEl = $('spark-tip');
  tipEl.addEventListener('mouseenter', () => clearTimeout(tipHideTimer));
  tipEl.addEventListener('mouseleave', () => {
    if (!pinnedTipEl) tipEl.classList.add('hidden');
  });
  tipEl.addEventListener('mousedown', (e) => e.stopPropagation());
  // Re-price the route as the size is typed. Rebuilding the whole tooltip would blow
  // away focus mid-keystroke, so only the two gold lines are patched in place.
  tipEl.addEventListener('input', (e) => {
    const box = e.target.closest('.tip-gold-qty');
    if (!box) return;
    const n = parseInt(String(box.value).replace(/[^0-9]/g, ''), 10);
    arbQty = Number.isFinite(n) && n > 0 ? Math.min(n, 10000000) : 0;
    const ctx = lastArbCtx;
    const plan = arbQty ? arbGoldPlan(ctx && ctx.route, arbQty) : null;
    const costEl = tipEl.querySelector('.tip-gold-cost');
    if (costEl) {
      costEl.innerHTML = plan
        ? t('currency.arb.gold_cost', { gold: fmtQty(plan.gold) })
            .replace('<b>', `<b class="${plan.gold >= 1000000 ? 'down' : ''}">`)
        : '';
    }
    const retEl = tipEl.querySelector('.tip-gold-ret');
    if (retEl && ctx) {
      const unit = abbr(nameOf(ctx.baseId)) || nameOf(ctx.baseId);
      retEl.textContent = plan
        ? t('currency.arb.gold_returns', {
            end: fmtQty(Math.round(plan.endsWith)), unit,
            profit: (plan.profit >= 0 ? '+' : '') + fmtQty(Math.round(plan.profit)),
          })
        : '';
    }
  });
  tipEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.tip-gold-qty')) return; // typing a size is not a pin toggle
    if (e.target.closest('.tip-fix')) {
      openRateFix();
      return;
    }
    const src = e.target.closest('.tip-source');
    if (src && src.dataset.href) {
      window.api.openExternal(src.dataset.href); // view this pair's data on poe2scout
      return;
    }
    const btn = e.target.closest('.tip-copy');
    if (btn && lastArbCopyText) {
      navigator.clipboard.writeText(lastArbCopyText).then(
        () => {
          btn.textContent = t('currency.arb.copy_success');
          setTimeout(() => { btn.textContent = t('currency.arb.copy_route_btn'); }, 1400);
        },
        () => { btn.textContent = t('currency.arb.copy_failed'); setTimeout(() => { btn.textContent = t('currency.arb.copy_route_btn'); }, 1400); }
      );
      return;
    }
    // "click again to release" works on the tooltip body too - but never while
    // the user is selecting text INSIDE the tooltip to copy manually. (A stale
    // selection elsewhere on the page must not block closing.)
    const sel = window.getSelection ? window.getSelection() : null;
    const selInTip = sel && !sel.isCollapsed && sel.anchorNode && tipEl.contains(sel.anchorNode);
    if (!selInTip && pinnedTipEl) {
      lastPinToggleAt = Date.now();
      unpinTip();
    }
  });

  // Quick-check (temp) mode: the overlay hides itself once the mouse has
  // visited the app and then leaves it - EE2's mouse-off behavior
  let tempPeek = false, tempEntered = false;
  window.api.onShown(() => {
    logAction('overlay shown');
    unpinTip(); // fresh open starts clean
    tempPeek = false; // a plain show (F6) is never temporary; the temp-mode
    tempEntered = false; // message arrives right after when it is
    refresh(false);
  });
  if (window.api.onTempMode) {
    window.api.onTempMode((v) => { tempPeek = !!v; tempEntered = false; });
  }
  document.documentElement.addEventListener('mouseenter', () => { tempEntered = true; });
  document.documentElement.addEventListener('mouseleave', () => {
    if (tempPeek && tempEntered) {
      tempPeek = false;
      logAction('temp-peek mouse-off hide');
      window.api.hide(true); // return focus to the game so the next Ctrl+Alt+F copies without a click
    }
  });
  window.api.onFeedChanged(() => {
    updateFeedStatus();
    refresh(true);
  });
  window.api.onLiveRates((r) => { liveRates = r || {}; });
  window.api.getLiveRates().then((r) => { liveRates = r || {}; }).catch(() => {});
  // Each time the overlay is brought up, tell main which tab is actually in view so
  // the currency exchange poll runs ONLY while the user is looking at the Currency
  // tab (never on startup, never in the background, never on Price Check/Desecrate).
  const reportVisibleTab = () => {
    const active = document.querySelector('#tabs .tab.active');
    const which = !active ? 'items'
      : active.id === 'tab-currency' ? 'currency'
      : active.id === 'tab-desecrate' ? 'desec' : 'items';
    try { window.api.setActiveTab(which); } catch {}
  };
  if (window.api.onShown) window.api.onShown(reportVisibleTab);

  window.api.onUpdateState(showUpdateBanner);
  window.api.getUpdateState().then(showUpdateBanner).catch(() => {});
  window.api.getAppVersion().then((v) => {
    if (v) $('app-version').textContent = `v${v}`;
  }).catch(() => {});
  $('btn-update').addEventListener('click', () => window.api.installUpdate());

  await initSettings();
  updateFeedStatus();

  // keep the visible freshness label + refresh tooltip's "updated Xs ago" fresh
  setInterval(() => {
    const fl = $('fresh-label');
    if (fl) fl.textContent = fetchedAt ? timeAgo(fetchedAt) : '';
    $('btn-refresh').title = fetchedAt ? t('currency.footer.refresh_title_updated', { time: timeAgo(fetchedAt) }) : t('currency.footer.refresh_title');
  }, 5000);

  render();
  refresh(false);
  maybeShowPatchNotes(); // one-time "what's new" popup after an update
}

main();
