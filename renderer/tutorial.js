'use strict';

// ---------- spotlight tutorial ----------
// Coach-mark engine: dimming backdrop with a cutout, click-shields outside the
// hole, Back/dots/Next, hands-on steps that advance on the user's real action,
// and per-step undo so Back genuinely rewinds creative steps.

const TUT_POLL_MS = 250;
let tutActive = false;
let tutIdx = -1;
let tutTimer = null;
let tutSnapshot = null; // config state at tour start; dismissing restores it
let tutKeepSeed = false; // first run: keep the seeded recommended setup (don't restore)
let tutAcking = false; // an 'already done' acknowledgment card is on screen
let tutLastSkipAt = 0; // skip-button double-click guard
var tutPickRestrict = null; // read by renderer's pickItem/renderPickerList

function tutBucket(baseId) {
  return document.querySelector(`.bucket[data-base="${baseId}"]`);
}
function tutRow(baseId, itemId) {
  const b = tutBucket(baseId);
  return b ? b.querySelector(`.row[data-item="${itemId}"]`) : null;
}
function tutPickerOpen() {
  const p = document.getElementById('picker');
  return p && !p.classList.contains('hidden');
}
const TUT_BASE = 'exalted';

// which section is running: 'currency' (the original tour, sandboxed), or the
// item-tab sections 'pricecheck' / 'desecrate' (driven by a demo item, no API)
let tutSection = 'currency';

// a canned near-perfect desecrated ring so the Price Check + Desecrate spotlights
// have real targets - a live redesecrate? button, real mod rows, a real route
// table - without touching the user's work or firing a search. Deliberately a
// high-value item (five T1 mods): you only omen-chase a desecrated slot on
// something already worth divines, since the omens themselves cost ~9-10 div.
// Desecrated slot is a real hybrid from the abyssal pool (Lightning+Chaos), and
// the item's own resistances are single Fire/Cold - no 1:1 clash, since you
// cannot desecrate a mod the item already carries.
const TUT_DEMO_ITEM = [
  'Item Class: Rings', 'Rarity: Rare', 'Sovereign Whorl', 'Sapphire Ring', '--------',
  'Requirements:', 'Level: 78', '--------', 'Item Level: 82', '--------',
  '{ Prefix Modifier "Virtuoso\'s" (Tier: 1) — Life }', '+112(105-119) to maximum Life',
  '{ Prefix Modifier "Archmage\'s" (Tier: 1) — Mana }', '+69(64-70) to maximum Mana',
  '{ Suffix Modifier "of the Volcano" (Tier: 1) — Elemental, Fire, Resistance }', '+45(43-46)% to Fire Resistance',
  '{ Suffix Modifier "of the Tundra" (Tier: 1) — Elemental, Cold, Resistance }', '+44(43-46)% to Cold Resistance',
  '{ Desecrated Suffix Modifier "of Ulaman" (Tier: 1) — Elemental, Lightning, Chaos, Resistance }', '+16(13-17)% to Lightning and Chaos Resistances',
].join('\n');

// the active step list depends on the section. Each section is a small, flat
// array the existing engine drives unchanged (dots, Back, skip all just work).
function tutSteps() {
  if (tutSection === 'pricecheck') return pricecheckSteps().concat(desecrateSteps());
  if (tutSection === 'desecrate') return desecrateSteps();
  return currencySteps();
}

// icon lookup for the seeded starter setup (applyRecommendedSetup)
function tutIconOf(apiId) {
  const c = catalog[apiId];
  return (c && c.icon) || '';
}
function currencySteps() {
  const exBucket = () => tutBucket(TUT_BASE);
  return [
    {
      title: 'Welcome to POE2 Currency Overlay',
      text: `Floats over your game. Press <b>${esc(config.hotkey || 'F6')}</b> to toggle it (change it in <b>⚙ Settings</b>), <b>Esc</b> to hide; drag the bar to move, edges to resize. Quick tour? Under a minute.`,
      target: () => null
    },
    {
      title: 'Each card is a currency you buy',
      text: 'You\'re set up watching <b>Exalted</b>, <b>Chaos</b> and <b>Divine</b>. Each card is a currency you want to <b>buy</b> - its header names the currency with a small <b>"buying"</b> tag, and the rows beneath are the currencies you\'d <b>pay with</b>.',
      target: () => { const b = exBucket(); return (b && b.querySelector('.bucket-head')) || b; },
      inert: true
    },
    {
      title: 'The BEST row is cheapest',
      text: 'Two ways to buy Exalted here - pay with Chaos or Divine. The row tagged <b>BEST</b> (green) is the <b>cheapest right now</b>; its <b>+%</b> is the edge over the next option, and a red <b>−%</b> on another row shows what that alternative costs you.',
      target: () => exBucket(),
      inert: true
    },
    {
      title: 'Every column is labelled',
      text: '<b>Trend</b> is 7-day history, <b>Price</b> comes from GGG\'s exchange, <b>Vol</b> is how much traded, and <b>Arb</b> lights up when a profitable trade loop starts on that row. <b>Hover any cell</b> for the detail behind it; <b>click</b> to pin it so it stays while you tab into the game.',
      target: () => { const b = exBucket(); return (b && b.querySelector('.bucket-cols')) || b; },
      inert: true
    },
    {
      title: 'Fix a rate, or refresh',
      text: 'Feed prices can lag. Hover a row and click the blue <b>✎</b> to type the rate you see in game - fractions like <b>1/4</b> work - and it drives the math until you clear it. The <b>⟳</b> button pulls fresh prices now (core pairs also refresh every ~30s while you\'re on this tab).',
      target: () => document.getElementById('btn-refresh'),
      inert: true
    },
    {
      title: 'You\'re all set',
      text: 'That\'s the core. <b>⚙ Settings</b> holds manual rates (laid out like Ange), your default currencies, and <b>Replay tutorial</b>. Reorder a bucket\'s payments by dragging the handle on the left, and remove one by dragging it out of the bucket or clicking its <b>✕</b>; add more with <b>+ payment</b>. Next, a quick look at the other two tabs - good hunting, exile.',
      target: () => document.getElementById('btn-settings'),
      inert: true
    }
  ];
}

// ---------- Price Check section (driven by a demo item, no API) ----------
// Reached after the currency tour, or from Settings. A canned desecrated ring is
// loaded (window.ItemTab.demoLoad) before these run, so every target is real.
function pricecheckSteps() {
  return [
    {
      // starts on the REAL landing screen - the surface you paste into
      onArrive: () => { try { if (window.ItemTab) window.ItemTab.demoEmpty(); } catch {} },
      title: 'Price Check: getting an item in',
      text: 'Hover an item in game and press your <b>price-check hotkey</b> (default <b>Ctrl+F</b>) - the overlay opens with it priced. <b>Ctrl+Alt+F</b> is a quick check that hides once your mouse leaves. No overlay open? Copy the item with <b>Ctrl+C</b> and paste it here with <b>Ctrl+V</b>.',
      target: () => document.querySelector('#item-root .paste-prompt'),
      inert: true
    },
    {
      // now load the demo item WITH comparable listings, so results are real
      onArrive: () => { try { if (window.ItemTab) window.ItemTab.demoLoad(TUT_DEMO_ITEM); } catch {} },
      title: 'The results',
      text: 'Here\'s a demo <b>Gloom Coil</b>. Comparable listings appear here cheapest-first, with a <b>suggested floor</b> up top.',
      target: () => document.querySelector('#item-root .results') || document.querySelector('#item-root .suggested'),
      inert: true
    },
    {
      // actually POP the peek on the top comp so the hover payoff is shown, not just described
      onArrive: () => { try { const row = document.querySelector('#item-root .listing'); if (row) row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); } catch {} },
      onExit: () => { try { if (window.api) window.api.itemPeekHide(); } catch {} },
      title: 'Compare on hover',
      text: 'That card beside the overlay popped up from hovering the top comp - every listing does it. It reads line-by-line against your item: <b>green</b> where you\'re ahead, <b>red</b> where it wins, with total resistance and added damage side by side.',
      target: () => document.querySelector('#item-root .listing') || document.querySelector('#item-root .results'),
      inert: true
    },
    {
      title: 'Each mod is a filter',
      text: 'Every line on your item is a search filter - the number shown is the minimum. Turn a line off, loosen it, add one it doesn\'t have, or use the presets below (tier min / exact roll) to set them all at once.',
      target: () => document.querySelector('#item-root .mod'),
      inert: true
    },
    {
      // open the accordion so the toggles are on screen when we point at it
      onArrive: () => { try { if (window.ItemTab) window.ItemTab.setMiscOpen(true); } catch {} },
      title: 'Miscellaneous: cut the junk comps',
      text: 'Easy to miss, worth knowing: toggle out <b>corrupted / crafted / fractured</b> and friends so failed crafts don\'t drag your price down, and choose which <b>Listings</b> to compare against - <b>Instant Buyout</b> by default, the same as in game.',
      target: () => document.querySelector('#item-root .misc-acc'),
      inert: true
    },
    {
      title: 'The redesecrate? button',
      text: 'When an item carries a <b>desecrated</b> mod (the green line on this ring), this appears in the top corner. It opens the <b>Desecrate</b> tab, which works out whether re-rolling that mod with Omens of Light is worth the currency. Let\'s look.',
      target: () => document.querySelector('#item-root .des-corner'),
      inert: true
    }
  ];
}

// ---------- Desecrate section ----------
// onArrive on the first step makes sure the demo item is loaded and the tab is
// showing its analysis (demoDesecrate passes a canned floor, so no search fires).
function desecrateSteps() {
  return [
    {
      onArrive: () => { try { tutEnterDesecrate(); } catch {} },
      title: 'Desecrate: is re-rolling worth it?',
      text: 'Chasing a better mod with <b>Omens of Light</b> isn\'t obvious to price out. This tab does it for you: it takes your item, its current worth, and the odds, and tells you whether to spam - and which route.',
      target: () => document.querySelector('#desecrate-root .des-item') || document.querySelector('#desecrate-root .des-sec'),
      inert: true
    },
    {
      onArrive: () => { try { tutEnterDesecrate(); } catch {} },
      title: 'Pick what counts as a hit',
      text: 'Tick the outcomes you\'d be happy to land, and the <b>worst tier</b> you\'d still keep. The app weights each by its real spawn chance - so "a hit" means an outcome you\'d actually stop on, not just any change.',
      target: () => document.querySelector('#desecrate-root .des-list') || document.querySelector('#desecrate-root .des-sec'),
      inert: true
    },
    {
      onArrive: () => { try { tutEnterDesecrate(); } catch {} },
      title: 'The routes, and the verdict',
      text: 'It prices your item as it stands and with a hit, then compares the routes (Preserved, Ancient) with real odds, expected bones and net profit. The <b>verdict</b> up top is the bottom line: spam, or move on. That\'s the tour - happy hunting.',
      target: () => document.querySelector('#desecrate-root .des-routes') || document.querySelector('#desecrate-root .des-verdict') || document.querySelector('#desecrate-root .des-sec'),
      inert: true
    }
  ];
}

// enter the Desecrate tab on the demo item without firing a search
function tutEnterDesecrate() {
  if (window.ItemTab && !window.ItemTab.demoActive()) {
    // arrived here directly (Settings dropdown): load the demo first
    window.ItemTab.demoLoad(TUT_DEMO_ITEM);
  }
  if (window.ItemTab) window.ItemTab.demoDesecrate();
  const tab = document.getElementById('tab-desecrate');
  if (tab) tab.click();
}

// ---------- guaranteed demo arbitrage (real UI, temporary injected rate) ----------
let tutDemoBackup; // undefined = not injected; otherwise {had, entry}

function tutInjectDemo() {
  const ch = catalog['chaos'];
  if (!ch || !(ch.price > 0)) return;
  const key = ['chaos', 'exalted'].sort().join('|');
  const rates = (config.overrides && config.overrides.rates) || {};
  if (tutDemoBackup === undefined) {
    tutDemoBackup = {
      had: key in pairs,
      entry: pairs[key],
      o1: rates['chaos>exalted'],
      o2: rates['exalted>chaos']
    };
  }
  // the user's own step-10 override beats market data by design and would hide
  // the demo - park it for the duration of the demo steps
  delete rates['chaos>exalted'];
  delete rates['exalted>chaos'];
  pairs[key] = { chaos: ch.price * 0.85, exalted: 1, __vol: 999999, __tutDemo: true };
}

function tutRestoreDemo() {
  if (tutDemoBackup === undefined) return;
  const key = ['chaos', 'exalted'].sort().join('|');
  if (tutDemoBackup.had) pairs[key] = tutDemoBackup.entry;
  else delete pairs[key];
  if (config.overrides && config.overrides.rates) {
    if (tutDemoBackup.o1 != null) config.overrides.rates['chaos>exalted'] = tutDemoBackup.o1;
    if (tutDemoBackup.o2 != null) config.overrides.rates['exalted>chaos'] = tutDemoBackup.o2;
  }
  tutDemoBackup = undefined;
  try { unpinTip(); } catch {}
  try { render(); } catch {}
}

// ---------- engine ----------
const TUT_SHIELDS = ['top', 'left', 'right', 'bottom'];

function tutShields() {
  return TUT_SHIELDS.map((side) => {
    let s = document.getElementById(`tut-shield-${side}`);
    if (!s) {
      s = document.createElement('div');
      s.id = `tut-shield-${side}`;
      s.className = 'tut-shield';
      s.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
      s.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
      document.body.appendChild(s);
    }
    return s;
  });
}

function tutShieldAround(rect) {
  const [top, left, right, bottom] = tutShields();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const set = (el, l, t, w, h) => {
    el.style.display = w > 0 && h > 0 ? 'block' : 'none';
    el.style.left = `${l}px`;
    el.style.top = `${t}px`;
    el.style.width = `${Math.max(0, w)}px`;
    el.style.height = `${Math.max(0, h)}px`;
  };
  if (!rect) {
    set(top, 0, 0, W, H); set(left, 0, 0, 0, 0); set(right, 0, 0, 0, 0); set(bottom, 0, 0, 0, 0);
    return;
  }
  set(top, 0, 0, W, rect.top);
  set(left, 0, rect.top, rect.left, rect.height);
  set(right, rect.right, rect.top, W - rect.right, rect.height);
  set(bottom, 0, rect.bottom, W, H - rect.bottom);
}

function tutShieldsOff() {
  tutShields().forEach((s) => { s.style.display = 'none'; });
  tutOverShield(null);
}

// display-only spotlights (step.inert): a transparent shield sits ON the hole so
// the highlighted content can be seen but not clicked (e.g. the bucket's +/x)
function tutOverShield(hole) {
  let s = document.getElementById('tut-shield-over');
  if (!s) {
    s = document.createElement('div');
    s.id = 'tut-shield-over';
    s.className = 'tut-shield';
    s.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    s.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
    document.body.appendChild(s);
  }
  const r = hole && hole._tutRect;
  if (!r || !(r.w > 0 && r.h > 0)) { s.style.display = 'none'; return; }
  s.style.display = 'block';
  s.style.left = `${r.x}px`;
  s.style.top = `${r.y}px`;
  s.style.width = `${r.w}px`;
  s.style.height = `${r.h}px`;
}

function tutDom() {
  let hole = document.getElementById('tut-hole');
  if (!hole) {
    hole = document.createElement('div');
    hole.id = 'tut-hole';
    document.body.appendChild(hole);
  }
  let card = document.getElementById('tut-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'tut-card';
    card.innerHTML =
      '<div id="tut-title"></div><div id="tut-text"></div>' +
      '<div id="tut-action-row" class="hidden"><button id="tut-action" class="mini-btn"></button></div>' +
      '<div id="tut-foot">' +
      '<span class="tut-left"><button id="tut-back" class="tut-nav" title="Back">←</button><span id="tut-dots"></span></span>' +
      '<span class="tut-btns"><button id="tut-skip-step" class="hidden">skip step</button>' +
      '<button id="tut-next" class="mini-btn">Next</button></span></div>' +
      '<div id="tut-dismiss"><span id="tut-later">dismiss for now</span>' +
      '<span id="tut-never">don\'t show again</span></div>';
    document.body.appendChild(card);
    document.getElementById('tut-next').addEventListener('click', () => tutAdvance());
    document.getElementById('tut-skip-step').addEventListener('click', () => {
      // one skip per click: a double-click must not run the NEXT step's completion too
      if (tutAcking || Date.now() - tutLastSkipAt < 400) return;
      tutLastSkipAt = Date.now();
      const step = tutSteps()[tutIdx];
      // a skip JUMPS: the hole/card snap to the next step instead of gliding
      // across the screen - the glide reads as a ghost animation
      tutSnapOnce();
      if (step && step.complete) { try { step.complete(); } catch {} }
      tutAdvance();
    });
    document.getElementById('tut-back').addEventListener('click', () => tutBack());
    document.getElementById('tut-action').addEventListener('click', async () => {
      const step = tutSteps()[tutIdx];
      if (step && step.action) { try { await step.action.fn(); } catch {} }
      tutAdvance();
    });
    document.getElementById('tut-later').addEventListener('click', () => endTutorial('later'));
    document.getElementById('tut-never').addEventListener('click', () => endTutorial('never'));
  }
  return { hole, card };
}

// suppress the hole/card position transitions for the current reposition only
function tutSnapOnce() {
  const els = [document.getElementById('tut-hole'), document.getElementById('tut-card')].filter(Boolean);
  els.forEach((el) => { el.style.transition = 'none'; });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    els.forEach((el) => { el.style.transition = ''; });
  }));
}

function tutRenderDots(idx, total) {
  const wrap = document.getElementById('tut-dots');
  wrap.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('span');
    d.className = 'tut-dot' + (i === idx ? ' on' : i < idx ? ' done' : '');
    wrap.appendChild(d);
  }
}

function tutPosition(step) {
  const { hole, card } = tutDom();
  if (tutPickerOpen() && !step.noPickerMode) {
    const panel = document.querySelector('#picker .picker-panel') || document.getElementById('picker');
    // floating surface: the hole's inner edge sits flush on the panel's outer edge
    placeHoleAndCard(hole, card, panel.getBoundingClientRect(), 0);
    tutOverShield(null);
    return;
  }
  const el = step.target ? step.target() : null;
  let er = el ? el.getBoundingClientRect() : null;
  // a target below the fold (e.g. the Desecrate routes at the bottom of a long
  // scroll) drags the hole off-screen and the card clamps to the window edge,
  // disconnected. Scroll it into view first so both land on-screen.
  if (el && er && er.height > 0 && (er.top < 0 || er.bottom > window.innerHeight)) {
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    er = el.getBoundingClientRect();
  }
  if (el && er && er.width > 0 && er.height > 0) {
    const row = el.closest ? el.closest('.row') : null;
    const inRow = row && row !== el;
    const floating = el.id === 'spark-tip' || getComputedStyle(el).position === 'fixed';
    // snug rule: flush on floating elements, row-bounded for in-row content,
    // 3px breathing room for ordinary inline controls - never a leaky halo
    const rect = inRow ? tutTargetRect(el, er) : er;
    placeHoleAndCard(hole, card, rect, inRow || floating ? 0 : 3);
    tutOverShield(step.inert ? hole : null);
  } else {
    hole.style.display = 'block';
    // numeric + via tutSetRect: raw % styles would poison the position cache and
    // silently skip the next real placement as "unchanged"
    tutSetRect(hole, Math.round(window.innerWidth / 2), Math.round(window.innerHeight * 0.4), 0, 0);
    tutShieldAround(null); // no target: card is the only interactive surface
    tutOverShield(null);
    card.style.display = 'block';
    tutSetPos(card, Math.max(6, (window.innerWidth - card.offsetWidth) / 2), Math.max(6, window.innerHeight * 0.28));
  }
}

// apply a fixed rect only when it meaningfully changed - constantly re-setting
// identical values keeps CSS transitions perpetually mid-flight and the hole
// visibly drifts off its target
function tutSetRect(el, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const p = el._tutRect || {};
  if (Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1 && Math.abs(p.w - w) < 1 && Math.abs(p.h - h) < 1) return;
  el._tutRect = { x, y, w, h };
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

function tutSetPos(el, x, y) {
  // hard viewport clamp: the card carries the tour's only controls - if it ever
  // leaves the screen the user is locked out of the tutorial entirely
  x = Math.max(6, Math.min(window.innerWidth - el.offsetWidth - 6, Math.round(x)));
  y = Math.max(6, Math.min(window.innerHeight - el.offsetHeight - 6, Math.round(y)));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const p = el._tutPos || {};
  if (Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1) return;
  el._tutPos = { x, y };
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

// For cells inside a table row: the highlight hugs the visible TEXT
// horizontally but spans the ROW's height vertically - a hole that clings to
// the cell box sits lopsided against the row and looks broken.
function tutTargetRect(el, er) {
  const row = el.closest ? el.closest('.row') : null;
  if (!row || row === el) return er;
  let tr = er;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rr = range.getBoundingClientRect();
    if (rr && rr.width > 0) tr = rr;
  } catch {}
  const rowR = row.getBoundingClientRect();
  // exact row bounds vertically; small horizontal breathing room around the text
  return {
    left: tr.left - 4,
    right: tr.right + 4,
    width: tr.width + 8,
    top: rowR.top,
    bottom: rowR.bottom,
    height: rowR.height
  };
}

function placeHoleAndCard(hole, card, r, pad) {
  const hx = r.left - pad, hy = r.top - pad, hw = r.width + pad * 2, hh = r.height + pad * 2;
  hole.style.display = 'block';
  tutSetRect(hole, hx, hy, hw, hh);
  tutShieldAround({ left: hx, top: hy, width: hw, height: hh, right: hx + hw, bottom: hy + hh });
  card.style.display = 'block';
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const below = window.innerHeight - (hy + hh);
  const above = hy;
  const rightSpace = window.innerWidth - (hx + hw);
  const leftSpace = hx;
  if (below >= ch + 14) {
    tutSetPos(card, Math.max(6, Math.min(window.innerWidth - cw - 6, hx + hw / 2 - cw / 2)), hy + hh + 8);
  } else if (above >= ch + 14) {
    tutSetPos(card, Math.max(6, Math.min(window.innerWidth - cw - 6, hx + hw / 2 - cw / 2)), hy - ch - 8);
  } else if (rightSpace >= cw + 14) {
    // tall target (e.g. a pinned tooltip): sit beside it, never on top of it
    tutSetPos(card, hx + hw + 8, Math.max(6, Math.min(window.innerHeight - ch - 6, hy + hh / 2 - ch / 2)));
  } else if (leftSpace >= cw + 14) {
    tutSetPos(card, hx - cw - 8, Math.max(6, Math.min(window.innerHeight - ch - 6, hy + hh / 2 - ch / 2)));
  } else {
    // last resort: directly below the hole, clamped to the window - and if
    // that still intersects the hole, slide to the roomier side. The card may
    // cover other UI in this state but NEVER the thing it points at.
    let ty = Math.min(hy + hh + 8, window.innerHeight - ch - 6);
    let tx = Math.max(6, Math.min(window.innerWidth - cw - 6, hx + hw / 2 - cw / 2));
    const overlaps = ty < hy + hh && ty + ch > hy && tx < hx + hw && tx + cw > hx;
    if (overlaps) {
      tx = leftSpace > rightSpace
        ? Math.max(6, hx - cw - 8)
        : Math.min(window.innerWidth - cw - 6, hx + hw + 8);
      ty = Math.max(6, Math.min(window.innerHeight - ch - 6, hy + hh / 2 - ch / 2));
    }
    tutSetPos(card, tx, ty);
  }
}

function tutShow(step, idx, total) {
  tutDom();
  document.getElementById('tut-title').textContent = step.title;
  document.getElementById('tut-text').innerHTML = step.text;
  tutRenderDots(idx, total);
  const nextBtn = document.getElementById('tut-next');
  const skipStepBtn = document.getElementById('tut-skip-step');
  const actionBtn = document.getElementById('tut-action');
  const backBtn = document.getElementById('tut-back');
  const handsOn = typeof step.until === 'function';
  nextBtn.classList.toggle('hidden', handsOn);
  nextBtn.textContent = step.nextLabel || (idx === total - 1 ? 'Finish' : 'Next');
  skipStepBtn.classList.toggle('hidden', !handsOn);
  backBtn.classList.toggle('hidden', idx === 0);
  if (step.action) {
    actionBtn.textContent = step.action.label;
    document.getElementById('tut-action-row').classList.remove('hidden');
  } else {
    document.getElementById('tut-action-row').classList.add('hidden');
  }
  if (step.onEnter) { try { step.onEnter(); } catch {} }
  tutPosition(step);
}

function tutLeaveStep() {
  const steps = tutSteps();
  const prev = steps[tutIdx];
  if (prev && prev.onExit) { try { prev.onExit(); } catch {} }
  tutPickRestrict = null;
  document.querySelectorAll('.tut-force').forEach((el) => el.classList.remove('tut-force'));
  document.querySelectorAll('.tut-force-head').forEach((el) => el.classList.remove('tut-force-head'));
  try { if (tutPickerOpen()) renderPickerList($('picker-search').value); } catch {}
}

function tutAdvance() {
  const steps = tutSteps();
  tutLeaveStep();
  tutIdx++;
  if (tutIdx >= steps.length) { endTutorial('complete'); return; }
  const step = steps[tutIdx];
  // onArrive runs BEFORE the already-done check - steps use it to (re)establish
  // their preconditions so they cannot self-skip or arrive without a target
  if (step.onArrive) { try { step.onArrive(); } catch {} }
  if (typeof step.until === 'function' && step.until()) {
    tutAcking = true;
    tutShow({ ...step, text: step.already || step.text, until: undefined }, tutIdx, steps.length);
    const at = tutIdx; // orphaned timers must never advance a later step
    setTimeout(() => {
      if (tutActive && tutIdx === at) { tutAcking = false; tutAdvance(); }
    }, 1000);
    return;
  }
  tutAcking = false;
  try { if (window.logAction) window.logAction(`tutorial step ${tutIdx}: ${step.title}`); } catch {}
  tutShow(step, tutIdx, steps.length);
}

function tutBack() {
  if (tutIdx <= 0) return;
  tutAcking = false; // leaving an ack card by Back must re-arm the tick's until-check
  const steps = tutSteps();
  // undo the current step's partial state AND the previous step's completed
  // creation, so the previous step is genuinely redoable
  for (const i of [tutIdx, tutIdx - 1]) {
    const s = steps[i];
    if (s && s.undo) { try { s.undo(); } catch {} }
  }
  tutLeaveStep();
  tutIdx--;
  const target = steps[tutIdx];
  if (target.onArrive) { try { target.onArrive(); } catch {} }
  tutShow(target, tutIdx, steps.length);
}

function tutTick() {
  if (!tutActive) return;
  const steps = tutSteps();
  const step = steps[tutIdx];
  if (!step) return;
  if (step.keepDemo) {
    const key = ['chaos', 'exalted'].sort().join('|');
    if (!pairs[key] || !pairs[key].__tutDemo) {
      tutInjectDemo();
      try { render(); } catch {}
    }
  }
  tutPosition(step);
  // during an acknowledgment card the scheduled timer owns advancement - the
  // tick advancing too is how steps got double-skipped
  if (!tutAcking && typeof step.until === 'function' && step.until()) tutAdvance();
}

async function startTutorial(section = 'currency') {
  if (tutActive) return;
  tutSection = section === 'pricecheck' || section === 'desecrate' ? section : 'currency';
  tutIdx = -1;
  if (tutSection === 'currency') {
    // the app now opens on Price Check, so the currency tour must bring the
    // Currency tab forward itself (this is also what starts its live-rate poll)
    try { const t = document.getElementById('tab-currency'); if (t) t.click(); } catch {}
    try {
      tutSnapshot = JSON.stringify({
        buckets: config.buckets || [],
        defaultItems: config.defaultItems || [],
        autoAddDefaults: !!config.autoAddDefaults,
        overrides: config.overrides || { enabled: false, rates: {}, ratesAt: {} }
      });
    } catch { tutSnapshot = null; }
    // First run with nothing set up: the recommended trio we seed BECOMES the
    // user's setup (kept when the tour ends). Otherwise - a replay, or an existing
    // setup - we restore the snapshot at the end so their work is untouched. Either
    // way we annotate a real, working setup instead of building one then wiping it.
    tutKeepSeed = !(config && config.tutorialDone) && !((config.buckets || []).length);
    try { applyRecommendedSetup(); } catch {}
  } else {
    // item sections: no currency sandbox, nothing hits the API. Price Check
    // opens on the real paste/landing screen (step 1); the demo item loads at
    // the results step. Desecrate jumps straight in on the demo item.
    try {
      $('settings').classList.add('hidden');
      const itemsTab = document.getElementById('tab-items');
      if (itemsTab) itemsTab.click();
      if (tutSection === 'desecrate') {
        if (window.ItemTab) await window.ItemTab.demoLoad(TUT_DEMO_ITEM);
        tutEnterDesecrate();
      } else if (window.ItemTab) {
        window.ItemTab.demoEmpty();
      }
    } catch {}
  }
  tutActive = true;
  document.body.classList.add('tut-active');
  tutDom();
  tutTimer = setInterval(tutTick, TUT_POLL_MS);
  tutAdvance();
}

// mode: 'complete' | 'later' (re-offers next launch) | 'never'
function endTutorial(mode) {
  tutActive = false;
  clearInterval(tutTimer);
  tutTimer = null;
  tutPickRestrict = null;
  document.body.classList.remove('tut-active');
  const hole = document.getElementById('tut-hole');
  const card = document.getElementById('tut-card');
  if (hole) hole.style.display = 'none';
  if (card) card.style.display = 'none';
  tutShieldsOff();
  try { if (window.api) window.api.itemPeekHide(); } catch {} // never leave the hover-demo peek stranded
  tutRestoreDemo();
  document.querySelectorAll('.tut-force').forEach((el) => el.classList.remove('tut-force'));
  document.querySelectorAll('.tut-force-head').forEach((el) => el.classList.remove('tut-force-head'));
  try { if (tutPickerOpen()) closePicker(); } catch {}
  $('settings').classList.add('hidden'); // leave the user on a clean overlay

  // Item sections have their own teardown: drop the demo item, restore whatever
  // the user had on the Price Check tab, and never touch currency or the recommend
  // flow. mode 'never' still marks the whole tutorial done.
  if (tutSection !== 'currency') {
    const wasSection = tutSection;
    tutSection = 'currency';
    try { if (window.ItemTab) window.ItemTab.demoClear(); } catch {}
    try { const t = document.getElementById('tab-items'); if (t) t.click(); } catch {}
    if (mode === 'never' && config && !config.tutorialDone) {
      config.tutorialDone = true;
      window.api.setTutorialDone().catch(() => {});
    }
    if (mode === 'never') showTutFarewell();
    void wasSection;
    return;
  }

  // First run seeded the recommended setup and KEEPS it - the user ends the tour
  // already on a working setup, nothing built-then-wiped. A replay (or a run over
  // an existing setup) restores the snapshot in full, so their work is untouched.
  if (!tutKeepSeed && tutSnapshot) {
    try {
      const s = JSON.parse(tutSnapshot);
      config.buckets = s.buckets;
      config.defaultItems = s.defaultItems;
      config.autoAddDefaults = s.autoAddDefaults;
      config.overrides = s.overrides;
      persistBuckets();
      window.api.setDefaults(config.defaultItems, config.autoAddDefaults).catch(() => {});
      window.api.setOverrides(config.overrides).catch(() => {});
      try {
        $('auto-defaults').checked = !!config.autoAddDefaults;
        renderDefaults();
        renderOverridesGrid();
      } catch {}
      render();
    } catch {}
  }
  tutSnapshot = null;
  tutKeepSeed = false;
  if ((mode === 'complete' || mode === 'never') && config && !config.tutorialDone) {
    config.tutorialDone = true;
    window.api.setTutorialDone().catch(() => {});
  }
  if (mode === 'never') showTutFarewell();
  // no more "apply recommended?" modal - they're already on a working setup;
  // completion goes straight to offering the Price Check + Desecrate tour
  if (mode === 'complete') showTutItemTourOffer();
}

// ---------- recommended starter setup (offered after every completed tour) ----------
function applyRecommendedSetup() {
  const trio = [
    { apiId: 'exalted', category: 'currency', text: 'Exalted Orb' },
    { apiId: 'chaos', category: 'currency', text: 'Chaos Orb' },
    { apiId: 'divine', category: 'currency', text: 'Divine Orb' }
  ].map((t) => ({ ...t, icon: tutIconOf(t.apiId) }));
  config.defaultItems = trio.map((t) => ({ ...t }));
  config.autoAddDefaults = true;
  config.buckets = trio.map((t) => ({
    id: `b-${t.apiId}`,
    base: { ...t },
    items: trio.filter((x) => x.apiId !== t.apiId).map((x) => ({ ...x }))
  }));
  persistBuckets();
  window.api.setDefaults(config.defaultItems, true).catch(() => {});
  try { $('auto-defaults').checked = true; renderDefaults(); } catch {}
  render();
  refresh(false);
}

// Opt-in gate for the Price Check + Desecrate tour (offered after the currency
// setup choice). Declining leaves the user on their clean overlay - the currency
// tour already told them how to replay from Settings.
function showTutItemTourOffer() {
  const old = document.getElementById('tut-item-offer');
  if (old) old.remove();
  const m = document.createElement('div');
  m.id = 'tut-item-offer';
  m.innerHTML =
    '<div class="tut-farewell-card"><div id="tut-title">See the other two tabs?</div>' +
    '<div id="tut-text" class="tut-modal-text">A quick, hands-off look at <b>Price Check</b> and the <b>Desecrate</b> calculator on a sample item. Takes about a minute, and you can stop any time.</div>' +
    '<div class="tut-modal-foot">' +
    '<button class="tut-nav" id="tut-item-no">No thanks</button>' +
    '<button class="mini-btn" id="tut-item-yes">Show me</button></div></div>';
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector('#tut-item-yes').addEventListener('click', () => { close(); startTutorial('pricecheck'); });
  m.querySelector('#tut-item-no').addEventListener('click', close);
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
}

function showTutFarewell() {
  let m = document.getElementById('tut-farewell');
  if (!m) {
    m = document.createElement('div');
    m.id = 'tut-farewell';
    m.innerHTML =
      '<div class="tut-farewell-card"><div id="tut-title">Tutorial dismissed</div>' +
      '<div id="tut-text" class="tut-modal-text">You can run it again any time from ' +
      '<b>⚙ Settings → Replay tutorial</b>.</div>' +
      '<div class="tut-modal-foot tut-modal-foot-end"><button class="mini-btn" id="tut-farewell-ok">Got it</button></div></div>';
    document.body.appendChild(m);
    m.querySelector('#tut-farewell-ok').addEventListener('click', () => m.remove());
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  }
}

// wire up: replay dropdown + first-run auto start when the overlay is first shown
(function initTutorial() {
  // replay tutorial: one chip per section (replaces a native <select> whose open
  // list can't be styled)
  document.querySelectorAll('.tut-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const section = chip.dataset.tut;
      if (!section || tutActive) return;
      $('settings').classList.add('hidden');
      startTutorial(section);
    });
  });
  window.api.onShown(() => {
    if (config && !config.tutorialDone && !tutActive) {
      setTimeout(() => {
        if (config && !config.tutorialDone && !tutActive) startTutorial();
      }, 600);
    }
  });
})();
