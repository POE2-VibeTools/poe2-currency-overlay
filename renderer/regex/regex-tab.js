// Regex tab. Same grammar as Grand Expedition: the page IS the builder, read
// top-down (item type -> subtype -> Wanted / Excluded lists), with the pattern
// forming LIVE in a sticky bottom bar (count + Copy + label + Save). Saved
// regexes - the daily 1-click-copy surface - live in a slide-over drawer
// behind the "Saved regexes" chip up top, out of the compose flow.
// Pools: pools-data.js (window.RegexPools). Generation: regex-gen.js.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const state = {
    cls: 'waystone',        // 'waystone' | 'tablet' | 'custom'
    tabletType: null,       // null = all types; else a tablet base name - filters the PICKER only
    sel: new Map(),         // pool text -> {mode:'inc'|'exc', min:null|number, group:null|number}
    groupSeq: 1,            // next OR-group id
    picker: null,           // null | {mode:'inc'|'exc', group:null|number} - the open add-picker
    pickerQuery: '',
    buckets: [],            // [{id,name,entries:[{id,label,pattern}]}]
    drawerOpen: false,      // the Saved-regexes drawer
    saveLabel: '',          // label field in the bottom bar (builder AND custom)
    saveBucket: null,
    customPattern: '',
    confirmDel: null,       // bucket id in delete-confirm state
    editEntry: null,        // entry id in inline edit
    addingTo: null,         // bucket id with the inline "+ Add regex" form open
    editBucket: null,       // bucket id in rename
    notice: null,
  };

  // ---- persistence ----------------------------------------------------------
  function persist() { try { window.api.setRegexBuckets(state.buckets); } catch {} }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const savedCount = () => state.buckets.reduce((a, b) => a + b.entries.length, 0);

  if (window.api && window.api.getConfig) {
    window.api.getConfig().then((c) => {
      state.buckets = Array.isArray(c && c.regexBuckets) && c.regexBuckets.length
        ? c.regexBuckets
        : [{ id: 'default', name: 'My Regex', entries: [] }];
      state.saveBucket = state.buckets[0].id;
      render();
    }).catch(() => {});
  }

  // ---- pools ----------------------------------------------------------------
  // Tablets are ONE pool: every type shares the same stash tab in game, so a
  // search runs across all of them at once - fragment uniqueness has to hold
  // across the combined set, not within one type's list. The per-type
  // structure in pools-data.js survives only as picker group headers.
  let tabletMergedCache = null;
  function tabletMerged() {
    if (tabletMergedCache) return tabletMergedCache;
    const RP = window.RegexPools || {};
    const P = RP.tablet || {};
    const seen = new Map();
    // type implicits lead the pool: picking one filters the stash to a type
    for (const imp of RP.tabletImplicits || []) {
      seen.set(imp.text, { text: imp.text, group: 'Tablet type', type: imp.type });
    }
    for (const type of Object.keys(P)) {
      for (const m of P[type]) {
        const prev = seen.get(m.text);
        if (prev) { if (m.max != null && (prev.max == null || m.max > prev.max)) prev.max = m.max; if (m.bad) prev.bad = true; continue; }
        seen.set(m.text, { ...m, group: type });
      }
    }
    tabletMergedCache = [...seen.values()];
    return tabletMergedCache;
  }
  let waystonePoolCache = null;
  function poolFor(cls) {
    const P = window.RegexPools || {};
    if (cls === 'waystone') {
      // section the tooltip's derived header lines (the "core 4" + tier that
      // players actually combine) away from the affix soup below them
      if (!waystonePoolCache) waystonePoolCache = (P.waystone || []).map((m) => ({ ...m, group: m.prop ? 'Core stats' : 'Waystone mods' }));
      return waystonePoolCache;
    }
    if (cls === 'tablet') return tabletMerged();
    return [];
  }
  const poolTexts = (cls) => poolFor(cls).map((m) => m.text);

  // ---- builder output -------------------------------------------------------
  function buildOutput() {
    const pool = poolTexts(state.cls);
    const includes = [], excludes = [];
    for (const [text, s] of state.sel) {
      const mod = poolFor(state.cls).find((m) => m.text === text);
      if (!mod) continue;
      if (s.mode === 'exc') excludes.push(mod);
      else includes.push({ mod, min: s.min, group: s.group == null ? null : s.group });
    }
    if (!includes.length && !excludes.length) return '';
    try { return window.RegexGen.build(includes, excludes, pool); } catch { return ''; }
  }
  const livePattern = () => state.cls === 'custom' ? state.customPattern.trim() : buildOutput();

  // ---- copy -----------------------------------------------------------------
  // Copies NEVER re-render - they patch the clicked element in place and
  // revert after a beat, so the page (and an open drawer) can't flicker.
  function copyFlash(pattern, elToFlash, apply, revert) {
    if (!pattern) return;
    try { window.api.writeClipboard(pattern); } catch {}
    if (window.logAction) window.logAction('regex-copy');
    if (!elToFlash) return;
    apply();
    setTimeout(() => { try { revert(); } catch {} }, 1200);
  }

  // ---- save into a bucket ---------------------------------------------------
  function saveEntry(label, pattern) {
    if (!pattern) return;
    const b = state.buckets.find((x) => x.id === state.saveBucket) || state.buckets[0];
    if (!b) return;
    b.entries.push({ id: newId(), label: label || 'Unnamed regex', pattern });
    persist();
    state.notice = { kind: 'ok', msg: `Saved to ${b.name} - it's in your Saved regexes.` };
    render();
  }

  // ---- seed from a pasted/copied item --------------------------------------
  // Raw item text (Ctrl+C in game) -> pick the class, tick every pool mod the
  // item has. Numbered lines seed their roll as the minimum; mods flagged bad
  // seed as EXCLUDE (players filter against them, not for them).
  function seedFromText(text) {
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const clsLine = lines.find((l) => /^Item Class:/i.test(l)) || '';
    let cls = null;
    if (/waystone/i.test(clsLine)) cls = 'waystone';
    else if (/tablet/i.test(clsLine)) {
      cls = 'tablet'; // one pool covers every type
      // the pasted tablet's implicit names its type - preselect the subtype filter
      const imp = ((window.RegexPools || {}).tabletImplicits || []).find((i) => lines.some((l) => l.toLowerCase() === i.text.toLowerCase()));
      state.tabletType = imp ? imp.type : null;
    }
    if (!cls) { state.notice = { kind: 'warn', msg: "That doesn't look like a waystone or tablet - copy one in game with Ctrl+C." }; render(); return false; }
    state.cls = cls;
    state.sel = new Map();
    const pool = poolFor(cls);
    // advanced copies write values as "82(70-100)%" - strip the "(a-b)" range
    // part; the game also singularizes count words at 1 ("1 additional random
    // Modifier" vs the pool's plural), so the final plural 's' is optional
    const clean = lines.map((l) => l
      .replace(/\(([0-9]+(?:\.[0-9]+)?[-–][0-9]+(?:\.[0-9]+)?)\)/g, '')
      .replace(/\s+[—–-]+\s+Unscalable Value$/i, '')); // advanced-copy annotation, not tooltip text
    for (const mod of pool) {
      if (mod.hidden) continue;
      const segs = mod.text.split('#').map((p) => p.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'));
      const last = segs.length - 1;
      if (/s$/i.test(segs[last])) segs[last] = segs[last].replace(/s$/i, 's?');
      const rx = new RegExp('^' + segs.join('([0-9]+(?:\\.[0-9]+)?)') + '( \\(.*\\))?$', 'i');
      for (const line of clean) {
        const m = rx.exec(line);
        if (!m) continue;
        const val = m[1] != null ? Math.floor(parseFloat(m[1])) : null;
        if (mod.bad) state.sel.set(mod.text, { mode: 'exc', min: null });
        else state.sel.set(mod.text, { mode: 'inc', min: val });
        break;
      }
    }
    state.notice = state.sel.size
      ? { kind: 'ok', msg: `Read ${state.sel.size} mod${state.sel.size === 1 ? '' : 's'} from your item - adjust below; the pattern is in the bar.` }
      : { kind: 'warn', msg: 'Recognized the item but none of its lines are in the mod pool yet.' };
    render();
    return true;
  }

  // ========================= toolbar (Saved chip) ============================
  function toolbar() {
    const bar = el('div', 'rx-tools');
    const n = savedCount();
    const chip = el('button', 'gx-tool' + (state.drawerOpen ? ' on' : ''), `🗂 Saved regexes${n ? ` (${n})` : ''}`);
    chip.title = 'Your buckets - one click copies a saved regex';
    chip.onclick = () => { state.drawerOpen = !state.drawerOpen; render(); };
    bar.appendChild(chip);
    return bar;
  }

  // ========================= builder (the page) ==============================
  function builderBody() {
    const card = el('div', 'rx-card rx-builder');
    // segmented item-type picker
    const seg = el('div', 'rx-seg');
    const segBtn = (v, label, title) => {
      const b = el('button', 'rx-seg-btn' + (state.cls === v ? ' on' : ''), esc(label));
      if (title) b.title = title;
      b.onclick = () => { if (state.cls !== v) { state.cls = v; state.tabletType = null; state.sel = new Map(); state.picker = null; state.notice = null; render(); } };
      return b;
    };
    seg.appendChild(segBtn('waystone', 'Waystone', 'Build from the waystone mod pool'));
    seg.appendChild(segBtn('tablet', 'Tablet', 'All tablet types - they share a stash tab, so one search covers them all'));
    seg.appendChild(segBtn('custom', '✎ Custom', 'Write your own regex and save it under a label'));
    card.appendChild(seg);

    if (state.cls === 'custom') {
      card.appendChild(el('div', 'rx-tip', 'Write any regex - it flows into the bar below to copy or save under a label.'));
      const pat = el('textarea', 'rx-in rx-mono rx-custom-pattern'); pat.placeholder = 'Your regex, e.g. "rity: \\+(8[5-9]|9[0-9])"'; pat.value = state.customPattern;
      pat.oninput = () => { const caret = pat.selectionStart; state.customPattern = pat.value; render(); keepCustomFocus(caret); };
      card.appendChild(pat);
      return card;
    }

    // tablet subtype filter: narrows the PICKER to generic + that type's mods
    // (mechanics: every type rolls the generic pool; uniques are additive;
    // Irradiated rolls generic only). Patterns stay validated against the full
    // pool - the stash tab holds every type at once.
    if (state.cls === 'tablet') {
      const RP = window.RegexPools || {};
      const types = [...new Set([
        ...Object.keys(RP.tablet || {}).filter((k) => !/^precursor tablet$/i.test(k)),
        ...(RP.tabletImplicits || []).map((i) => i.type).filter((t) => !/^precursor tablet$/i.test(t)),
      ])];
      const sub = el('div', 'rx-seg rx-subseg');
      const subBtn = (v, label, title) => {
        const b = el('button', 'rx-seg-btn rx-sub-btn' + (state.tabletType === v ? ' on' : ''), esc(label));
        if (title) b.title = title;
        b.onclick = () => { state.tabletType = v; state.picker = null; render(); };
        return b;
      };
      sub.appendChild(subBtn(null, 'All', 'Every tablet type'));
      for (const t of types) sub.appendChild(subBtn(t, t.replace(/ ?Tablet$/i, ''), `Generic mods + ${t}-only mods`));
      card.appendChild(sub);
    }

    card.appendChild(el('div', 'rx-tip', 'Tip: copy a waystone or tablet in game (Ctrl+C) and paste it here (Ctrl+V) to pre-fill everything.'));
    card.appendChild(modList('inc', 'Wanted mods', '+ Add mod'));
    card.appendChild(modList('exc', 'Excluded mods', '+ Add exclusion'));
    return card;
  }

  // one selected-mod row (shared by standalone and OR-group rendering)
  function selRow(mode, text, s, pool) {
    const mod = pool.find((m) => m.text === text);
    if (!mod) return null;
    const r = el('div', 'rx-sel');
    const rng = mod.min != null && mod.max != null ? (mod.min === mod.max ? String(mod.max) : `${mod.min}-${mod.max}`) : mod.max != null ? `up to ${mod.max}` : '';
    r.appendChild(el('span', 'rx-sel-text', esc(mod.text) + (rng ? `<span class="rx-range">${esc(rng)}</span>` : '')));
    if (mode === 'inc' && mod.text.includes('#') && (mod.max == null || mod.max > 1)) {
      r.appendChild(el('span', 'rx-min-lab', '≥'));
      const min = el('input', 'rx-in rx-min'); min.type = 'text'; min.inputMode = 'numeric';
      min.placeholder = mod.min != null ? String(mod.min) : 'any';
      if (rng) min.title = `Rolls ${rng}`;
      if (s.min != null) min.value = s.min;
      min.onchange = () => {
        let v = parseInt(min.value, 10);
        if (Number.isFinite(v) && mod.max != null && v > mod.max) v = mod.max; // can't roll higher - a bigger threshold matches nothing
        s.min = Number.isFinite(v) && v > 0 ? v : null;
        render();
      };
      r.appendChild(min);
    }
    const x = el('button', 'rx-mini', '✕'); x.title = 'Remove';
    x.onclick = () => { state.sel.delete(text); render(); };
    r.appendChild(x);
    return r;
  }

  const pickerIs = (mode, group) => state.picker && state.picker.mode === mode && (state.picker.group == null ? group == null : state.picker.group === group);

  // one selected-mods list (inc or exc) + its inline add-picker. The Wanted
  // list also hosts OR groups: mods inside a group merge into ONE search term
  // matching ANY of them; groups AND against everything else.
  function modList(mode, title, addLabel) {
    const box = el('div', 'rx-list' + (mode === 'exc' ? ' rx-list-exc' : ''));
    const head = el('div', 'rx-list-head');
    head.appendChild(el('span', 'rx-list-title', title));
    box.appendChild(head);

    const pool = poolFor(state.cls);
    const chosen = [...state.sel.entries()].filter(([, s]) => s.mode === mode);
    // standalone rows first
    for (const [text, s] of chosen.filter(([, s]) => s.group == null)) {
      const r = selRow(mode, text, s, pool);
      if (r) box.appendChild(r);
    }
    if (pickerIs(mode, null)) box.appendChild(pickerPanel(mode, null));
    else {
      const add = el('button', 'rx-ghost rx-add-mod', addLabel);
      if (!pool.length) { add.disabled = true; add.title = 'Mod pool for this item type is on its way'; }
      add.onclick = () => { state.picker = { mode, group: null }; state.pickerQuery = ''; render(); };
      box.appendChild(add);
    }

    // OR groups (Wanted only - exclusions are already one big OR by nature)
    if (mode === 'inc') {
      const groupIds = [...new Set(chosen.map(([, s]) => s.group).filter((g) => g != null))];
      for (const gid of groupIds) {
        const gbox = el('div', 'rx-orgroup');
        const ghead = el('div', 'rx-orgroup-head');
        ghead.appendChild(el('span', 'rx-orgroup-lab', 'Match ANY of'));
        ghead.appendChild(el('span', 'rx-flex'));
        const dissolve = el('button', 'rx-mini', '✕'); dissolve.title = 'Remove this OR group and its mods';
        dissolve.onclick = () => {
          for (const [text, s] of state.sel) if (s.group === gid) state.sel.delete(text);
          render();
        };
        ghead.appendChild(dissolve);
        gbox.appendChild(ghead);
        for (const [text, s] of chosen.filter(([, s]) => s.group === gid)) {
          const r = selRow(mode, text, s, pool);
          if (r) gbox.appendChild(r);
        }
        if (pickerIs('inc', gid)) gbox.appendChild(pickerPanel('inc', gid));
        else {
          const addOpt = el('button', 'rx-ghost rx-add-mod', '+ Add option');
          addOpt.onclick = () => { state.picker = { mode: 'inc', group: gid }; state.pickerQuery = ''; render(); };
          gbox.appendChild(addOpt);
        }
        box.appendChild(gbox);
      }
      const addGroup = el('button', 'rx-ghost rx-add-or', '+ Add OR group');
      addGroup.title = 'A set of mods where ANY one satisfies the search - "Rares OR Magic monsters"';
      if (!pool.length) addGroup.disabled = true;
      addGroup.onclick = () => {
        const gid = state.groupSeq++;
        state.picker = { mode: 'inc', group: gid };
        state.pickerQuery = '';
        render();
      };
      box.appendChild(addGroup);
      // a group being born (picker open on an id with no members yet) renders
      // its picker at the bottom via pickerIs above only if members exist -
      // handle the empty-new-group case explicitly
      if (state.picker && state.picker.mode === 'inc' && state.picker.group != null && !groupIds.includes(state.picker.group)) {
        const gbox = el('div', 'rx-orgroup');
        gbox.appendChild(el('div', 'rx-orgroup-head', '<span class="rx-orgroup-lab">Match ANY of</span>'));
        gbox.appendChild(pickerPanel('inc', state.picker.group));
        box.appendChild(gbox);
      }
    }
    return box;
  }

  // inline searchable picker; one pick closes it - adding another mod is an
  // explicit "+ Add mod" click again (multi-add-stays-open felt pushy).
  // group != null targets the pick into that OR group.
  function pickerPanel(mode, group) {
    const pool = poolFor(state.cls);
    const wrap = el('div', 'rx-picker');
    const row = el('div', 'rx-picker-row');
    const inp = el('input', 'rx-in rx-picker-in');
    inp.placeholder = 'Type to filter…'; inp.value = state.pickerQuery;
    inp.oninput = () => { state.pickerQuery = inp.value; render(); setTimeout(() => { const n = document.querySelector('.rx-picker-in'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0); };
    inp.onkeydown = (e) => { if (e.key === 'Escape') { state.picker = null; render(); } };
    row.appendChild(inp);
    const close = el('button', 'rx-mini', '✕'); close.title = 'Done';
    close.onclick = () => { state.picker = null; render(); };
    row.appendChild(close);
    wrap.appendChild(row);

    const q = state.pickerQuery.toLowerCase();
    // hidden entries (Item Level) stay in the pool so uniqueness is proven
    // against them, but aren't offered - they're derived tooltip noise
    let items = pool.filter((m) => !m.hidden && !state.sel.has(m.text) && (!q || m.text.toLowerCase().includes(q)));
    if (state.cls === 'tablet' && state.tabletType) {
      items = items.filter((m) =>
        m.group === 'Tablet type' ? m.type === state.tabletType
        : (!m.group || /^precursor tablet$/i.test(m.group) || m.group === state.tabletType));
    }
    const badFirst = (arr) => mode === 'exc' ? [...arr.filter((m) => m.bad), ...arr.filter((m) => !m.bad)] : arr;
    const list = el('div', 'rx-picker-list');
    if (!items.length) list.appendChild(el('div', 'rx-picker-none', q ? 'No mods match.' : 'Everything is already picked.'));
    const rangeStr = (m) => m.min != null && m.max != null ? (m.min === m.max ? String(m.max) : `${m.min}-${m.max}`) : m.max != null ? `up to ${m.max}` : '';
    const addItem = (m) => {
      const r = rangeStr(m);
      const it = el('div', 'rx-picker-item' + (m.bad ? ' rx-bad' : ''),
        esc(m.text) + (r ? `<span class="rx-range">${esc(r)}</span>` : ''));
      if (m.bad) it.title = 'Player-hostile mod - the kind you usually exclude';
      it.onclick = () => {
        state.sel.set(m.text, { mode, min: null, group: group == null ? null : group });
        state.pickerQuery = '';
        state.picker = null;
        render();
      };
      list.appendChild(it);
    };
    if (items.some((m) => m.group)) {
      // merged tablet pool: section headers reflect the real mechanics - the
      // generic Precursor pool rolls on EVERY tablet type; subtype pools are
      // additive-only ("Breach only" etc.)
      const gLabel = (g) => g === 'Tablet type' ? 'Tablet type (implicit)'
        : /^precursor tablet$/i.test(g) ? 'All tablets'
        : / tablet$/i.test(g) ? g.replace(/ ?Precursor ?/i, ' ').replace(/ ?Tablet$/i, '').trim() + ' only'
        : g; // waystone sections pass through as-is
      const order = [], byG = new Map();
      for (const m of items) { const g = gLabel(m.group || 'Other'); if (!byG.has(g)) { byG.set(g, []); order.push(g); } byG.get(g).push(m); }
      // implicits first, "X only" uniques next, the big generic pool last
      order.sort((a, b) => {
        const rank = (g) => g === 'Tablet type (implicit)' ? 0 : g === 'All tablets' ? 2 : 1;
        return rank(a) - rank(b);
      });
      let shown = 0;
      for (const g of order) {
        if (shown >= 80) break;
        list.appendChild(el('div', 'rx-picker-group', esc(g)));
        for (const m of badFirst(byG.get(g))) { if (shown++ >= 80) break; addItem(m); }
      }
    } else {
      for (const m of badFirst(items).slice(0, 80)) addItem(m);
    }
    wrap.appendChild(list);
    setTimeout(() => inp.focus(), 0);
    return wrap;
  }

  // ========================= sticky bottom bar ===============================
  // The pattern forms here LIVE as mods are picked (or as a custom regex is
  // typed): count, click-to-copy, and save-under-a-label into a bucket.
  function bottomBar() {
    const pattern = livePattern();
    const bar = el('div', 'rx-bar');
    if (!pattern) {
      bar.appendChild(el('div', 'rx-bar-empty', state.cls === 'custom'
        ? '<span class="gx-bar-arrow">↑</span> Type a regex above - it lands here to copy or save.'
        : '<span class="gx-bar-arrow">↑</span> Add mods above - your regex forms here.'));
      return bar;
    }
    const row = el('div', 'rx-bar-row');
    const box = el('input', 'rx-in rx-mono rx-bar-pattern');
    box.readOnly = true; box.value = pattern;
    box.title = 'Click to copy';
    row.appendChild(box);
    const count = el('span', 'rx-count' + (pattern.length > 250 ? ' rx-over' : ''), `${pattern.length}`);
    count.title = pattern.length > 250 ? 'Long - the in-game search box may cap length' : 'Characters';
    row.appendChild(count);
    const cpy = el('button', 'rx-btn', '⧉ Copy');
    const flashBtn = () => copyFlash(pattern, cpy,
      () => { cpy.textContent = '✓ Copied'; },
      () => { cpy.textContent = '⧉ Copy'; });
    box.onclick = () => { box.select(); flashBtn(); };
    cpy.onclick = flashBtn;
    row.appendChild(cpy);
    bar.appendChild(row);
    const saveRow = el('div', 'rx-bar-row');
    const lab = el('input', 'rx-in rx-save-label'); lab.placeholder = 'Label to save as, e.g. "high rarity, no slow"'; lab.value = state.saveLabel;
    lab.oninput = () => { state.saveLabel = lab.value; };
    lab.onkeydown = (e) => { if (e.key === 'Enter' && pattern) doSave(); };
    saveRow.appendChild(lab);
    if (state.buckets.length > 1) saveRow.appendChild(bucketSelect());
    const sv = el('button', 'rx-btn rx-btn-quiet', '+ Save');
    sv.title = state.buckets.length > 1 ? 'Save into the selected bucket' : `Saves into ${state.buckets[0] ? state.buckets[0].name : 'your bucket'}`;
    sv.onclick = doSave;
    saveRow.appendChild(sv);
    bar.appendChild(saveRow);
    function doSave() {
      saveEntry(state.saveLabel.trim(), pattern);
      state.saveLabel = '';
      if (state.cls === 'custom') state.customPattern = '';
      render();
    }
    return bar;
  }

  function bucketSelect() {
    const s = el('select', 'rx-in rx-bucket-sel');
    for (const b of state.buckets) {
      const op = el('option', null, esc(b.name)); op.value = b.id;
      if (b.id === state.saveBucket) op.selected = true;
      s.appendChild(op);
    }
    s.onchange = () => { state.saveBucket = s.value; };
    s.title = 'Bucket to save into';
    return s;
  }

  // ========================= Saved-regexes drawer ============================
  // Reuses the Grand Expedition drawer styling (gx-drawer-*) so the two tabs
  // share one visual grammar.
  function drawer() {
    if (!state.drawerOpen) return null;
    const wrap = el('div', 'gx-drawer-veil');
    wrap.onclick = (e) => { if (e.target === wrap) { state.drawerOpen = false; render(); } };
    const panel = el('div', 'gx-drawer');
    const head = el('div', 'gx-drawer-head');
    head.appendChild(el('span', 'gx-drawer-title', '🗂 Saved regexes'));
    head.appendChild(el('span', 'rx-flex'));
    const x = el('button', 'gx-mini gx-drawer-x', '✕');
    x.onclick = () => { state.drawerOpen = false; render(); };
    head.appendChild(x);
    panel.appendChild(head);
    const b = el('div', 'gx-drawer-body');
    for (const bucket of state.buckets) b.appendChild(bucketCard(bucket));
    const add = el('button', 'rx-ghost rx-add-bucket', '+ New bucket');
    add.onclick = () => {
      const nb = { id: newId(), name: `Bucket ${state.buckets.length + 1}`, entries: [] };
      state.buckets.push(nb);
      state.editBucket = nb.id;
      persist(); render();
    };
    b.appendChild(add);
    panel.appendChild(b);
    wrap.appendChild(panel);
    return wrap;
  }

  function bucketCard(b) {
    const card = el('div', 'rx-bucket');
    const head = el('div', 'rx-bucket-head');
    if (state.editBucket === b.id) {
      const inp = el('input', 'rx-bucket-name-edit'); inp.value = b.name;
      const done = () => { b.name = inp.value.trim() || b.name; state.editBucket = null; persist(); render(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { state.editBucket = null; render(); } };
      inp.onblur = done;
      head.appendChild(inp);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    } else {
      const name = el('span', 'rx-bucket-name', esc(b.name));
      name.title = 'Click to rename';
      name.onclick = () => { state.editBucket = b.id; render(); };
      head.appendChild(name);
    }
    head.appendChild(el('span', 'rx-flex'));
    const del = el('button', 'rx-x' + (state.confirmDel === b.id ? ' rx-confirm' : ''), state.confirmDel === b.id ? 'Delete?' : '✕');
    del.title = state.confirmDel === b.id ? 'Click again to delete this bucket and everything in it' : 'Delete bucket';
    del.onclick = () => {
      if (state.confirmDel !== b.id) { state.confirmDel = b.id; render(); return; }
      state.buckets = state.buckets.filter((x) => x.id !== b.id);
      if (!state.buckets.length) state.buckets = [{ id: 'default', name: 'My Regex', entries: [] }];
      if (state.saveBucket === b.id) state.saveBucket = state.buckets[0].id;
      state.confirmDel = null;
      persist(); render();
    };
    head.appendChild(del);
    card.appendChild(head);

    for (const e of b.entries) card.appendChild(entryRow(b, e));

    if (state.addingTo === b.id) card.appendChild(entryEditor(b, null));
    else {
      const add = el('button', 'rx-ghost rx-add-entry', '+ Add regex');
      add.title = 'Save a regex you already have - paste it in with a label';
      add.onclick = () => { state.addingTo = b.id; state.editEntry = null; render(); };
      card.appendChild(add);
    }
    return card;
  }

  // Label-first row: the player's words up front, the pattern behind them
  // (tooltip + edit). The whole row is the copy button; edit/delete only
  // surface on hover so resting rows stay quiet.
  function entryRow(b, e) {
    if (state.editEntry === e.id) return entryEditor(b, e);
    const row = el('div', 'rx-entry');
    row.title = e.pattern;
    row.appendChild(el('span', 'rx-entry-lab', esc(e.label)));
    const tools = el('span', 'rx-entry-tools');
    const edit = el('button', 'rx-mini', '✎'); edit.title = 'Edit';
    edit.onclick = (ev) => { ev.stopPropagation(); state.editEntry = e.id; state.addingTo = null; render(); };
    tools.appendChild(edit);
    const del = el('button', 'rx-mini', '✕'); del.title = 'Delete';
    del.onclick = (ev) => { ev.stopPropagation(); b.entries = b.entries.filter((x) => x.id !== e.id); persist(); render(); };
    tools.appendChild(del);
    row.appendChild(tools);
    const glyph = el('span', 'rx-copy-glyph', '⧉');
    row.appendChild(glyph);
    row.onclick = () => copyFlash(e.pattern, row,
      () => { row.classList.add('rx-flash'); glyph.classList.add('on'); glyph.textContent = 'Copied ✓'; },
      () => { row.classList.remove('rx-flash'); glyph.classList.remove('on'); glyph.textContent = '⧉'; });
    return row;
  }

  // shared inline editor: edit an existing entry (e) or add a new one (e=null)
  function entryEditor(b, e) {
    const row = el('div', 'rx-entry-edit');
    const lab = el('input', 'rx-in rx-edit-lab'); lab.placeholder = 'Label - what you’ll see in the list'; lab.value = e ? e.label : '';
    const pat = el('input', 'rx-in rx-mono rx-edit-pat'); pat.placeholder = 'Regex'; pat.value = e ? e.pattern : '';
    const close = () => { state.editEntry = null; state.addingTo = null; render(); };
    const done = () => {
      const label = lab.value.trim(), pattern = pat.value.trim();
      if (!pattern) { close(); return; }
      if (e) { e.label = label || 'Unnamed regex'; e.pattern = pattern; }
      else b.entries.push({ id: newId(), label: label || 'Unnamed regex', pattern });
      persist(); close();
    };
    const key = (ev) => { if (ev.key === 'Enter') done(); if (ev.key === 'Escape') close(); };
    lab.onkeydown = key; pat.onkeydown = key;
    const ok = el('button', 'rx-btn rx-btn-sm', e ? 'Save' : 'Add'); ok.onclick = done;
    const cancel = el('button', 'rx-mini rx-cancel', '✕'); cancel.title = 'Cancel'; cancel.onclick = close;
    row.appendChild(lab); row.appendChild(pat); row.appendChild(ok); row.appendChild(cancel);
    setTimeout(() => lab.focus(), 0);
    return row;
  }

  // custom textarea keeps focus AND caret position through the live re-render
  function keepCustomFocus(caret) {
    setTimeout(() => {
      const t = document.querySelector('.rx-custom-pattern');
      if (!t) return;
      const pos = caret == null ? t.value.length : Math.min(caret, t.value.length);
      t.focus(); t.setSelectionRange(pos, pos);
    }, 0);
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    const root = $('regex-root');
    if (!root || root.classList.contains('hidden')) return;
    const customHadFocus = !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('rx-custom-pattern'));
    root.innerHTML = '';
    const wrap = el('div', 'rx-wrap');
    if (state.notice) {
      const n = el('div', `rx-notice rx-${state.notice.kind}`, esc(state.notice.msg));
      n.onclick = () => { state.notice = null; render(); };
      wrap.appendChild(n);
    }
    wrap.appendChild(toolbar());
    wrap.appendChild(builderBody());
    wrap.appendChild(bottomBar());
    root.appendChild(wrap);
    const dw = drawer();
    if (dw) root.appendChild(dw);
    if (customHadFocus) keepCustomFocus();
  }

  window.RegexTab = { render, seedFromText };
})();
