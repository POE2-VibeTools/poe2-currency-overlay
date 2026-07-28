// Grand Expedition planner. Design: the page IS the tool - a sticky Aldur
// verdict bar anchored on top, a card grid of rumors beneath it, and nothing
// else in the flow. Reference material (prep, run guide, history) lives in
// slide-over drawers behind a quiet toolbar. Engine: weighted sum over the
// EXPEDITION slots only. Data: grandex-data.js (window.GrandExData).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const D = () => window.GrandExData || { islands: [], ratingWeight: {}, doctrine: {}, runes: { tiers: {}, notes: [] }, prep: {} };

  const state = {
    picked: new Set(),   // rumor names in the discovered roster
    query: '',           // type-to-pick filter text
    focusIdx: 0,         // which match is highlighted (Enter takes it)
    chain: [],           // ordered rune names as they enter the expedition chain (session-scoped)
    prepDone: new Set(), // ticked prep-checklist rows (session-scoped)
    history: [],         // [{ts, rumors, score, verdict}]
    drawer: null,        // null | 'prep' | 'run' | 'hist'
    tagInput: '',
    notice: null,
  };

  if (window.api && window.api.getConfig) {
    window.api.getConfig().then((c) => {
      state.history = Array.isArray(c && c.grandexHistory) ? c.grandexHistory : [];
      render();
    }).catch(() => {});
  }
  const persist = () => { try { window.api.setGrandexHistory(state.history); } catch {} };

  // ---- island codes: deterministic initials, deduped - the tag alphabet ----
  let codeMap = null;
  function codes() {
    if (codeMap) return codeMap;
    const fwd = new Map(), back = new Map();
    for (const i of D().islands.filter((x) => x.type !== 'saga')) {
      let base = i.rumor.split(/\s+/).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '');
      if (!base) base = i.rumor.slice(0, 2).toUpperCase();
      let code = base, n = 2;
      while (back.has(code)) code = base + n++;
      fwd.set(i.rumor, code); back.set(code, i.rumor);
    }
    codeMap = { fwd, back };
    return codeMap;
  }

  const byName = (name) => D().islands.find((i) => i.rumor === name);
  const weightOf = (i) => D().ratingWeight[i.rating] != null ? D().ratingWeight[i.rating] : 3;

  // ---- the verdict engine -------------------------------------------------
  // Aldur's Saga buffs EXPEDITIONS, so the decision rides on how many
  // expedition slots the logbook actually gives you and how good they are.
  // Unique maps and bosses are NOT vetoes - they're simply slots that aren't
  // expeditions (6 rumors with 2 uniques still yields 4 expeditions), so they
  // add no Aldur value but don't disqualify the logbook either. Fallen Stars
  // is the exception worth taking on its own: it guarantees an Aldur saga.
  function verdict() {
    const doc = D().doctrine;
    const picked = [...state.picked].map(byName).filter(Boolean);
    if (!picked.length) return { kind: 'empty' };
    const exped = picked.filter((i) => i.type === 'rumour');
    const other = picked.filter((i) => i.type !== 'rumour');
    const score = Math.round(exped.reduce((a, i) => a + weightOf(i), 0) * 10) / 10;
    const n = exped.length;
    const tail = other.length ? ` (+${other.length} non-expedition)` : '';
    // Fallen Stars is worth running on its own merits (it guarantees a saga),
    // but it does NOT override the 3-expedition floor.
    const bonus = picked.some((i) => i.rumor === 'Fallen Stars') ? ` ${doc.fallenStarsAuto || ''}` : '';
    // HARD GATE: fewer than 3 expeditions is a no regardless of score.
    // Reasons are data, not editorial: the count vs the floor, the score vs
    // the thresholds. The verdict word carries the judgment.
    const spendAt = doc.spendScore || 12, saveUnder = doc.callScore || 9, floor = doc.minRumors || 3;
    const facts = `${n} expedition${n === 1 ? '' : 's'}${tail} · spend at ${spendAt}+, save under ${saveUnder}`;
    if (n < floor) {
      return { kind: 'skip', score, picked, exped, spendAt, saveUnder,
        reason: `${n} of ${floor} expeditions minimum${tail} - score doesn't matter below the floor.${bonus}` };
    }
    if (score >= spendAt) return { kind: 'spend', score, picked, exped, spendAt, saveUnder, reason: `${facts}.${bonus}` };
    if (score >= saveUnder) return { kind: 'judgment', score, picked, exped, spendAt, saveUnder, reason: `${facts}.${bonus}` };
    return { kind: 'skip', score, picked, exped, spendAt, saveUnder, reason: `${facts}.${bonus}` };
  }

  // ---- tag codec: "GE CAI+SUL =11 SPEND" - atlas-note sized, parseable back -
  function tagFor(rumors, score, kind) {
    const c = codes();
    const parts = rumors.map((n) => c.fwd.get(n)).filter(Boolean);
    const word = { spend: 'SPEND', skip: 'SAVE', judgment: 'CALL' }[kind] || '';
    return `GE ${parts.join('+')} =${score} ${word}`.trim();
  }
  function decodeTag(text) {
    const m = /GE\s+([A-Z0-9+]+)/i.exec(String(text || ''));
    if (!m) return null;
    const c = codes();
    const names = m[1].toUpperCase().split('+').map((x) => c.back.get(x)).filter(Boolean);
    return names.length ? names : null;
  }

  // copies patch the clicked element in place - no re-render, no flicker
  function copyFlash(text, btn, flashText, restoreText) {
    if (!text) return;
    try { window.api.writeClipboard(text); } catch {}
    if (!btn) return;
    btn.textContent = flashText;
    setTimeout(() => { try { btn.textContent = restoreText; } catch {} }, 1200);
  }

  // ========================= conclusion bar (sticky, bottom) ================
  // The page reads top-down as the player works: prep tools, pick, review the
  // logbook, THEN the conclusion. It pins to the bottom edge so the verdict
  // and the live tag stay in sight while picking - the tag visibly re-forms
  // on every add/remove.
  function bottomBar() {
    const v = verdict();
    const bar = el('div', `gx-bar${v.kind !== 'empty' ? ' gx-bar-' + v.kind : ''}`);
    if (v.kind === 'empty') {
      bar.appendChild(el('div', 'gx-bar-empty', '<span class="gx-bar-arrow">↑</span> Tap the rumors you see in game - your verdict and map-note tag build here.'));
      return bar;
    }
    const ICON = { spend: '✓', skip: '✕', judgment: '?' }[v.kind];
    const WORD = { spend: 'SPEND THE ALDURS', skip: 'SAVE THE ALDURS', judgment: 'YOUR CALL' }[v.kind];
    const top = el('div', 'gx-bar-top');
    top.appendChild(el('div', `gx-bar-badge gx-v-${v.kind}`, ICON));
    const words = el('div', 'gx-bar-words');
    words.appendChild(el('div', `gx-bar-word gx-v-${v.kind}`, esc(WORD)));
    words.appendChild(el('div', 'gx-bar-reason', esc(v.reason)));
    top.appendChild(words);
    const scoreWrap = el('div', 'gx-scorebox');
    const score = el('div', 'gx-bar-score', `${v.score}`);
    score.title = (v.exped.map((i) => `${i.rumor} ${i.rating} = ${weightOf(i)}`).join('\n') || 'No expeditions picked')
      + `\n\nSum of expedition ratings. Spend at ${v.spendAt}+, save under ${v.saveUnder}.`;
    scoreWrap.appendChild(score);
    // the meter answers "out of what": save | your call | spend zones with the
    // needle at the current score. Scale tops out a bit past the spend line.
    const scaleMax = Math.max(v.spendAt * 1.5, v.score + 1);
    const pct = (x) => Math.min(100, Math.round(100 * x / scaleMax));
    const meter = el('div', 'gx-meter');
    meter.title = `save <${v.saveUnder} · your call ${v.saveUnder}-${v.spendAt} · spend ${v.spendAt}+`;
    const zSave = el('div', 'gx-meter-zone gx-mz-save'); zSave.style.width = pct(v.saveUnder) + '%'; meter.appendChild(zSave);
    const zCall = el('div', 'gx-meter-zone gx-mz-call'); zCall.style.left = pct(v.saveUnder) + '%'; zCall.style.width = (pct(v.spendAt) - pct(v.saveUnder)) + '%'; meter.appendChild(zCall);
    const zSpend = el('div', 'gx-meter-zone gx-mz-spend'); zSpend.style.left = pct(v.spendAt) + '%'; zSpend.style.width = (100 - pct(v.spendAt)) + '%'; meter.appendChild(zSpend);
    const needle = el('div', 'gx-meter-needle'); needle.style.left = pct(v.score) + '%'; meter.appendChild(needle);
    scoreWrap.appendChild(meter);
    top.appendChild(scoreWrap);
    bar.appendChild(top);
    // the tag row: the artifact, forming live
    const tag = tagFor([...state.picked], v.score, v.kind);
    const row = el('div', 'gx-bar-tagrow');
    const tagBox = el('input', 'gx-bar-tag');
    tagBox.readOnly = true;
    tagBox.value = tag;
    tagBox.title = 'Your map-note tag - paste it on the atlas; the app reads it back later';
    tagBox.onclick = () => { tagBox.select(); copyFlash(tag, null); };
    row.appendChild(tagBox);
    const cp = el('button', 'gx-bar-btn', '⧉ Copy');
    cp.onclick = () => copyFlash(tag, cp, '✓ Copied', '⧉ Copy');
    row.appendChild(cp);
    const sv = el('button', 'gx-bar-btn', '+ Save');
    sv.title = 'Save this run to History';
    sv.onclick = () => {
      state.history.unshift({ ts: Date.now(), rumors: [...state.picked], score: v.score, verdict: v.kind });
      persist();
      state.notice = { kind: 'ok', msg: 'Saved to History.' };
      render();
    };
    row.appendChild(sv);
    const clr = el('button', 'gx-bar-btn gx-bar-clear', '✕');
    clr.title = 'Clear picks';
    clr.onclick = () => { state.picked.clear(); render(); };
    row.appendChild(clr);
    bar.appendChild(row);
    return bar;
  }

  // ========================= roster summary =================================
  // "What am I actually getting?" - the picked logbook spelled out: counts up
  // top, then every pick with its island, payoff and score contribution.
  // Expeditions carry the Aldur score; uniques/bosses are listed as content
  // you'll see but explicitly marked as adding no saga value.
  const TYPE_LABEL = { rumour: 'Expeditions', unique: 'Unique maps', boss: 'Bosses' };
  const TYPE_SHORT = { rumour: 'expedition', unique: 'unique map', boss: 'boss' };
  function summaryCard() {
    const v = verdict();
    if (v.kind === 'empty') return null;
    const card = el('div', 'gx-sum');
    const head = el('div', 'gx-sum-head');
    head.appendChild(el('span', 'gx-sum-title', 'Your logbook'));
    const counts = ['rumour', 'unique', 'boss']
      .map((t) => [t, v.picked.filter((i) => i.type === t).length])
      .filter(([, n]) => n)
      .map(([t, n]) => `${n} ${TYPE_SHORT[t]}${n === 1 ? '' : 's'}`);
    head.appendChild(el('span', 'gx-sum-counts', esc(counts.join(' · '))));
    card.appendChild(head);
    for (const type of ['rumour', 'unique', 'boss']) {
      const items = v.picked.filter((i) => i.type === type);
      if (!items.length) continue;
      const sub = el('div', `gx-sum-sub gx-sum-${type}`);
      sub.appendChild(el('span', 'gx-sum-sub-lab', esc(TYPE_LABEL[type])));
      sub.appendChild(el('span', 'gx-sum-sub-note', type === 'rumour'
        ? `score ${v.score}` : 'no Aldur value'));
      card.appendChild(sub);
      for (const i of items) {
        const row = el('div', 'gx-sum-row');
        row.appendChild(el('span', `gx-sum-tier gx-t-${TIER(i.rating)}`, esc(i.rating)));
        const body = el('span', 'gx-sum-body');
        body.appendChild(el('span', 'gx-sum-name', esc(i.rumor)));
        body.appendChild(el('span', 'gx-sum-sub2', `${esc(i.map)} · ${esc(i.payoff)}`));
        row.appendChild(body);
        row.appendChild(el('span', 'gx-sum-w', type === 'rumour' ? `+${weightOf(i)}` : '—'));
        const x = el('button', 'gx-mini', '✕');
        x.title = 'Remove from the roster';
        x.onclick = () => { state.picked.delete(i.rumor); render(); };
        row.appendChild(x);
        if (i.notes) row.title = i.notes;
        card.appendChild(row);
      }
    }
    return card;
  }

  // ========================= type-to-pick search =============================
  // Keyboard-first: type, the best match highlights, Enter adds it and clears
  // the box so you can keep typing the next one. Matches rumor names first,
  // then map names and rewards, so "moor" or "gold" also land.
  // is the search box the live focus RIGHT NOW? checked at render time, before
  // the DOM rebuild destroys it - blur events on detached nodes are unreliable
  const searchHasFocus = () => !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('gx-search'));
  function rank(island, q) {
    const name = island.rumor.toLowerCase();
    const map = (island.map || '').toLowerCase();
    const payoff = (island.payoff || '').toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s,]+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    if (map.startsWith(q)) return 3;
    if (map.includes(q)) return 4;
    if (payoff.toLowerCase().includes(q)) return 5;
    return -1;
  }
  // ranked, unpicked islands matching the current query (empty query = none)
  function matches() {
    const q = state.query.trim().toLowerCase();
    if (!q) return [];
    return D().islands
      .filter((i) => i.type !== 'saga' && !state.picked.has(i.rumor))
      .map((i) => ({ i, r: rank(i, q) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i.rumor.length - b.i.rumor.length)
      .map((x) => x.i);
  }
  const bestMatch = () => { const m = matches(); return m[Math.min(state.focusIdx, m.length - 1)] || null; };

  function searchBox() {
    const wrap = el('div', 'gx-search-wrap');
    const inp = el('input', 'gx-search');
    inp.placeholder = 'Type a rumor, island or reward - Enter adds it';
    inp.value = state.query;
    inp.oninput = () => { state.query = inp.value; state.focusIdx = 0; render(); };
    inp.onkeydown = (e) => {
      const list = matches();
      if (e.key === 'Enter') {
        e.preventDefault();
        const pick = list[Math.min(state.focusIdx, list.length - 1)];
        if (pick) { state.picked.add(pick.rumor); state.query = ''; state.focusIdx = 0; render(); }
        return;
      }
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault(); state.focusIdx = Math.min(state.focusIdx + 1, Math.max(0, list.length - 1)); render(); return;
      }
      if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault(); state.focusIdx = Math.max(0, state.focusIdx - 1); render(); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); state.query = ''; state.focusIdx = 0; render(); }
    };
    wrap.appendChild(inp);
    const m = matches();
    if (state.query.trim()) {
      wrap.appendChild(el('span', 'gx-search-hint', m.length
        ? `${m.length} match${m.length === 1 ? '' : 'es'} · ↵ add · ↑↓ pick`
        : 'no match'));
    }
    return wrap;
  }

  // ========================= rumor card grid ================================
  const TIER = (r) => r.startsWith('S') ? 's' : r.startsWith('A') ? 'a' : r.startsWith('B') ? 'b' : 'low';
  function grid() {
    const wrap = el('div', 'gx-grid-wrap');
    // while typing, the grid narrows to the ranked matches and the best one
    // carries the highlight Enter will take
    const q = state.query.trim();
    const matchSet = q ? new Set(matches().map((i) => i.rumor)) : null;
    const best = q ? bestMatch() : null;
    // the three families add thematically different logbook content - they
    // read as visually distinct sections (amber / unique-orange / crimson)
    const groups = [['rumour', 'Expeditions'], ['unique', 'Unique maps'], ['boss', 'Bosses']];
    for (const [type, label] of groups) {
      // picked cards always stay visible so you can see/undo your roster
      const items = D().islands.filter((i) => i.type === type && (!matchSet || matchSet.has(i.rumor) || state.picked.has(i.rumor)));
      if (!items.length) continue;
      const head = el('div', `gx-sec gx-sec-${type}`);
      head.appendChild(el('span', 'gx-sec-lab', esc(label)));
      head.appendChild(el('span', 'gx-sec-rule'));
      wrap.appendChild(head);
      const g = el('div', 'gx-grid');
      for (const i of items) {
        const on = state.picked.has(i.rumor);
        const hot = best && best.rumor === i.rumor;
        const card = el('button', `gx-isle gx-k-${type} gx-t-${TIER(i.rating)}${on ? ' on' : ''}${hot ? ' hot' : ''}`);
        card.appendChild(el('span', 'gx-isle-tier', esc(i.rating)));
        const body = el('span', 'gx-isle-body');
        body.appendChild(el('span', 'gx-isle-name', esc(i.rumor)));
        body.appendChild(el('span', 'gx-isle-sub', `${esc(i.map)} · ${esc(i.payoff)}`));
        card.appendChild(body);
        if (on) card.appendChild(el('span', 'gx-isle-check', '✓'));
        else if (hot) card.appendChild(el('span', 'gx-isle-enter', '↵'));
        card.title = i.notes || `${i.map} - ${i.payoff}`;
        card.onclick = () => { on ? state.picked.delete(i.rumor) : state.picked.add(i.rumor); render(); };
        g.appendChild(card);
      }
      wrap.appendChild(g);
    }
    const tip = el('div', 'gx-rotate-tip', '↻ 3 rumors show at a time - move any inventory item or toggle a Saga to rotate the window');
    tip.title = D().rotation || '';
    wrap.appendChild(tip);
    return wrap;
  }

  // ========================= toolbar + drawers ==============================
  function toolbar() {
    const bar = el('div', 'gx-tools');
    const mk = (key, icon, label) => {
      const b = el('button', 'gx-tool' + (state.drawer === key ? ' on' : ''), `${icon} ${esc(label)}`);
      b.onclick = () => { state.drawer = state.drawer === key ? null : key; render(); };
      return b;
    };
    bar.appendChild(mk('prep', '⚒', 'Prep'));
    bar.appendChild(mk('run', '⚗', 'Run guide'));
    bar.appendChild(mk('hist', '🕘', `History${state.history.length ? ' (' + state.history.length + ')' : ''}`));
    return bar;
  }

  function drawer() {
    if (!state.drawer) return null;
    const wrap = el('div', 'gx-drawer-veil');
    wrap.onclick = (e) => { if (e.target === wrap) { state.drawer = null; render(); } };
    const panel = el('div', 'gx-drawer');
    const title = { prep: '⚒ Prep the farm', run: '⚗ Run it right', hist: '🕘 History' }[state.drawer];
    const head = el('div', 'gx-drawer-head');
    head.appendChild(el('span', 'gx-drawer-title', title));
    head.appendChild(el('span', 'rx-flex'));
    const x = el('button', 'gx-mini gx-drawer-x', '✕');
    x.onclick = () => { state.drawer = null; render(); };
    head.appendChild(x);
    panel.appendChild(head);
    const b = el('div', 'gx-drawer-body');
    if (state.drawer === 'prep') drawPrep(b);
    if (state.drawer === 'run') drawRun(b);
    if (state.drawer === 'hist') drawHist(b);
    panel.appendChild(b);
    wrap.appendChild(panel);
    return wrap;
  }

  function block(parent, icon, title) {
    const h = el('div', 'gx-block-head', (icon ? `<span class="gx-ico">${icon}</span> ` : '') + esc(title));
    parent.appendChild(h);
    const body = el('div', 'gx-block');
    parent.appendChild(body);
    return body;
  }

  // a purchase card: the item AS ITS IN-GAME TOOLTIP (icon + window), with
  // its buy button(s) integrated in the card footer - one self-contained unit
  function purchaseCard(root, { icon, name, base, implicit, lines, note, links, tierNum }) {
    const card = el('div', 'gx-buy-card');
    const row = el('div', 'gx-item');
    if (icon) {
      const wrap = el('span', 'gx-item-iconwrap');
      const img = el('img', 'gx-item-icon');
      img.src = 'grandex/img/' + icon; img.alt = name;
      wrap.appendChild(img);
      // the game stamps the tier numeral over waystone art - match it
      if (tierNum) wrap.appendChild(el('span', 'gx-way-num', esc(tierNum)));
      row.appendChild(wrap);
    }
    const tip = el('div', 'gx-ttip');
    // tablets are always run RARE - two-line rare header (generated name over
    // the base) exactly like the in-game window
    const head = el('div', 'gx-ttip-head gx-rare');
    head.appendChild(el('div', 'gx-ttip-name', esc(name)));
    if (base) head.appendChild(el('div', 'gx-ttip-basename', esc(base)));
    tip.appendChild(head);
    const body = el('div', 'gx-ttip-body');
    if (implicit) { body.appendChild(el('div', 'gx-ttip-line', esc(implicit))); body.appendChild(el('div', 'gx-ttip-sep')); }
    for (const l of lines || []) {
      if (l.prop) { body.appendChild(el('div', 'gx-ttip-prop', l.html)); continue; }
      const txt = typeof l === 'string' ? l : l.text;
      const cls = 'gx-ttip-line' + (l.fill ? ' gx-fill' : l.want ? ' gx-want' : '');
      body.appendChild(el('div', cls, esc(txt)));
    }
    tip.appendChild(body);
    row.appendChild(tip);
    card.appendChild(row);
    if (note) card.appendChild(el('div', 'gx-buy-note', esc(note)));
    if (links && links.length) {
      const foot = el('div', 'gx-buy-foot');
      for (const l of links) {
        const a = el('button', 'gx-buy-btn', `⇗ ${esc(l.label)}`);
        a.title = 'Opens the trade site in your browser';
        a.onclick = () => { try { window.api.openExternal(l.url); } catch { window.open(l.url); } };
        foot.appendChild(a);
      }
      card.appendChild(foot);
    }
    root.appendChild(card);
  }

  function drawPrep(root) {
    const p = D().prep;
    const L = (p.tablets && p.tablets.links) || [];
    const b1 = block(root, null, 'Tablets - what to buy');
    // Every tablet you run is a RARE with 4 mods - the question is WHICH 4.
    // Three shopping tiers, one card each: same item, better rolls as you pay
    // up. Bright lines = the mods you're paying for; dimmed = filler.
    purchaseCard(b1, {
      icon: 'PrecursorTabletGeneric.webp', name: 'Veiled Cataclysm', base: 'Precursor Tablet · cheap tier',
      lines: [
        { text: 'Map has 35% increased number of Rare Monsters', want: true },
        { text: 'Map has 20% increased Monster Rarity', want: true },
        { text: '18% increased Experience gain in Map', fill: true },
        { text: '35% increased Gold found in Map', fill: true },
      ],
      note: 'Any 2 of Rares / Effectiveness / Monster Rarity, filler for the rest. For non-Aldur saga maps.',
      links: L.slice(0, 1),
    });
    purchaseCard(b1, {
      icon: 'PrecursorTabletGeneric.webp', name: 'Otherworldly Provocation', base: 'Irradiated Tablet · mid tier',
      implicit: 'Adds Irradiated to a Map',
      lines: [
        { text: 'Map has 2 additional random Modifiers', want: true },
        { text: 'Monsters have 15% increased Effectiveness', want: true },
        { text: '12% increased Rarity of Items found in Map', fill: true },
        { text: '18% increased Experience gain in Map', fill: true },
      ],
      note: 'Buy 3 for Aldur maps. "2 additional Modifiers" is the must-have, plus Effectiveness or Rares.',
      links: L.slice(1, 2),
    });
    purchaseCard(b1, {
      icon: 'PrecursorTabletGeneric.webp', name: 'Grinning Cataclysm', base: 'Irradiated Tablet · big tier',
      implicit: 'Adds Irradiated to a Map',
      lines: [
        { text: 'Map has 2 additional random Modifiers', want: true },
        { text: 'Monsters have 15% increased Effectiveness', want: true },
        { text: 'Map has 35% increased number of Rare Monsters', want: true },
        { text: '12% increased Rarity of Items found in Map', fill: true },
      ],
      note: 'The perfect buy - all three wanted mods on one tablet. Pay accordingly.',
      links: L.slice(2),
    });
    const b2 = block(root, null, 'Waystone - what to run');
    purchaseCard(b2, {
      icon: 'Waystone-T15.png', name: 'Waystone (Tier 15)', // Drew's in-game 0.5 icon, XV baked in
      lines: [
        { prop: true, html: 'Monster Effectiveness: <b>+70%</b>' },
        { prop: true, html: '8 Modifiers - the more the better' },
      ],
      note: 'Highest Monster Effectiveness wins; Monster Rarity good, Rarity okay, Pack Size bad. T15 is enough. Budget: craft 70% effect 6-mods, then corrupt.',
    });
    if (p.master) {
      const b3 = block(root, null, 'Atlas Master');
      const mc = el('div', 'gx-buy-card gx-master');
      mc.appendChild(el('div', 'gx-master-name', esc(p.master.name)));
      const chips = el('div', 'gx-node-chips');
      for (const n of p.master.nodes) chips.appendChild(el('span', 'gx-node-chip', esc(n)));
      mc.appendChild(chips);
      if (p.master.alt) mc.appendChild(el('div', 'gx-buy-note', esc(p.master.alt)));
      b3.appendChild(mc);
    }
    if ((p.reminders || []).length) {
      const b4 = block(root, null, 'Before you start');
      p.reminders.forEach((r, i) => {
        const done = state.prepDone.has(i);
        const rowEl = el('button', 'gx-check' + (done ? ' done' : ''), `<span class="gx-check-box">${done ? '✓' : ''}</span> ${esc(r)}`);
        rowEl.onclick = () => { done ? state.prepDone.delete(i) : state.prepDone.add(i); render(); };
        b4.appendChild(rowEl);
      });
    }
  }

  // rune roster: the named tiers + generic filler entries so a chain can be
  // tracked accurately even for the unnamed B/C runes
  const RUNE_ROSTER = () => {
    const t = D().runes.tiers || {};
    const out = [];
    for (const [tier, names] of Object.entries(t)) for (const n of names) out.push({ name: n, tier });
    out.push({ name: 'Other purple', tier: 'B' });
    out.push({ name: 'Other blue', tier: 'C' });
    return out;
  };
  const RUNE_POWER = { SS: 6, S: 4, A: 3, B: 2, C: 1 };

  function drawRun(root) {
    // ---- the chain builder: tap runes as they enter your expedition chain ----
    const cb = block(root, '⛓', 'Your rune chain');
    const roster = el('div', 'gx-runes');
    for (const r of RUNE_ROSTER()) {
      const count = state.chain.filter((n) => n === r.name).length;
      // named runes don't stack, so once one is in the chain it dims out as
      // "already got it". The generic purple/blue buckets DO repeat, so they
      // stay bright and just carry a count.
      const generic = r.name.startsWith('Other');
      const used = count > 0 && !generic;
      const chip = el('button', 'gx-rune' + (used ? ' used' : ''),
        `<span class="gx-rune-t ${esc(r.tier.toLowerCase())}">${esc(r.tier)}</span> ${esc(r.name)}`
        + (generic && count ? ` <span class="gx-rune-n">×${count}</span>` : ''));
      chip.title = used ? 'Already in your chain (runes don\'t stack) - click to add again anyway' : 'Add to your chain';
      chip.onclick = () => { state.chain.push(r.name); render(); };
      roster.appendChild(chip);
    }
    cb.appendChild(roster);
    if (state.chain.length) {
      const chainRow = el('div', 'gx-runes');
      state.chain.forEach((n, idx) => {
        const r = RUNE_ROSTER().find((x) => x.name === n) || { tier: 'B' };
        const c = el('button', 'gx-rune in', `<span class="gx-rune-check">✓</span> ${esc(n)}`);
        c.title = 'Remove from chain';
        c.onclick = () => { state.chain.splice(idx, 1); render(); };
        chainRow.appendChild(c);
      });
      cb.appendChild(chainRow);
      const power = state.chain.reduce((a, n) => a + (RUNE_POWER[(RUNE_ROSTER().find((x) => x.name === n) || {}).tier] || 2), 0);
      const uniq = new Set(state.chain).size;
      const sum = el('div', 'gx-chain-sum', `${state.chain.length} rune${state.chain.length === 1 ? '' : 's'} in chain (${uniq} unique - runes don't stack) · rough power <b>${power}</b>`);
      cb.appendChild(sum);
      const clr = el('button', 'gx-mini', '✕ clear chain');
      clr.onclick = () => { state.chain = []; render(); };
      cb.appendChild(clr);
    } else {
      cb.appendChild(el('div', 'gx-line gx-dim', 'Tap runes above as they enter your chain - the tally and a rough power score build here.'));
    }
    const n = block(root, '📜', 'Doctrine');
    for (const note of D().runes.notes || []) n.appendChild(el('div', 'gx-line', '· ' + esc(note)));
    const pickedNotes = [...state.picked].map(byName).filter((i) => i && i.notes);
    if (pickedNotes.length) {
      const pn = block(root, '🗺', 'Your picked islands');
      for (const i of pickedNotes) pn.appendChild(el('div', 'gx-line', `<b>${esc(i.rumor)}</b> (${esc(i.map)}): ${esc(i.notes)}`));
    }
  }

  function drawHist(root) {
    const read = el('div', 'gx-tag-row');
    const inp = el('input', 'gx-tag gx-tag-in'); inp.placeholder = 'Paste a GE tag to rebuild its rumor set…'; inp.value = state.tagInput;
    inp.oninput = () => { state.tagInput = inp.value; };
    const go = el('button', 'gx-bar-btn', 'Read');
    go.onclick = () => {
      const names = decodeTag(state.tagInput);
      if (!names) { state.notice = { kind: 'warn', msg: "Couldn't read that tag - expected e.g. 'GE CAI+SUL =11 FISH'." }; render(); return; }
      state.picked = new Set(names);
      state.tagInput = '';
      state.drawer = null;
      state.notice = { kind: 'ok', msg: `Rebuilt ${names.length} rumor${names.length === 1 ? '' : 's'} from the tag.` };
      render();
    };
    read.appendChild(inp); read.appendChild(go);
    root.appendChild(read);
    if (!state.history.length) { root.appendChild(el('div', 'gx-line gx-dim', 'No saved runs yet - use + Save in the verdict bar.')); return; }
    state.history.forEach((h, idx) => {
      const row = el('div', 'gx-hist');
      const tag = tagFor(h.rumors, h.score, h.verdict);
      row.appendChild(el('span', `gx-hist-v gx-v-${h.verdict}`, esc((h.verdict || '').toUpperCase())));
      const lab = el('span', 'gx-hist-lab', esc(h.rumors.join(', ')));
      lab.title = tag;
      row.appendChild(lab);
      row.appendChild(el('span', 'gx-hist-score', esc(String(h.score))));
      const cp = el('button', 'gx-mini', '⧉'); cp.title = 'Copy this run\'s tag';
      cp.onclick = () => copyFlash(tag, cp, '✓', '⧉');
      row.appendChild(cp);
      const re = el('button', 'gx-mini', '↻'); re.title = 'Load this rumor set into the picker';
      re.onclick = () => { state.picked = new Set(h.rumors); state.drawer = null; render(); };
      row.appendChild(re);
      const del = el('button', 'gx-mini', '✕'); del.title = 'Delete';
      del.onclick = () => { state.history.splice(idx, 1); persist(); render(); };
      row.appendChild(del);
      root.appendChild(row);
    });
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    const root = $('grandex-root');
    if (!root || root.classList.contains('hidden')) return;
    const keepSearchFocus = searchHasFocus(); // read BEFORE the wipe
    root.innerHTML = '';
    if (state.notice) {
      const n = el('div', `gx-notice gx-${state.notice.kind}`, esc(state.notice.msg));
      n.onclick = () => { state.notice = null; render(); };
      root.appendChild(n);
    }
    // top-down = the order you actually work: prep refs, pick, review, conclude
    root.appendChild(toolbar());
    root.appendChild(searchBox());
    root.appendChild(grid());
    const sum = summaryCard();
    if (sum) root.appendChild(sum);
    root.appendChild(bottomBar());
    const dw = drawer();
    if (dw) root.appendChild(dw);
    // render() rebuilds the DOM, so hand focus back to the search box (caret at
    // the end) whenever the user was mid-typing - including right after an
    // Enter-pick cleared the query, so type+Enter+type+Enter just flows
    if (!state.drawer && (keepSearchFocus || state.query)) {
      const s = root.querySelector('.gx-search');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  }

  window.GrandEx = { render };
})();
