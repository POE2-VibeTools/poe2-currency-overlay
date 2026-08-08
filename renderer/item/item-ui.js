// item-ui.js - renders the Items (price-check) tab from a plain state object.
// DOM-only, no framework. Talks to the app via injected handlers so it's testable with mocks.
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hlNums = (s) => esc(s).replace(/\d+(?:\.\d+)?/g, '<span class="num">$&</span>');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  function ageStr(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return t('item.misc.age_seconds', { n: s });
    if (s < 3600) return t('item.misc.age_minutes', { n: Math.floor(s / 60) });
    if (s < 86400) return t('item.misc.age_hours', { n: Math.floor(s / 3600) });
    return t('item.misc.age_days', { n: Math.floor(s / 86400) });
  }
  // a price worth a divine or more, quoted in exalts/chaos, is unreadable
  // ("8888 exalted") - append the divine equivalent (shared helper in renderer.js)
  const divAside = (p) => (p && p.amount != null && window.divAsideHtml
    ? window.divAsideHtml(p.amount, p.currency) : '');
  // the floor gets the full major-currency conversion, not just a divine aside -
  // it's the number people act on, and a divine price alone isn't actionable
  const floorAside = (p) => (p && p.amount != null && window.majorAsideHtml
    ? window.majorAsideHtml(p.amount, p.currency) : divAside(p));

  // unit as icon (Settings > "Show currency icons instead of names") or the
  // plain escaped currency text, whichever the toggle calls for
  const curUnitHtml = (currency, cls) => {
    const tag = window.currencyIconTag && window.currencyIconTag(currency);
    if (tag) return tag;
    const text = esc(currency || '');
    return cls ? `<span class="${cls}">${text}</span>` : text;
  };

  function priceHtml(p) {
    if (!p || p.amount == null) return '<span class="cur">unpriced</span>';
    return `${p.amount} ${curUnitHtml(p.currency, 'cur')}${divAside(p)}`;
  }

  // GGG's misc_filters, the subset that actually moves a price. Laid out down
  // the left column first (see .misc-grid), so this order reads top-left down,
  // then top-right down.
  const MISC_FILTERS = [
    ['corrupted', t('item.misc.filter_corrupted')], ['crafted', t('item.misc.filter_crafted')],
    ['desecrated', t('item.misc.filter_desecrated')], ['fractured_item', t('item.misc.filter_fractured')],
    ['twice_corrupted', t('item.misc.filter_twice_corrupted')], ['sanctified', t('item.misc.filter_sanctified')],
    ['mirrored', t('item.misc.filter_mirrored')],
    // GGG's misc_filters.identified. Without a control here there was no way to search
    // for unidentified items at all unless you happened to be holding one - the filter
    // only ever got set automatically off a parsed item.
    ['identified', t('item.misc.filter_identified')],
  ];

  // GGG's own status_filters enum, their wording. 'securable' is the game's
  // "Instant Buyout" - the listings you can actually buy - and our default.
  const SALE_TYPES = [
    ['securable', t('item.search.sale_type_securable')],
    ['available', t('item.search.sale_type_available')],
    ['onlineleague', t('item.search.sale_type_onlineleague')],
    ['online', t('item.search.sale_type_online')],
    ['any', t('item.search.any_option')],
  ];
  // GGG's trade_filters.indexed, their wording. A stale month-old listing at an old
  // price pulls the whole comp set up, which is what "the results look inflated"
  // means in practice. Default null = Any Time, i.e. unchanged from before.
  const LISTED_WINDOWS = [
    ['', t('item.search.listed_any')],
    ['1hour', t('item.search.listed_1hour')],
    ['3hours', t('item.search.listed_3hours')],
    ['12hours', t('item.search.listed_12hours')],
    ['1day', t('item.search.listed_1day')],
    ['3days', t('item.search.listed_3days')],
    ['1week', t('item.search.listed_1week')],
    ['2weeks', t('item.search.listed_2weeks')],
    ['1month', t('item.search.listed_1month')],
  ];

  const KIND_LABEL = { 'added-rune': t('item.mods.kind_augment'), rune: t('item.mods.kind_rune'), implicit: t('item.mods.kind_implicit'), crafted: t('item.mods.kind_crafted'), desecrated: t('item.mods.kind_desecrated'), fractured: t('item.mods.kind_fractured'), enchant: t('item.mods.kind_enchant'), skill: t('item.mods.kind_skill'), sanctum: t('item.mods.kind_sanctum'), property: t('item.mods.kind_property'), pseudo: t('item.mods.kind_pseudo') };
  // compact status abbreviations shown right of the name in result rows
  const LI_FLAG_ABBR = { 'Corrupted': t('item.listings.flag_corrupted_abbr'), 'Twice Corrupted': t('item.listings.flag_twice_corrupted_abbr'), 'Desecrated': t('item.listings.flag_desecrated_abbr'), 'Fractured': t('item.listings.flag_fractured_abbr'), 'Sanctified': t('item.listings.flag_sanctified_abbr'), 'Mirrored': t('item.listings.flag_mirrored_abbr'), 'Split': t('item.listings.flag_split_abbr'), 'Unmodifiable': t('item.listings.flag_unmodifiable_abbr'), 'Unidentified': t('item.listings.flag_unidentified_abbr') };

  // "Adds 27 to 45 Fire damage to Attacks" reads as two numbers you then have to
  // average in your head - and the average IS the value the search ranks on. So
  // show it inline: "Adds 27 to 45 (36) ...". Computed from the numbers actually
  // shown, so a catalyst-scaled line still brackets its own displayed average.
  // Flat damage only (mod.form === 'flat'); nothing else has a two-number roll.
  function withAvg(mod) {
    const t = mod.text || mod.id || '';
    if (mod.form !== 'flat') return t;
    const m = /Adds (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/.exec(t);
    if (!m) return t;
    const avg = (parseFloat(m[1]) + parseFloat(m[2])) / 2;
    const avgStr = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
    const cut = m.index + m[0].length;
    return `${t.slice(0, cut)} (${avgStr})${t.slice(cut)}`;
  }

  // --- mod row ---
  // Refined Ember layout: grid [56px kind rail | 1fr mod text | auto min/max | auto menu].
  // The range slider is gone as a column - it renders as a 2px track along the row's
  // bottom edge (see .mod-sl / .has-track), driven by the SAME window.makeSlider so the
  // drag math and input sync are unchanged. `fold` (5th arg) carries the inline fold
  // toggle for a fold-head row, or null.
  function modRow(mod, i, h, opts, fold) {
    const kind = mod.kind || 'explicit';
    const kindLabel = KIND_LABEL[kind] || kind;
    const row = el('div', 'mod' + (mod.mode === 'off' ? ' off' : '') + (kind !== 'explicit' ? ` k-${esc(kind)}` : ''));
    if (!mod.id) {
      // no trade filter exists for this line (in this scope) - visibly unsearchable
      const na = el('span', 'mode-pill off', t('item.mods.na_label'));
      na.title = t('item.mods.na_tooltip');
      row.appendChild(na);
      row.appendChild(el('span', 'mod-text', hlNums(mod.text || '')));
      return row;
    }
    if (mod.group) {
      // make-fungible member: matches if ANY mod in its group is present
      const chip = el('span', 'or-chip', t('item.mods.or_chip'));
      chip.title = t('item.mods.or_chip_tooltip');
      row.appendChild(chip);
    } else {
      // the pill IS the game's mod-type tag, now a flat colored rail tag. FUNGIBLE is
      // our own term (and feature): this roll matches equivalent rolls of other elements
      // (count-1, weighted when logged in). "Pseudo" stays reserved for true aggregate
      // filters like total res.
      const mode = mod.mode || 'strict';
      // kind 'pseudo' = a REAL GGG pseudo stat line (total res etc.), shown as
      // its own row; the pseudo-mode styling doubles as its look when active
      const pill = el('span', `mode-pill k-${esc(kind)} ${kind === 'pseudo' && mode !== 'off' ? 'pseudo' : mode}`,
        mode === 'pseudo' ? t('item.mods.kind_fungible') : kindLabel);
      pill.onclick = () => h.onModeToggle && h.onModeToggle(i);
      pill.title = mode === 'off' ? t('item.mods.pill_tooltip_off')
        : kind === 'pseudo'
          ? (mod.editableMin
            ? t('item.mods.pill_tooltip_pseudo_editable')
            : t('item.mods.pill_tooltip_pseudo_fixed'))
          : t('item.mods.pill_tooltip_cycle');
      row.appendChild(pill);
    }

    // The tier's own span reads as part of the line, the way the game prints it:
    // "(5-15) 15% increased Spell Damage". A simple copy reports min = max = the
    // roll, which is an UNKNOWN range, and "(16-16)" would claim the mod always
    // rolls exactly that - so those stay bare.
    const degenerate = mod.rangesKnown === false && mod.min === mod.max;
    const showRange = mod.min != null && mod.max != null && !degenerate;
    // The bracket before the mod is the TIER range; the mod can also roll a wider
    // FULL range across all tiers. When the slider track is shown it carries that
    // full range on its end-labels, so the bracket stays the tier alone. With no
    // track (sliders off / off mods), nest the full range into the bracket so the
    // two numbers read as related - "this tier, of the full span" - instead of two
    // loose ranges competing on the line.
    const showSlider = opts && opts.__showSliders !== false;
    const hasSlider = !!(showSlider && mod.sliderMin != null && mod.sliderMax != null && mod.mode !== 'off' && window.makeSlider);
    const fullRange = mod.sliderMin != null && mod.sliderMax != null && (mod.sliderMin !== mod.min || mod.sliderMax !== mod.max);
    const bracketInner = (!hasSlider && fullRange) ? t('item.mods.tier_of_full_range', { min: mod.min, max: mod.max, sliderMin: mod.sliderMin, sliderMax: mod.sliderMax }) : `${mod.min}-${mod.max}`;
    const rangeHtml = showRange
      ? `<span class="rng mod-rng" title="${esc(
          (mod.tier != null
            ? t('item.mods.tier_range_tier', { tier: mod.tier, min: mod.min, max: mod.max })
            : t('item.mods.tier_range_base', { min: mod.min, max: mod.max }))
          + (fullRange ? t('item.mods.tier_range_full', { sliderMin: mod.sliderMin, sliderMax: mod.sliderMax }) : '')
        )}">(${bracketInner})</span> `
      : '';
    const textSpan = el('span', 'mod-text', rangeHtml + hlNums(withAvg(mod)));
    textSpan.title = mod.text || ''; // every row can ellipsize now - keep the full name on hover

    // the number shown IS the minimum the search will use
    const effMin = window.ItemQuery && window.ItemQuery.effectiveMin
      ? window.ItemQuery.effectiveMin(mod, opts && opts.defaultLowerPct)
      : (mod.searchMin != null ? mod.searchMin : mod.value);

    // (the full cross-tier range no longer jams into the mod line as "· rolls X-Y";
    // it lives on the slider track's end-labels below, or nested into the tier
    // bracket above when there's no track)
    // the fold toggle also moves inline ("· 2 folded lines ▾")
    if (fold && fold.n) {
      const tog = el('span', 'fold-toggle' + (fold.open ? ' open' : ''),
        `${t('item.mods.fold_toggle_label', { count: fold.n, line: fold.n === 1 ? t('item.mods.fold_line_singular') : t('item.mods.fold_lines_plural') })} ${fold.open ? '&#9652;' : '&#9662;'}`);
      tog.title = fold.open ? t('item.mods.fold_toggle_tooltip_hide') : t('item.mods.fold_toggle_tooltip_show');
      tog.onclick = () => fold.onToggle();
      textSpan.appendChild(tog);
    }
    row.appendChild(textSpan);

    // min/max: one segmented field - a min cell on a dark bg, a hairline divider,
    // an "any" max cell. Both stay real <input>s so typing behaves exactly as before.
    let inp = null;
    if (mod.value != null || mod.editableMin) {
      const seg = el('div', 'mm-field');
      inp = el('input', 'mm-min');
      inp.type = 'text';
      inp.value = effMin != null ? effMin : '';
      if (mod.editableMin && effMin == null) inp.placeholder = t('item.search.any_placeholder');
      inp.title = mod.value != null
        ? t('item.mods.min_tooltip_with_roll', { value: mod.value })
        : t('item.mods.min_tooltip_no_min');
      inp.dataset.fk = `mod:${mod.id || i}:min`;
      inp.onchange = () => h.onValueChange && h.onValueChange(i, inp.value);
      seg.appendChild(stepWrap(inp, mod.value));
      // Every searchable row takes a max too, blank by default. Blank means no
      // upper limit, so nothing is restricted unless you ask - which is the
      // rule ("only ever DEFAULT the min"), not a ban on maxes. Useful for
      // hunting a low roll to craft over, or bracketing a tier.
      if (h.onMaxChange) {
        seg.appendChild(el('span', 'mm-div'));
        const mx = el('input', 'mm-max');
        mx.type = 'text';
        mx.value = mod.searchMax != null ? mod.searchMax : '';
        mx.placeholder = t('item.search.any_placeholder');
        mx.title = t('item.mods.max_tooltip');
        mx.dataset.fk = `mod:${mod.id || i}:max`;
        mx.onchange = () => h.onMaxChange(i, mx.value);
        seg.appendChild(stepWrap(mx, mod.value));
      }
      row.appendChild(seg);
    }
    if (h.onModMenu) {
      const menu = el('span', 'mod-menu', '&#8942;'); // vertical ellipsis
      menu.title = t('item.mods.mod_menu_tooltip');
      menu.onclick = (ev) => h.onModMenu(i, ev);
      row.appendChild(menu);
    }
    // the range slider now lives as a 2px track along the row's bottom edge. It's the
    // SAME window.makeSlider (identical drag math + input sync); only its container's
    // position/size changed. Absolutely positioned, so it takes no grid cell.
    if (hasSlider) {
      row.classList.add('has-track');
      const sl = el('div', 'mod-sl');
      sl.title = t('item.mods.slider_tooltip', { sliderMin: mod.sliderMin, sliderMax: mod.sliderMax, value: mod.value });
      row.appendChild(sl);
      window.makeSlider(sl, {
        min: mod.sliderMin,
        max: mod.sliderMax,
        step: mod.sliderStep || 1,
        value: effMin != null ? effMin : mod.sliderMin,
        marker: mod.value,
        markerTitle: t('item.mods.slider_marker_tooltip', { value: mod.value }),
        onInput: (v) => { if (inp) inp.value = v; },
        onChange: (v) => h.onValueChange && h.onValueChange(i, String(v)),
      });
      // faint end-labels = the track's own scale = the full cross-tier range, so
      // "1 … 20" reads as the slider's axis (replaces the old inline "· rolls X-Y")
      sl.insertBefore(el('span', 'sl-end sl-lo', esc(String(mod.sliderMin))), sl.firstChild);
      sl.appendChild(el('span', 'sl-end sl-hi', esc(String(mod.sliderMax))));
    }
    return row;
  }

  // rune-socket pips overlaid on item art - the art itself never encodes socket
  // count, so we draw the game's round sockets ourselves (bottom-left, like the
  // trade site does)
  const pipsHtml = (n) => (n ? `<div class="ic-pips">${'<span class="ic-pip"></span>'.repeat(n)}</div>` : '');

  // wrap a numeric input with IN-BOX steppers: down-arrow hugging the left edge,
  // up-arrow the right (a native spinner's stacked pair is too cramped at this
  // size). A click steps by 1 and fires the input's own change handler; an empty
  // box seeds from the mod's roll so the first click lands somewhere sensible.
  function stepWrap(inp, seed) {
    // the cell carries the min/max styling (width, dark bg) so the in-flow
    // arrows live INSIDE the styled box rather than overlaying the input
    const cell = el('span', 'mm-cell'
      + (inp.classList.contains('mm-min') ? ' c-min' : '')
      + (inp.classList.contains('mm-max') ? ' c-max' : ''));
    const step = (d) => {
      const cur = parseFloat(inp.value);
      const base = Number.isFinite(cur) ? cur : (Number.isFinite(seed) ? seed : 0);
      inp.value = String(Math.round((base + d) * 10) / 10);
      if (inp.onchange) inp.onchange();
    };
    const dn = el('span', 'mm-step mm-dn');
    dn.title = t('item.mods.stepper_down_tooltip');
    dn.onclick = () => step(-1);
    const up = el('span', 'mm-step mm-up');
    up.title = t('item.mods.stepper_up_tooltip');
    up.onclick = () => step(1);
    cell.appendChild(dn);
    cell.appendChild(inp);
    cell.appendChild(up);
    return cell;
  }

  // --- parsed item panel ---
  function itemPanel(state, h) {
    const wrap = el('div');
    const item = state.item;
    // back link rides its own slim row so the item art can take the header's
    // top-left corner
    if (h.onBack) {
      const br = el('div', 'back-row');
      const back = el('div', 'back-link', t('item.header.back_link'));
      back.title = t('item.header.back_link_tooltip');
      back.onclick = () => h.onBack();
      br.appendChild(back);
      wrap.appendChild(br);
    }
    // header block: big item art spanning BOTH rows on the left, with the name
    // row and the search-ranges strip stacked to its right
    const head = el('div', 'item-head');
    // The name is click-to-retype: clear it, autocomplete a different item, search that.
    // Escape restores what was there. The mod filters below are deliberately left alone -
    // searching a new name with the old item's mods is the user's call, and clearing them
    // silently would be the more surprising behaviour.
    const nameEl = el('span', 'item-name rare' + (h.onRename ? ' renamable' : ''), esc(item.title || item.base));
    if (h.onRename) {
      nameEl.title = t('item.header.rename_tooltip');
      nameEl.onclick = () => h.onRename();
    }
    head.appendChild(nameEl);
    if (item.title) head.appendChild(el('span', 'item-base', esc(item.base)));
    // meta chip: rarity only - the searchable ranges (ilvl/quality/sockets) get
    // their own strip under the header, the pill was outgrown at two
    const rar = esc(item.rarity || '');
    if (rar) head.appendChild(el('span', 'item-meta', rar));
    if (h.onDesecrate) {
      // quiet corner link to the Desecrate tab - green, because desecration is
      // Rerolling means stripping the mod that is already there, so the link is
      // dead without one. Same predicate desecrate.js uses to pick that mod, so
      // the button can never offer a tab that finds nothing to reroll.
      const hasDes = (item.mods || []).some((m) => m.kind === 'desecrated' && !m.prop);
      const d = el('span', 'des-corner' + (hasDes ? '' : ' off'), t('item.header.redesecrate_label'));
      d.title = hasDes
        ? t('item.header.redesecrate_tooltip_active')
        : t('item.header.redesecrate_tooltip_inactive');
      if (hasDes) d.onclick = () => h.onDesecrate();
      head.appendChild(d);
    }
    // controls strip: the three item-level search ranges. Each minimum defaults
    // to the item's OWN value (level / quality / socket count), blank max = no
    // upper limit, and none is ever lowered by the stat-range %.
    const ranges = [];
    if (item.itemLevel != null && h.onIlvl) ranges.push([t('item.header.range_ilvl_label'), state.ilvlMin, state.ilvlMax, h.onIlvl, t('item.header.range_ilvl_tooltip')]);
    // gems: level is the price driver, so it defaults to this gem's EXACT level
    if (item.isGem && item.gemLevel != null && h.onGemLvl) {
      ranges.push([t('item.header.range_gemlevel_label'), state.gemLvlMin, state.gemLvlMax, h.onGemLvl, item.gemLevelBonus > 0
        ? t('item.header.range_gemlevel_tooltip_bonus', { bonus: item.gemLevelBonus, totalLevel: item.gemLevel + item.gemLevelBonus, gemLevel: item.gemLevel })
        : t('item.header.range_gemlevel_tooltip_default')]);
    }
    if (item.quality > 0 && h.onQual) ranges.push([t('item.header.range_quality_label'), state.qualMin, state.qualMax, h.onQual, t('item.header.range_quality_tooltip')]);
    if (item.sockets > 0 && h.onSock) ranges.push([t('item.header.range_sockets_label'), state.sockMin, state.sockMax, h.onSock, t('item.header.range_sockets_tooltip')]);
    let strip = null;
    if (ranges.length) {
      strip = el('div', 'hdr-ctrls');
      for (const [lab, lo, hi, fn, tip] of ranges) {
        const g = el('span', 'hc-grp');
        g.title = tip + ' ' + t('item.header.range_tooltip_suffix');
        g.appendChild(el('span', 'hc-lab', lab));
        const a = el('input', 'hc-in');
        a.type = 'text';
        a.placeholder = t('item.search.any_placeholder');
        a.value = lo != null ? lo : '';
        a.dataset.fk = `hc:${lab}:min`;
        a.onchange = () => fn('min', a.value);
        g.appendChild(a);
        g.appendChild(el('span', 'hc-dash', '&ndash;'));
        const b = el('input', 'hc-in');
        b.type = 'text';
        b.placeholder = t('item.search.any_placeholder');
        b.value = hi != null ? hi : '';
        b.dataset.fk = `hc:${lab}:max`;
        b.onchange = () => fn('max', b.value);
        g.appendChild(b);
        strip.appendChild(g);
      }
    }
    // compose: [ big art ] [ name row / ranges strip ]
    const hdrMain = el('div', 'hdr-main');
    hdrMain.appendChild(head);
    if (strip) hdrMain.appendChild(strip);
    const hw = el('div', 'hdr-wrap');
    if (item.icon) {
      const iw = el('div', 'hd-icon-wrap');
      iw.innerHTML = `<img class="hd-icon" src="${esc(item.icon)}" alt="">` + pipsHtml(item.sockets);
      hw.appendChild(iw);
    }
    hw.appendChild(hdrMain);
    wrap.appendChild(hw);
    // charm base facts: display-only (GGG exposes no trade filter for these -
    // the charge/duration mods below are the searchable handles)
    if (item.charm) {
      const facts = [];
      if (item.charm.lasts) facts.push(t('item.header.charm_lasts', { seconds: esc(item.charm.lasts) }));
      if (item.charm.consumes) facts.push(t('item.header.charm_consumes', { count: esc(item.charm.consumes) }));
      const fl = el('div', 'item-facts', facts.join(' <span class="if-dot">&middot;</span> '));
      fl.title = t('item.header.charm_facts_tooltip');
      wrap.appendChild(fl);
    }
    // Unidentified unique on a base that carries several: the text cannot say which one
    // it is, but the player is looking at the art. Show the candidates and let them pick.
    // Until they do, the search runs on the base, which prices the gamble rather than the
    // item - fine for a 1ex club, badly wrong for a Voices.
    if (item.unidCandidates && item.unidCandidates.length && h.onPickUnid) {
      const box = el('div', 'unid-pick');
      box.appendChild(el('div', 'unid-pick-lab', t('item.header.unid_which_one')));
      const strip = el('div', 'unid-pick-strip');
      for (const c of item.unidCandidates) {
        const b = el('button', 'unid-cand' + (item.name === c.refName ? ' on' : ''));
        if (c.icon) {
          const im = document.createElement('img');
          im.src = c.icon; im.alt = ''; im.loading = 'lazy';
          b.appendChild(im);
        }
        b.appendChild(el('span', null, esc(c.name)));
        b.title = t('item.header.unid_pick_tooltip', { name: esc(c.name) });
        b.onclick = () => h.onPickUnid(c);
        strip.appendChild(b);
      }
      box.appendChild(strip);
      if (item.name) {
        const clr = el('button', 'unid-clear', t('item.header.unid_any'));
        clr.title = t('item.header.unid_any_tooltip');
        clr.onclick = () => h.onPickUnid(null);
        box.appendChild(clr);
      }
      wrap.appendChild(box);
    }
    if (state.notice) wrap.appendChild(el('div', 'notice', esc(state.notice)));
    if (state.loginHint) {
      const n = el('div', 'notice', t('item.misc.login_hint'));
      n.querySelector('.notice-act').onclick = () => h.onLogin && h.onLogin();
      wrap.appendChild(n);
    }

    const mods = el('div', 'mods');
    const rowOpts = { ...state.opts, __showSliders: state.showSliders !== false };
    // Rows superseded by a fold (the res lines under their total-res pseudo, the
    // desecrated half of a scope split) collapse into an accordion under the row
    // that replaced them - visible on demand, out of the way by default.
    const openFolds = state.openFolds || (state.openFolds = new Set());
    const foldCount = {};
    (item.mods || []).forEach((m) => {
      if (m.foldGroup && m.foldHead === false) foldCount[m.foldGroup] = (foldCount[m.foldGroup] || 0) + 1;
    });
    const foldBox = {};
    const bracketRows = []; // classifier-hidden (or garbage) + still-off mods, collapsed at the bottom
    (item.mods || []).forEach((m, i) => {
      // sockets live in the header controls strip now - rendering the property
      // row too would double-drive the same trade filter
      if (m.id === 'prop.rune_sockets' && item.sockets > 0 && h.onSock) return;
      // fold-head rows now carry the toggle INLINE in their mod text ("· N folded
      // lines ▾"). Build its data here, where the counts + open-set live, and hand
      // it to modRow; the superseded lines still collapse into the .fold-box below.
      const n = foldCount[m.foldGroup];
      const fold = (m.foldGroup && m.foldHead && n) ? {
        n,
        open: openFolds.has(m.foldGroup),
        onToggle: () => {
          if (openFolds.has(m.foldGroup)) openFolds.delete(m.foldGroup); else openFolds.add(m.foldGroup);
          h.onRerender ? h.onRerender() : render(document.getElementById('item-root'), state, h);
        },
      } : null;
      const row = modRow(m, i, h, rowOpts, fold);
      // pseudo/scope fold members collapse under their own fold-head (unchanged) -
      // e.g. the elemental resistances under a total-Resistance pseudo. These are
      // NEVER pulled into the collapsed-modifiers bracket.
      if (m.foldGroup && m.foldHead === false) {
        let box = foldBox[m.foldGroup];
        if (!box) {
          box = foldBox[m.foldGroup] = el('div', 'fold-box' + (openFolds.has(m.foldGroup) ? ' open' : ''));
          mods.appendChild(box);
        }
        box.appendChild(row);
        return;
      }
      // "Collapsed Modifiers" bracket: mods the classifier set aside at parse
      // (m.initiallyOff) or dropped into the garbage pool, WHILE still off.
      // Membership is sticky to the parse-time call, not live state: a default-ON
      // mod you turn off stays inline; toggle a bracket mod on and it graduates
      // back up into the list (its mode is no longer 'off', so it stops matching).
      if (m.mode === 'off' && (m.initiallyOff || m.garbage)) {
        bracketRows.push(row);
        return;
      }
      mods.appendChild(row);
    });
    // one collapsible row that swallows all the set-aside mods, at the bottom of
    // the list just before "+ Add a mod"
    if (bracketRows.length) {
      const open = !!state.bracketOpen;
      // When EVERY searchable mod ended up in the bracket - which is what a unique
      // does, since its rolls default off and the name is treated as pinning the item -
      // the search is running on name alone. The quiet collapsed row reads as "some
      // detail is tucked away" rather than "none of your rolls are being filtered", so
      // people conclude their item is worth 1ex when they are looking at the cheapest
      // rolls of that unique. Say it out loud instead.
      const nothingInline = !mods.querySelector('.mod');
      if (nothingInline && !open) {
        const warn = el('div', 'mod-bracket-warn', t('item.mods.bracket_name_only'));
        warn.onclick = () => {
          state.bracketOpen = true;
          h.onRerender ? h.onRerender() : render(document.getElementById('item-root'), state, h);
        };
        mods.appendChild(warn);
      }
      const bhead = el('div', 'mod-bracket-head' + (open ? ' open' : ''),
        `<span class="mb-caret">${open ? '&#9662;' : '&#9656;'}</span><span class="mb-lab">${tn('item.mods.bracket_count_label', bracketRows.length, { count: bracketRows.length })}</span><span class="mb-hint">${t('item.mods.bracket_hint', { action: open ? t('item.mods.bracket_action_collapse') : t('item.mods.bracket_action_expand') })}</span>`);
      bhead.title = t('item.mods.bracket_tooltip');
      bhead.onclick = () => {
        state.bracketOpen = !state.bracketOpen;
        h.onRerender ? h.onRerender() : render(document.getElementById('item-root'), state, h);
      };
      mods.appendChild(bhead);
      const bbox = el('div', 'mod-bracket' + (open ? ' open' : ''));
      for (const r of bracketRows) bbox.appendChild(r);
      mods.appendChild(bbox);
    }
    wrap.appendChild(mods);
    // "+ Add a mod" (dashed, flex 1) shares one row with the Miscellaneous accordion
    // (flex 2). align-items:flex-start keeps the add box its natural height when the
    // accordion is expanded.
    const actions = el('div', 'pc-actions');
    if (h.onAddMod) {
      const add = el('div', 'add-mod', t('item.mods.add_mod_label'));
      add.title = t('item.mods.add_mod_tooltip');
      add.onclick = () => h.onAddMod();
      actions.appendChild(add);
    }
    // ---- Miscellaneous: the game's own toggles, same name, same Any/Yes/No ----
    // Why this matters for pricing: fracturable stats are perfect rolls, so a
    // Sapphire with a 20% Critical Spell Damage fracture is worth divines while
    // the FAILED attempts - corrupted, crafted, unfractured - flood the market
    // at a couple of exalts. Leaving them in the comp set makes a good item look
    // cheap, which is exactly how these get underpriced.
    if (h.onMisc) {
      const misc = state.opts.misc || {};
      const setCount = Object.values(misc).filter((v) => v === 'true' || v === 'false').length;
      const status = state.opts.status || 'securable';
      const statusLabel = (SALE_TYPES.find((s) => s[0] === status) || [, status])[1];
      const acc = el('div', 'misc-acc' + (state.miscOpen ? ' open' : ''));
      // the sale type is summarised in the HEAD, not just inside the fold: it
      // defaults to a value that NARROWS the pool, and a filter you cannot see
      // is a filter you will not think to check when results look thin
      const head = el('div', 'misc-head',
        `<span>${state.miscOpen ? '&#9662;' : '&#9656;'} ${t('item.misc.section_label')}</span>`
        + `<span class="misc-sum">${esc(statusLabel)}</span>`
        + (setCount ? `<span class="misc-count">${t('item.misc.set_count_badge', { count: setCount })}</span>` : ''));
      head.title = t('item.misc.section_tooltip');
      head.onclick = () => { state.miscOpen = !state.miscOpen; h.onRerender && h.onRerender(); };
      acc.appendChild(head);
      if (state.miscOpen) {
        if (h.onOpt) {
          const sale = el('div', 'sale-row');
          sale.appendChild(el('span', null, t('item.misc.listings_label')));
          const sel = el('select');
          // NB: the loop label must not be named `t` - that shadows the i18n
          // helper for the whole loop scope (see the misc-filter loop below)
          for (const [v, lbl] of SALE_TYPES) {
            const o = el('option', null, lbl);
            o.value = v;
            sel.appendChild(o);
          }
          sel.value = status;
          if (status !== 'securable') sel.classList.add('set');
          sel.title = t('item.search.sale_type_tooltip');
          sel.onchange = () => h.onOpt('status', sel.value);
          sale.appendChild(sel);
          acc.appendChild(sale);

          // how far back to accept listings - sits with sale type because both narrow
          // WHICH listings count rather than what the item is
          const listed = el('div', 'sale-row');
          listed.appendChild(el('span', null, t('item.search.listed_label')));
          const lsel = el('select');
          for (const [v, lbl] of LISTED_WINDOWS) {
            const o = el('option', null, lbl);
            o.value = v;
            lsel.appendChild(o);
          }
          lsel.value = state.opts.indexed || '';
          if (lsel.value) lsel.classList.add('set');
          lsel.title = t('item.search.listed_tooltip');
          lsel.onchange = () => h.onOpt('indexed', lsel.value || null);
          listed.appendChild(lsel);
          acc.appendChild(listed);
        }
        const grid = el('div', 'misc-grid');
        for (const [key, label] of MISC_FILTERS) {
          const row = el('label', 'misc-row');
          row.appendChild(el('span', null, esc(label)));
          const sel = el('select');
          for (const [v, lbl] of [['', t('item.search.any_option')], ['true', t('item.misc.filter_yes')], ['false', t('item.misc.filter_no')]]) {
            const o = el('option', null, lbl);
            o.value = v;
            sel.appendChild(o);
          }
          sel.value = misc[key] || '';
          if (sel.value) sel.classList.add('set');
          sel.onchange = () => h.onMisc(key, sel.value);
          row.appendChild(sel);
          grid.appendChild(row);
        }
        acc.appendChild(grid);
        // live search assumptions for THIS item: q20 quality and filled rune
        // sockets change the property minimums, so they belong here on the trade
        // page (recompute + re-search on toggle), not buried in Settings
        if (h.onAssume && state.item && (state.item.q20able || state.item.runeFillable)) {
          const arow = el('div', 'assume-row');
          arow.appendChild(el('span', 'assume-lab', t('item.misc.assume_label')));
          // Exceptional Normal bases use the per-item override (q20 ON, runes OFF),
          // leaving the global assume pref untouched - so the chips read from it too.
          const asm = (state.item && state.item.exceptionalBase)
            ? (state.excAssume || { q20: true, fillRunes: false })
            : (state.assume || {});
          const mk = (key, label, on, title) => {
            const lab = el('label', 'assume-chip' + (on ? ' on' : ''));
            lab.title = title;
            const cb = el('input'); cb.type = 'checkbox'; cb.checked = on;
            cb.onchange = () => h.onAssume(key, cb.checked);
            lab.appendChild(cb); lab.appendChild(el('span', null, esc(label)));
            return lab;
          };
          if (state.item.q20able) arow.appendChild(mk('q20', t('item.misc.assume_q20_label'), !!asm.q20,
            t('item.misc.assume_q20_tooltip')));
          if (state.item.runeFillable) arow.appendChild(mk('fillRunes', t('item.misc.assume_fillrunes_label'), !!asm.fillRunes,
            t('item.misc.assume_fillrunes_tooltip')));
          acc.appendChild(arow);
        }
      }
      actions.appendChild(acc);
    }
    if (actions.childNodes.length) wrap.appendChild(actions);

    const row = el('div', 'search-row');
    const btn = el('button', 'btn-search' + (state.stale ? ' attn' : ''), t('item.search.search_button'));
    btn.onclick = () => h.onSearch && h.onSearch();
    row.appendChild(btn);

    const opts = el('div', 'search-opts');
    // Each cluster travels as ONE unit so a narrow panel wraps whole controls
    // instead of orphaning a stray "%" on its own line.
    // These SET the minimums (you see every input change), they don't toggle a
    // hidden mode - so they're buttons, not a checkbox.
    if (h.onSetMins) {
      // one segmented control: a "set mins" label cell + tier min | exact roll | ↻
      const grp = el('span', 'opt-grp seg');
      opts.appendChild(grp);
      grp.appendChild(el('span', 'seg-lab', t('item.search.set_mins_label')));
      const mk = (cls, label, title, act) => {
        const b = el('button', 'seg-btn' + cls, label);
        b.title = title;
        b.onclick = () => h.onSetMins(act);
        grp.appendChild(b);
      };
      mk('', t('item.search.set_mins_tier_label'), t('item.search.set_mins_tier_tooltip'), 'min');
      mk('', t('item.search.set_mins_exact_label'), t('item.search.set_mins_exact_tooltip'), 'current');
      mk(' seg-reset', '&#8635;', t('item.search.set_mins_reset_tooltip'), 'reset');
    }
    const rgrp = el('span', 'opt-grp');
    rgrp.appendChild(el('span', 'sr-lab', t('item.search.stat_range_label')));
    // SIGNED display: -15 = mins 15% BELOW your roll (the default), positive =
    // mins above it (strictly-better comps). Stored internally as the positive
    // "reduction" it always was - only the box shows the sign flipped.
    const low = el('input'); low.type = 'text'; low.value = -(state.opts.defaultLowerPct || 0);
    low.title = t('item.search.stat_range_tooltip');
    low.dataset.fk = 'opt:lowerpct';
    low.onchange = () => h.onOpt && h.onOpt('defaultLowerPct', Math.max(-100, Math.min(100, -(Number(low.value) || 0))));
    rgrp.appendChild(stepWrap(low, -15));
    rgrp.appendChild(el('span', 'sr-lab', '%'));
    opts.appendChild(rgrp);
    if ((item.mods || []).some((m) => m.garbage)) {
      const g = el('span', 'gtoggle' + (state.opts.garbageOnly ? ' on' : ''), t('item.search.garbage_only_label'));
      g.title = t('item.search.garbage_only_tooltip');
      g.onclick = () => h.onOpt && h.onOpt('garbageOnly', !state.opts.garbageOnly);
      opts.appendChild(g);
    }
    row.appendChild(opts);
    wrap.appendChild(row);

    // A throttled search must never just sit on "Searching..." - say who is
    // waiting, why, and for exactly how long.
    if (state.searching && state.waitUntil) {
      const left = Math.max(0, Math.ceil((state.waitUntil - Date.now()) / 1000));
      const w = el('div', 'wait-note' + (state.waitBanned ? ' banned' : ''),
        state.waitBanned
          ? t('item.search.wait_banned_message', { seconds: left })
          : t('item.search.wait_queued_message', { seconds: left }));
      w.title = t('item.search.wait_tooltip');
      wrap.appendChild(w);
    }
    if (state.results) {
      if (state.stale && !state.searching) {
        wrap.appendChild(el('div', 'stale-note', t('item.search.stale_note')));
      }
      const ctx = state.searchCtx;
      const paging = ctx ? { more: ctx.loaded < ctx.ids.length, remaining: ctx.ids.length - ctx.loaded } : null;
      wrap.appendChild(resultsPanel(state.results, h, state.searching, state.stale, paging));
    } else if (state.searching && !state.waitUntil) wrap.appendChild(el('div', 'res-group-title', t('item.search.searching_label')));
    return wrap;
  }

  // --- results ---
  // headline chips: weapon output + the rarer defence-adjacent numbers. The
  // big four defences (ES/Armour/Evasion/Ward) and quality compare with deltas
  // in the "Vs your item" section instead of floating here.
  const CHIP_EXT = [['dps', t('item.listings.chip_dps')], ['pdps', t('item.listings.chip_pdps')], ['edps', t('item.listings.chip_edps')], ['block', t('item.listings.chip_block')], ['spirit', t('item.listings.chip_spirit')]];

  // full item card, rendered in the floating peek window beside the overlay
  function peekCardHtml(l) {
    const age = l.indexed && Date.parse(l.indexed) ? ageStr(Date.parse(l.indexed)) : null;
    let s = '<div class="pk-head">';
    if (l.icon) s += `<div class="pk-icon-wrap"><img class="pk-icon" src="${esc(l.icon)}" alt="">${pipsHtml(l.sockets)}</div>`;
    s += `<div><div class="pk-name">${esc(l.name || l.base || '?')}</div>`;
    if (l.name && l.base) s += `<div class="pk-base">${esc(l.base)}</div>`;
    // status tags (corrupted / fractured / ...) ride the header, under the name
    if (l.flags && l.flags.length) {
      s += `<div class="pk-flags">${l.flags.map((f) => `<span class="pk-flag pk-flag-${esc(f.toLowerCase().split(' ')[0])}">${esc(f)}</span>`).join('')}</div>`;
    }
    s += '</div>';
    s += `<div class="pk-price">${priceHtml(l.price)}${age ? `<div class="pk-age">${window.t('item.listings.listed_age', { age: esc(age) })}</div>` : ''}</div>`;
    s += '</div>';
    const chips = CHIP_EXT.filter(([k]) => l.ext && l.ext[k]).map(([k, lab]) => `<span class="pk-stat"><b>${l.ext[k]}</b> ${lab}</span>`);
    // charm base facts, in the game tooltip's own order: Lasts, Consumes
    if (l.charm) {
      if (l.charm.consumes) chips.unshift(`<span class="pk-stat">${window.t('item.listings.charm_charges_per_use', { count: esc(l.charm.consumes) })}</span>`);
      if (l.charm.lasts) chips.unshift(`<span class="pk-stat">${window.t('item.listings.charm_lasts', { seconds: esc(l.charm.lasts) })}</span>`);
    }
    if (chips.length) s += `<div class="pk-stats">${chips.join('')}</div>`;
    // At-a-glance comparability: one total per dimension your search uses, each
    // with a +/- vs your item (green = yours ahead, red = this comp beats you) -
    // so you don't total each comp's resistances or added damage by hand.
    const tot = l.totals || {}; // NOT `t`: that shadows the translator for this whole function
    const cmpRow = (lab, c, title) => {
      if (!c || c.val == null) return '';
      const d = c.delta;
      const dl = d == null ? '<span class="pk-delta"></span>'
        : `<span class="pk-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</span>`;
      return `<div class="pk-cmp" title="${esc(title)}"><span class="pk-cmp-lab">${lab}</span>`
        + `<b>${c.val}</b>${dl}</div>`;
    };
    // every value here reads from `tot`, never `t` - `t` is the translator, so `t.es`
    // and friends are undefined and cmpRow drops the row silently. That is exactly how
    // Quality/ES/Armour/Evasion/Ward disappeared from this panel in 2.6.0: the i18n
    // rename took the three `tot.*` rows below and missed these five.
    const cmp = cmpRow(`${t('item.listings.cmp_quality_label')}${tot.qualKind ? ` (${esc(tot.qualKind)})` : ''}`, tot.qual, t('item.listings.cmp_quality_tooltip'))
      + cmpRow(t('item.listings.cmp_es_label'), tot.es, t('item.listings.cmp_es_tooltip'))
      + cmpRow(t('item.listings.cmp_armour_label'), tot.ar, t('item.listings.cmp_armour_tooltip'))
      + cmpRow(t('item.listings.cmp_evasion_label'), tot.ev, t('item.listings.cmp_evasion_tooltip'))
      + cmpRow(t('item.listings.cmp_ward_label'), tot.ward, t('item.listings.cmp_ward_tooltip'))
      + cmpRow(t('item.listings.cmp_res_label'), tot.res, t('item.listings.cmp_res_tooltip'))
      + cmpRow(t('item.listings.cmp_dmg_label'), tot.dmg, t('item.listings.cmp_dmg_tooltip'))
      + cmpRow(t('item.listings.cmp_sockets_label'), tot.sockets, t('item.listings.cmp_sockets_tooltip'));
    if (cmp) s += `<div class="pk-seclab">${t('item.listings.vs_your_item_label')}</div><div class="pk-compare">${cmp}</div>`;
    // the game's tooltip layout: runes/enchants, implicits, explicits - separated
    const KIND_TAG = { des: t('item.mods.kind_desecrated'), fractured: t('item.mods.kind_fractured'), crafted: t('item.mods.kind_crafted') };
    const line = (m) => {
      const modText = typeof m === 'string' ? m : m.text;
      const match = typeof m === 'object' && m.match;
      // desecrated / fractured / crafted each get the game's own look, plus a
      // small tag so there's no guessing which is which
      const kind = (typeof m === 'object' && (m.kind || (m.des ? 'des' : null))) || null;
      const tag = kind ? ` <span class="pk-tag pk-tag-${kind}">${KIND_TAG[kind]}</span>` : '';
      // over/under vs your own roll on the same stat: red = this comp beats you
      // on that line, green = you're ahead. Silent when they're equal.
      const d = typeof m === 'object' ? m.delta : null;
      const dl = d == null ? '<span class="pk-delta"></span>'
        : `<span class="pk-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</span>`;
      return `<div class="pk-mod${match ? ' match' : ''}${kind ? ' ' + kind : ''}"><span class="pk-mtext">${hlNums(modText)}${tag}</span>${dl}</div>`;
    };
    const sections = l.secs && l.secs.length ? l.secs : (l.mods && l.mods.length ? [{ key: 'explicit', lines: l.mods }] : []);
    const SEC_LABEL = { rune: t('item.listings.section_runes_implicits'), 'added-rune': t('item.listings.section_runes'), enchant: t('item.listings.section_enchants'), implicit: t('item.listings.section_implicits'), pseudo: t('item.listings.section_pseudo'), explicit: t('item.listings.section_explicits') };
    for (const sec of sections) {
      const lab = SEC_LABEL[sec.key] || sec.key;
      const hint = sec.key === 'explicit' ? ` <span class="pk-key">${t('item.listings.explicit_hint')}</span>` : '';
      s += `<div class="pk-seclab">${esc(lab)}${hint}</div>`;
      s += `<div class="pk-mods pk-sec-${esc(sec.key)}">${sec.lines.map(line).join('')}</div>`;
    }
    if (l.missing && l.missing.length) s += `<div class="pk-miss">${t('item.listings.lacks_prefix', { mods: esc(l.missing.join(', ')) })}</div>`;
    return s;
  }

  // two-line listing: price column | name + text flags over base | age | whisper button.
  // Full detail still lives in the hover peek.
  // Shared hover-intent timers for the peek (module scope, so EVERY row's handlers
  // reuse the same two): leaving a row schedules the hide behind a short grace
  // period that entering the next row cancels - so gliding down the list updates
  // the card in place instead of blinking it off in the gap between each row.
  let peekShowTimer = null, peekHideTimer = null;
  // click-pinned listing: while set, hover neither re-points nor hides the card
  let peekPinned = null;
  function listingRow(l, h, idx) {
    const row = el('div', 'listing' + (l.whisper ? ' has-whisper' : ''));
    row.dataset.li = idx;
    // item art column (the trade API ships the icon URL) with socket pips
    const iw = el('div', 'li-icon-wrap');
    if (l.icon) iw.innerHTML = `<img class="li-icon" src="${esc(l.icon)}" alt="">` + pipsHtml(l.sockets);
    row.appendChild(iw);
    // scannable fixed-width price column (unit dimmed inside priceHtml's .cur)
    row.appendChild(el('span', 'price', priceHtml(l.price)));
    // center block: name line (name + quiet text-only flags) over a dim base line
    const center = el('div', 'li-center');
    const nameLine = el('div', 'li-nameline');
    nameLine.appendChild(el('span', 'li-name', esc(l.name || l.base || '?')));
    // at-a-glance status beside the name (corrupted / fractured / desecrated / ...)
    if (l.flags && l.flags.length) {
      for (const f of l.flags) {
        const key = f.toLowerCase().split(' ')[0];
        const chip = el('span', 'li-flag li-flag-' + key, esc(LI_FLAG_ABBR[f] || f));
        chip.title = f;
        nameLine.appendChild(chip);
      }
    }
    center.appendChild(nameLine);
    // dim facts line: base type, then the comp's quality ("q23" - player
    // shorthand) and charm lasts/charges, so results read without hovering
    const bits = [];
    if (l.name && l.base) bits.push(esc(l.base));
    if (l.quality) bits.push(t('item.listings.quality_prefix') + esc(String(l.quality.val).replace(/[+%]/g, '')) + (l.quality.kind ? ' ' + esc(l.quality.kind.replace(/ Modifiers$/, '')) : ''));
    if (l.charm && l.charm.lasts) bits.push(t('item.listings.charm_lasts_suffix', { seconds: esc(l.charm.lasts) }));
    if (l.charm && l.charm.consumes) bits.push(t('item.listings.charm_charges_suffix', { count: esc(l.charm.consumes) }));
    center.appendChild(el('div', 'li-base', bits.join(' &middot; ')));
    row.appendChild(center);
    const ts = l.indexed ? Date.parse(l.indexed) : null;
    row.appendChild(el('span', 'li-age', ts ? ageStr(ts) : ''));

    // hover-peek with hover-intent (shared timers above): entering a row cancels
    // any pending hide from the row we just left, so the card never blinks out in
    // the gap between adjacent rows - it just re-points at the new listing.
    row.addEventListener('mouseenter', () => {
      if (peekPinned) return; // a pinned card holds still
      clearTimeout(peekHideTimer);
      clearTimeout(peekShowTimer);
      peekShowTimer = setTimeout(() => {
        const r = row.getBoundingClientRect();
        window.api.itemPeekShow({ html: peekCardHtml(l), frac: r.top / window.innerHeight });
      }, 110);
    });
    row.addEventListener('mouseleave', () => {
      if (peekPinned) return;
      clearTimeout(peekShowTimer);
      clearTimeout(peekHideTimer);
      peekHideTimer = setTimeout(() => { window.api.itemPeekHide(); }, 150);
    });
    // click PINS the detail card to this row (click again to release; clicking
    // another row moves the pin). The ✉ button owns the whisper copy.
    row.title = t('item.listings.row_pin_tooltip');
    row.addEventListener('click', () => {
      if (peekPinned === l) {
        peekPinned = null;
        row.classList.remove('li-pinned');
        window.api.itemPeekHide();
        return;
      }
      peekPinned = l;
      document.querySelectorAll('.listing.li-pinned').forEach((n) => n.classList.remove('li-pinned'));
      row.classList.add('li-pinned');
      clearTimeout(peekShowTimer);
      clearTimeout(peekHideTimer);
      const r = row.getBoundingClientRect();
      window.api.itemPeekShow({ html: peekCardHtml(l), frac: r.top / window.innerHeight });
    });
    if (l.whisper && h.onWhisper) {
      const wb = el('span', 'li-whisper', t('item.listings.whisper_button'));
      wb.title = t('item.listings.whisper_tooltip');
      wb.onclick = (ev) => { ev.stopPropagation(); h.onWhisper(l); };
      row.appendChild(wb);
    }
    return row;
  }

  // combined results header: SUGGESTED FLOOR (left) · listing-count histogram
  // (middle) · listing count (right). Replaces the old suggested box + dot strip
  // + group titles.
  function resultsHead(res, allListings, reveal) {
    const card = el('div', 'results-head');
    const sug = res.suggested && typeof res.suggested === 'object' ? res.suggested : null;
    // .suggested is preserved here (tutorial hook + hard constraint)
    const floorEl = el('div', 'suggested rh-floor');
    floorEl.appendChild(el('div', 'rh-floor-lab', t('item.floor.label')));
    const val = el('div', 'rh-floor-val');
    if (sug) val.innerHTML = `${esc(String(sug.amount))} ${curUnitHtml(sug.currency, 'rh-floor-unit')}${floorAside(sug)}`;
    else val.innerHTML = res.suggested ? esc(res.suggested) : t('item.floor.no_suggestion');
    floorEl.appendChild(val);
    // sub-label + hover receipt: HOW this number was reached, comp by comp
    const why = sug && sug.why;
    const pctS = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
    let sub = t('item.floor.sub_median_fallback');
    let tip = t('item.floor.why_median_fallback');
    if (why && why.mode === 'weapon-dps') {
      const r = why.theirDPS ? why.myDPS / why.theirDPS : 1;
      sub = r < 0.98 ? t('item.floor.sub_dps_scaled_down') : r > 1.02 ? t('item.floor.sub_dps_scaled_up') : t('item.floor.sub_dps_matched');
      tip = t('item.floor.why_dps', { currency: esc(why.cur || ''), anchorAmount: why.anchorAmt, theirDps: why.theirDPS, myDps: why.myDPS, pct: pctS(r - 1), floorAmount: esc(String(sug.amount)), floorCurrency: esc(sug.currency || '') });
    } else if (why && why.mode === 'between') {
      sub = t('item.floor.sub_between');
      tip = t('item.floor.why_between', { belowAmount: why.below.amount, currency: sug.currency, belowGap: pctS(why.below.gap), aboveAmount: why.above.amount, aboveGap: pctS(why.above.gap) });
    } else if (why && why.mode === 'below-best') {
      sub = t('item.floor.sub_below_best');
      tip = t('item.floor.why_below_best', { amount: why.above.amount, currency: sug.currency, gap: pctS(why.above.gap) });
    } else if (why && why.mode === 'above-worst') {
      sub = t('item.floor.sub_above_worst');
      tip = t('item.floor.why_above_worst', { amount: why.below.amount, currency: sug.currency, gap: pctS(why.below.gap) });
    }
    floorEl.title = tip;
    floorEl.appendChild(el('div', 'rh-floor-sub', sub));
    card.appendChild(floorEl);
    const hist = histogram(allListings, res, reveal);
    if (hist) card.appendChild(hist);
    else card.appendChild(el('div', 'rh-hist'));
    const cnt = el('div', 'rh-count');
    const n = allListings.length;
    cnt.appendChild(el('div', 'rh-count-n', String(n)));
    cnt.appendChild(el('div', 'rh-count-lab', n === 1 ? t('item.listings.count_singular') : t('item.listings.count_plural')));
    if (res.total != null && res.total !== n) cnt.title = t('item.listings.count_tooltip', { shown: n, total: res.total });
    card.appendChild(cnt);
    return card;
  }

  // listing-count histogram on a LOG-SCALE price axis. Bars = listings per band,
  // dashed green line + FLOOR chip = suggested floor, priced tick labels beneath.
  // SVG geometry uses presentation attributes only (CSP forbids inline styles);
  // tick/chip positions use CSSOM (el.style.left), which CSP allows.
  function histogram(listings, res, reveal) {
    const priced = (listings || []).map((l, idx) => ({ l, idx }))
      .filter((x) => x.l.price && x.l.price.amount != null);
    if (priced.length < 3) return null;
    const cur = priced[0].l.price.currency;
    const inCur = priced.filter((x) => x.l.price.currency === cur);
    if (inCur.length < 3) return null;
    const amounts = inCur.map((x) => x.l.price.amount);
    let lo = Math.min(...amounts), hi = Math.max(...amounts);
    if (!(hi > lo)) return null;
    const sug = res.suggested && typeof res.suggested === 'object' ? res.suggested : null;
    const floor = (sug && sug.currency === cur && sug.amount > 0) ? sug.amount : null;
    let axisLo = lo, axisHi = hi;
    if (floor != null) { axisLo = Math.min(axisLo, floor); axisHi = Math.max(axisHi, floor); }
    if (!(axisHi > axisLo)) return null;
    const span = Math.log10(axisHi) - Math.log10(axisLo);
    const pos = (v) => (Math.log10(v) - Math.log10(axisLo)) / span; // 0..1
    const N = Math.max(4, Math.min(7, Math.round(Math.sqrt(inCur.length)) + 2));
    const counts = new Array(N).fill(0);
    const firstIdx = new Array(N).fill(Infinity);
    for (const x of inCur) {
      let b = Math.floor(pos(x.l.price.amount) * N);
      if (b >= N) b = N - 1; if (b < 0) b = 0;
      counts[b]++;
      if (x.idx < firstIdx[b]) firstIdx[b] = x.idx;
    }
    const maxC = Math.max(...counts, 1);
    const box = el('div', 'rh-hist');
    const VB = 300, base = 31, top = 2, maxBar = 26, gap = 4;
    const pitch = VB / N, barW = pitch - gap;
    let svg = '<svg class="rh-hist-svg" width="100%" height="34" viewBox="0 0 300 34" preserveAspectRatio="none">';
    svg += `<line x1="0" y1="${base}" x2="300" y2="${base}" stroke="rgba(232,210,180,.12)" stroke-width="1"></line>`;
    for (let i = 0; i < N; i++) {
      if (!counts[i]) continue;
      const hgt = Math.max(4, (counts[i] / maxC) * maxBar);
      const x = (i * pitch + gap / 2).toFixed(1);
      const y = (base - hgt).toFixed(1);
      const mode = counts[i] === maxC;
      svg += `<rect class="rh-bar" data-band="${i}" x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${hgt.toFixed(1)}" rx="1.5" fill="${mode ? 'rgba(232,160,76,.75)' : 'rgba(232,160,76,.55)'}"></rect>`;
    }
    let floorPos = null;
    if (floor != null) {
      floorPos = Math.max(0, Math.min(1, pos(floor)));
      const fx = (floorPos * VB).toFixed(1);
      svg += `<line x1="${fx}" y1="${top}" x2="${fx}" y2="${base}" stroke="#8ec97a" stroke-width="1.6" stroke-dasharray="3 2"></line>`;
    }
    svg += '</svg>';
    const plot = el('div', 'rh-hist-plot');
    plot.innerHTML = svg;
    if (floorPos != null) {
      const chip = el('span', 'rh-floor-chip', t('item.floor.chip_label'));
      chip.style.left = (floorPos * 100) + '%';
      plot.appendChild(chip);
    }
    box.appendChild(plot);
    // priced tick labels (log-spaced); the floor tick is green. Endpoints anchor to
    // the edges (align lo/hi) so they never clip; interior ticks are centered.
    const ticks = el('div', 'rh-ticks');
    const fmt = (v) => String(v >= 100 ? Math.round(v / 10) * 10 : Math.round(v));
    const addTick = (p, text, cls, align) => {
      const t = el('span', 'rh-tick' + (cls ? ' ' + cls : ''), text);
      if (align === 'lo') t.style.left = '0';
      else if (align === 'hi') t.style.right = '0';
      else t.style.left = (p * 100) + '%';
      ticks.appendChild(t);
    };
    for (let k = 0; k <= 4; k++) {
      const p = k / 4;
      if (floorPos != null && Math.abs(p - floorPos) < 0.11) continue; // avoid colliding with the floor tick
      const v = axisLo * Math.pow(axisHi / axisLo, p);
      if (k === 0) addTick(p, `${fmt(v)} ${curUnitHtml(cur)}`, 'rh-tick-end', 'lo');
      else if (k === 4) addTick(p, `${fmt(v)} ${curUnitHtml(cur)}`, 'rh-tick-end', 'hi');
      else addTick(p, fmt(v), '', 'mid');
    }
    if (floorPos != null) {
      const align = floorPos < 0.06 ? 'lo' : floorPos > 0.94 ? 'hi' : 'mid';
      addTick(floorPos, fmt(floor), 'rh-tick-floor', align);
    }
    box.appendChild(ticks);
    // clicking a band reveals any truncated rows, then scrolls to its first listing
    plot.querySelectorAll('.rh-bar').forEach((rect) => {
      rect.addEventListener('click', () => {
        const b = Number(rect.getAttribute('data-band'));
        const idx = firstIdx[b];
        if (!isFinite(idx)) return;
        if (reveal && reveal.fn) reveal.fn();
        const row = document.querySelector(`[data-li="${idx}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.remove('flash');
        void row.offsetWidth; // restart the animation
        row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1400);
      });
    });
    return box;
  }

  function resultsPanel(res, h, updating, stale, paging) {
    const wrap = el('div', 'results' + (updating ? ' updating' : '') + (stale && !updating ? ' stale' : ''));
    // highly → similar → plain, concatenated into one flat, cheapest-first list
    const allListings = [].concat(res.highly || [], res.similar || [], res.plain || []);
    // shared hook so a histogram band-click can un-truncate the list before scrolling
    const reveal = { fn: null };
    if (res.suggested || allListings.length) wrap.appendChild(resultsHead(res, allListings, reveal));
    // Live paged searches show every row already fetched (each page is a deliberate
    // fetch); "Load more results" pages the rest. Only cached/sample lists (no paging)
    // keep the client-side "show N more" truncation.
    const CUTOFF = paging ? Infinity : 8;
    const rows = [];
    let liIdx = 0;
    peekPinned = null; // fresh results release any pinned card
    const anchorL = res.suggested && res.suggested.why && res.suggested.why.anchorL;
    // Re-surface the profiler's buckets as quiet dividers - Highly similar
    // first, then Similar (the grouping always ran; the redesign had only
    // dropped the visible headers). No labels when the item had no profile to
    // match on (res.plain). `shown` counts listing rows only, so the CUTOFF
    // truncation and a header's own hidden state stay in step.
    const groups = (res.highly || res.similar)
      ? [[t('item.listings.group_highly_similar'), res.highly || []], [t('item.listings.group_similar'), res.similar || []]].filter(([, g]) => g.length)
      : [[null, res.plain || allListings]];
    let shown = 0;
    for (const [label, items] of groups) {
      if (label) {
        const hdr = el('div', 'res-group' + (shown >= CUTOFF ? ' li-hidden' : '') + (shown === 0 ? ' rg-first' : ''));
        hdr.innerHTML = `<span class="rg-lab">${esc(label)}</span><span class="rg-n">${items.length}</span>`;
        wrap.appendChild(hdr);
        rows.push(hdr);
      }
      for (const l of items) {
        const r = listingRow(l, h, liIdx++);
        // the listing the suggested floor anchored on gets a quiet outline
        if (anchorL && l === anchorL) { r.classList.add('li-anchor'); r.title = 'The suggested floor is anchored on this listing. Click to pin its card.'; }
        if (shown >= CUTOFF) r.classList.add('li-hidden');
        wrap.appendChild(r);
        rows.push(r);
        shown++;
      }
    }
    if (allListings.length > CUTOFF) {
      const hiddenN = allListings.length - CUTOFF;
      const more = el('div', 'show-more', t('item.listings.show_more', { count: hiddenN }));
      const revealAll = () => { rows.forEach((r) => r.classList.remove('li-hidden')); more.remove(); };
      more.onclick = revealAll;
      reveal.fn = revealAll;
      wrap.appendChild(more);
    }
    // live paged search: fetch the next page on demand (button only while ids remain)
    if (paging && paging.more && h.onLoadMore) {
      const btn = el('button', 'load-more', t('item.listings.load_more_results', { remaining: paging.remaining }));
      btn.disabled = !!updating;
      btn.onclick = () => h.onLoadMore();
      wrap.appendChild(btn);
    }
    if (!allListings.length) wrap.appendChild(el('div', 'no-results', t('item.listings.no_results')));
    return wrap;
  }

  // --- history landing ---
  function historyPanel(state, h) {
    const wrap = el('div');
    if (state.authed === false && h.onLogin) {
      const b = el('div', 'login-banner',
        `<span>${t('item.history.logged_out_message')}</span>`);
      const btn = el('button', 'mini-btn', t('item.history.login_button'));
      btn.onclick = () => h.onLogin();
      b.appendChild(btn);
      wrap.appendChild(b);
    }
    // the prompt shows the user's ACTUAL bind (config-driven, default Ctrl+F)
    const hk = (state.itemHotkey || 'Ctrl+F').replace(/Control|CommandOrControl/g, 'Ctrl')
      .split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('+');
    wrap.appendChild(el('div', 'paste-prompt', `${t('item.history.paste_prompt_main', { hotkey: hk })}<br><span class="pp-alt">${t('item.history.paste_prompt_alt')}</span>`));
    // Search by NAME, for the things Ctrl+C cannot reach: runestones and Verisium
    // gems inside the rune-combination dialogue, and Ritual remnant reward choices.
    // Three separate people asked for this, each about a different dialogue.
    // Both empty-state actions sit in ONE centered row. Individually they are
    // `margin: auto`-centred blocks, so two of them stacked (and one with a margin
    // override) drifted apart and left the name search hanging off to one side.
    if (h.onNameSearch || h.onLoadSample) {
      const acts = el('div', 'empty-actions');
      if (h.onNameSearch) {
        const byName = el('button', 'sample-btn name-search-btn', t('item.history.search_by_name_button'));
        byName.title = t('item.history.search_by_name_tooltip');
        byName.onclick = () => h.onNameSearch();
        acts.appendChild(byName);
      }
      if (h.onLoadSample) {
        const sample = el('button', 'sample-btn sample-btn-quiet', t('item.history.see_example_button'));
        sample.onclick = () => h.onLoadSample();
        acts.appendChild(sample);
      }
      wrap.appendChild(acts);
    }
    const hist = state.history || [];
    if (hist.length) {
      wrap.appendChild(el('div', 'history-title', t('item.history.recent_searches_title')));
      const shown = Math.min(hist.length, state.histShown || 10);
      hist.slice(0, shown).forEach((rec, i) => {
        const it = el('div', 'hist-item');
        it.onclick = () => h.onHistoryOpen && h.onHistoryOpen(i);
        const iconSrc = rec.icon || (rec.model && rec.model.icon);
        if (iconSrc) {
          const img = el('img', 'hist-icon');
          img.src = iconSrc;
          img.onerror = () => img.remove();
          it.appendChild(img);
        }
        const body = el('div', 'hist-body');
        body.appendChild(el('div', 'hist-base', esc(rec.base)));
        body.appendChild(el('div', 'hist-summary', esc(rec.summary || '')));
        it.appendChild(body);
        const right = el('div', 'hist-right');
        // gear rows carry a cached suggested floor; currency rows put the rate in
        // the summary already, so skip the floor line for them
        const f = rec.floor;
        if (!rec.currency && f && typeof f === 'object' && f.amount != null) {
          right.appendChild(el('div', 'hist-floor', priceHtml(f)));
        }
        right.appendChild(el('div', 'hist-age', ageStr(rec.ts)));
        it.appendChild(right);
        wrap.appendChild(it);
      });
      if (hist.length > shown && h.onHistoryMore) {
        const more = el('button', 'load-more', t('item.history.load_more', { remaining: hist.length - shown }));
        more.onclick = () => h.onHistoryMore();
        wrap.appendChild(more);
      }
    }
    return wrap;
  }

  // Rebuilding the panel throws away the focused field, so clicking from the min box
  // straight into the max box lost the second click ("filters have changed" re-render
  // ate it). Every field the user types into carries a stable data-fk key; the field
  // that had focus - and its caret - is handed back after the rebuild.
  function render(root, state, handlers) {
    const h = handlers || {};
    const act = document.activeElement;
    const fk = act && act.dataset ? act.dataset.fk : null;
    const caret = fk && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
    root.innerHTML = '';
    const tab = el('div', 'item-tab');
    if (state.view === 'item' && state.item) tab.appendChild(itemPanel(state, h));
    else tab.appendChild(historyPanel(state, h));
    root.appendChild(tab);
    if (fk) {
      const back = root.querySelector(`[data-fk="${fk.replace(/"/g, '\\"')}"]`);
      if (back) {
        back.focus();
        if (caret) { try { back.setSelectionRange(caret[0], caret[1]); } catch {} }
      }
    }
  }

  // --- floating context menu (mod actions) ---
  function showMenu(ev, entries) {
    closeMenu();
    const menu = el('div', 'ctx-menu');
    for (const e of entries.filter(Boolean)) {
      const it = el('div', 'ctx-item', esc(e.label));
      it.onclick = () => { closeMenu(); e.fn(); };
      menu.appendChild(it);
    }
    document.body.appendChild(menu);
    const pad = 6;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(ev.clientX, window.innerWidth - r.width - pad) + 'px';
    menu.style.top = Math.min(ev.clientY + 4, window.innerHeight - r.height - pad) + 'px';
    setTimeout(() => {
      const away = (e2) => { if (!menu.contains(e2.target)) closeMenu(); };
      const esc2 = (e2) => { if (e2.key === 'Escape') closeMenu(); };
      menu._cleanup = () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc2); };
      document.addEventListener('mousedown', away);
      document.addEventListener('keydown', esc2);
    }, 0);
  }
  function closeMenu() {
    const m = document.querySelector('.ctx-menu');
    if (m) { if (m._cleanup) m._cleanup(); m.remove(); }
  }

  // --- stat picker overlay (make fungible with / add a mod) ---
  // opts: { title, query(q) -> entries [{id,text,picked}], onPick(entry), onClose() }
  function showPicker(opts) {
    closePicker();
    const ov = el('div', 'ipicker');
    const panel = el('div', 'ipicker-panel');
    const head = el('div', 'ipicker-head');
    const inp = el('input');
    inp.placeholder = opts.placeholder || t('item.picker.default_placeholder');
    inp.autocomplete = 'off';
    // seeded (renaming an item rather than searching fresh): pre-select it so the first
    // keystroke replaces the old name, and Escape closes without picking = unchanged
    if (opts.value) inp.value = opts.value;
    const x = el('button', 'icon-btn', '&#x2715;');
    head.append(el('div', 'ipicker-title', esc(opts.title || t('item.picker.default_title'))), inp, x);
    const list = el('div', 'ipicker-list');
    // a scope entry is either a plain string ("explicit") or {key,label} when the
    // pill's display name differs from the trade key it selects ("Greater Runes")
    const scKey = (s) => (typeof s === 'string' ? s : s.key);
    const scLabel = (s) => (typeof s === 'string' ? s : s.label);
    let scope = (opts.scopes && scKey(opts.scopes[0])) || null;
    let scopeRow = null;
    if (opts.scopes && opts.scopes.length > 1) {
      scopeRow = el('div', 'ipicker-scopes');
      for (const s of opts.scopes) {
        const key = scKey(s);
        // object scopes are curated pools (Greater Runes / Otherworldly), tinted apart from raw trade scopes
        const chip = el('span', 'scope-chip' + (typeof s === 'string' ? '' : ' scope-chip-pool') + (key === scope ? ' on' : ''), esc(scLabel(s)));
        chip.dataset.scope = key;
        chip.onclick = () => {
          scope = key;
          scopeRow.querySelectorAll('.scope-chip').forEach((c) => c.classList.toggle('on', c.dataset.scope === key));
          refresh();
        };
        scopeRow.appendChild(chip);
      }
      panel.append(head, scopeRow, list);
    } else {
      panel.append(head, list);
    }
    ov.appendChild(panel);
    document.body.appendChild(ov);

    const refresh = () => {
      list.innerHTML = '';
      const entries = opts.query(inp.value.trim(), scope);
      // a typed scope word ("frac") overrides the chip - mirror it in the chip row
      const eff = entries.scope || scope;
      if (scopeRow) scopeRow.querySelectorAll('.scope-chip').forEach((c) => c.classList.toggle('on', c.dataset.scope === eff));
      if (!entries.length) { list.appendChild(el('div', 'ipicker-empty', opts.emptyText || t('item.picker.no_matches'))); return; }
      for (const e of entries) {
        // `text` is PLAIN text - hlNums escapes it. Callers that need a trailing tag pass
        // `tag`, they must not smuggle markup through `text` (it comes out double-escaped).
        const row = el('div', 'ipicker-item' + (e.picked ? ' picked' : ''),
          hlNums(e.text)
          + (e.tag ? ` <span class="ipick-ns">${esc(e.tag)}</span>` : '')
          + (e.picked ? ' <span class="pick-mark">&#10003;</span>' : ''));
        row.onclick = () => { opts.onPick(e); refresh(); };
        list.appendChild(row);
      }
    };
    inp.addEventListener('input', refresh);
    const close = () => { closePicker(); if (opts.onClose) opts.onClose(); };
    x.onclick = close;
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    const esc2 = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', esc2, true);
    ov._cleanup = () => document.removeEventListener('keydown', esc2, true);
    refresh();
    inp.focus();
    if (opts.value) inp.select();
  }
  function closePicker() {
    const p = document.querySelector('.ipicker');
    if (p) { if (p._cleanup) p._cleanup(); p.remove(); }
  }

  window.ItemUI = { render, showMenu, showPicker, closePicker };
})();
