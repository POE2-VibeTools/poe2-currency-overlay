// Regex tab. Design premise: 95% of visits are "copy my saved regex while
// mapping" - so saved buckets LEAD (big 1-click rows, currency-tab DNA) and
// the builder is a focused compose card below: segmented item-type picker,
// explicit Wanted / Excluded lists with inline add-pickers, live output.
// The builder starts expanded only while nothing is saved yet.
// Pools: pools-data.js (window.RegexPools). Generation: regex-gen.js.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const state = {
    cls: 'waystone',        // 'waystone' | 'tablet' | 'custom'
    tabletType: null,       // null = all types; else a tablet base name - filters the PICKER only
    sel: new Map(),         // pool text -> {mode:'inc'|'exc', min:null|number}
    picker: null,           // 'inc' | 'exc' | null - which add-picker is open
    pickerQuery: '',
    buckets: [],            // [{id,name,entries:[{id,label,pattern}]}]
    builderOpen: false,     // collapsed by default once anything is saved
    builderTouched: false,  // user opened/closed it manually this session
    saveLabel: '',
    saveBucket: null,
    customLabel: '',
    customPattern: '',
    copiedId: null,         // entry id (or 'builder') flashing "Copied"
    confirmDel: null,       // bucket id in delete-confirm state
    editEntry: null,        // entry id in inline edit
    addingTo: null,         // bucket id with the inline "+ Add regex" form open
    editBucket: null,       // bucket id in rename
    notice: null,
  };
  let copyTimer = null;

  // ---- persistence ----------------------------------------------------------
  function persist() { try { window.api.setRegexBuckets(state.buckets); } catch {} }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const anySaved = () => state.buckets.some((b) => b.entries.length);

  if (window.api && window.api.getConfig) {
    window.api.getConfig().then((c) => {
      state.buckets = Array.isArray(c && c.regexBuckets) && c.regexBuckets.length
        ? c.regexBuckets
        : [{ id: 'default', name: 'My Regex', entries: [] }];
      state.saveBucket = state.buckets[0].id;
      state.builderOpen = !anySaved(); // first-run: composing is the only thing to do
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
      else includes.push({ mod, min: s.min });
    }
    if (!includes.length && !excludes.length) return '';
    try { return window.RegexGen.build(includes, excludes, pool); } catch { return ''; }
  }

  // ---- copy -----------------------------------------------------------------
  function copy(pattern, flashId) {
    if (!pattern) return;
    try { window.api.writeClipboard(pattern); } catch {}
    state.copiedId = flashId;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { state.copiedId = null; render(); }, 1200);
    if (window.logAction) window.logAction('regex-copy');
    render();
  }

  // ---- save into a bucket ---------------------------------------------------
  function saveEntry(label, pattern) {
    if (!pattern) return;
    const b = state.buckets.find((x) => x.id === state.saveBucket) || state.buckets[0];
    if (!b) return;
    b.entries.push({ id: newId(), label: label || 'Unnamed regex', pattern });
    persist();
    // the point of saving is the binder - collapse the builder unless the user
    // deliberately keeps it open, and confirm where it went
    if (!state.builderTouched) state.builderOpen = false;
    state.notice = { kind: 'ok', msg: `Saved to ${b.name}.` };
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
    state.builderOpen = true;
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
      ? { kind: 'ok', msg: `Read ${state.sel.size} mod${state.sel.size === 1 ? '' : 's'} from your item - adjust below, then copy or save.` }
      : { kind: 'warn', msg: 'Recognized the item but none of its lines are in the mod pool yet.' };
    render();
    return true;
  }

  // ============================ BINDER (top) =================================
  function binderPanel() {
    const wrap = el('div', 'rx-binder');
    if (!anySaved() && state.buckets.length === 1 && !state.buckets[0].entries.length) {
      // first-run: don't render a lonely empty card stack - one quiet line,
      // the builder below is already open
      const empty = el('div', 'rx-first-run', 'Saved regexes appear here - one click copies them while you play.');
      wrap.appendChild(empty);
      return wrap;
    }
    for (const b of state.buckets) wrap.appendChild(bucketCard(b));
    const add = el('button', 'rx-ghost rx-add-bucket', '+ New bucket');
    add.onclick = () => {
      const b = { id: newId(), name: `Bucket ${state.buckets.length + 1}`, entries: [] };
      state.buckets.push(b);
      state.editBucket = b.id;
      persist(); render();
    };
    wrap.appendChild(add);
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
    const row = el('div', 'rx-entry' + (state.copiedId === e.id ? ' rx-flash' : ''));
    row.title = e.pattern;
    row.onclick = () => copy(e.pattern, e.id);
    row.appendChild(el('span', 'rx-entry-lab', esc(e.label)));
    const tools = el('span', 'rx-entry-tools');
    const edit = el('button', 'rx-mini', '✎'); edit.title = 'Edit';
    edit.onclick = (ev) => { ev.stopPropagation(); state.editEntry = e.id; state.addingTo = null; render(); };
    tools.appendChild(edit);
    const del = el('button', 'rx-mini', '✕'); del.title = 'Delete';
    del.onclick = (ev) => { ev.stopPropagation(); b.entries = b.entries.filter((x) => x.id !== e.id); persist(); render(); };
    tools.appendChild(del);
    row.appendChild(tools);
    row.appendChild(el('span', 'rx-copy-glyph' + (state.copiedId === e.id ? ' on' : ''), state.copiedId === e.id ? 'Copied ✓' : '⧉'));
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

  // ============================ BUILDER (below) ==============================
  function builderSection() {
    if (!state.builderOpen) {
      const bar = el('button', 'rx-build-collapsed');
      bar.innerHTML = '<span class="rx-build-plus">+</span> Build a regex <span class="rx-build-sub">waystones &middot; tablets &middot; thresholds &middot; exclusions</span>';
      bar.onclick = () => { state.builderOpen = true; state.builderTouched = true; render(); };
      return bar;
    }
    const card = el('div', 'rx-card rx-builder');
    const head = el('div', 'rx-card-head');
    head.appendChild(el('span', 'rx-card-title', 'Build a regex'));
    head.appendChild(el('span', 'rx-flex'));
    const collapse = el('button', 'rx-mini', '⌃'); collapse.title = 'Collapse';
    collapse.onclick = () => { state.builderOpen = false; state.builderTouched = true; render(); };
    head.appendChild(collapse);
    card.appendChild(head);

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

    if (state.cls === 'custom') return customBody(card);

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

    card.appendChild(el('div', 'rx-tip', 'Tip: copy a waystone in game (Ctrl+C) and paste it here (Ctrl+V) to pre-fill everything.'));

    // Wanted / Excluded lists
    card.appendChild(modList('inc', 'Wanted mods', '+ Add mod'));
    card.appendChild(modList('exc', 'Excluded mods', '+ Add exclusion'));

    // output + actions
    const out = buildOutput();
    const outWrap = el('div', 'rx-out-wrap');
    const outRow = el('div', 'rx-out-row');
    const outBox = el('input', 'rx-in rx-mono rx-out' + (state.copiedId === 'builder' ? ' rx-flash' : '')); outBox.readOnly = true; outBox.value = out;
    outBox.placeholder = 'Your regex builds here';
    outBox.title = out ? 'Click to copy' : '';
    outBox.onclick = () => { if (out) { outBox.select(); copy(out, 'builder'); } };
    outRow.appendChild(outBox);
    if (out) {
      const count = el('span', 'rx-count' + (out.length > 250 ? ' rx-over' : ''), `${out.length}`);
      count.title = out.length > 250 ? 'Long - the in-game search box may cap length' : 'Characters';
      outRow.appendChild(count);
    }
    const cpy = el('button', 'rx-btn', state.copiedId === 'builder' ? 'Copied ✓' : 'Copy');
    cpy.disabled = !out;
    cpy.onclick = () => copy(out, 'builder');
    outRow.appendChild(cpy);
    outWrap.appendChild(outRow);

    const saveRow = el('div', 'rx-save-row');
    const lab = el('input', 'rx-in rx-save-label'); lab.placeholder = 'Label to save as, e.g. "high rarity, no slow"'; lab.value = state.saveLabel;
    lab.oninput = () => { state.saveLabel = lab.value; };
    lab.onkeydown = (e) => { if (e.key === 'Enter' && out) { saveEntry(state.saveLabel.trim(), out); state.saveLabel = ''; } };
    saveRow.appendChild(lab);
    if (state.buckets.length > 1) saveRow.appendChild(bucketSelect());
    const sv = el('button', 'rx-btn', 'Save');
    sv.disabled = !out;
    sv.title = state.buckets.length > 1 ? '' : `Saves into ${state.buckets[0] ? state.buckets[0].name : 'your bucket'}`;
    sv.onclick = () => { saveEntry(state.saveLabel.trim(), out); state.saveLabel = ''; };
    saveRow.appendChild(sv);
    outWrap.appendChild(saveRow);
    card.appendChild(outWrap);
    return card;
  }

  // one selected-mods list (inc or exc) + its inline add-picker
  function modList(mode, title, addLabel) {
    const box = el('div', 'rx-list' + (mode === 'exc' ? ' rx-list-exc' : ''));
    const head = el('div', 'rx-list-head');
    head.appendChild(el('span', 'rx-list-title', title));
    box.appendChild(head);

    const pool = poolFor(state.cls);
    const chosen = [...state.sel.entries()].filter(([, s]) => s.mode === mode);
    for (const [text, s] of chosen) {
      const mod = pool.find((m) => m.text === text);
      if (!mod) continue;
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
      box.appendChild(r);
    }

    if (state.picker === mode) box.appendChild(pickerPanel(mode));
    else {
      const add = el('button', 'rx-ghost rx-add-mod', addLabel);
      if (!pool.length) { add.disabled = true; add.title = 'Mod pool for this item type is on its way'; }
      add.onclick = () => { state.picker = mode; state.pickerQuery = ''; render(); };
      box.appendChild(add);
    }
    return box;
  }

  // inline searchable picker; stays open for multi-add, Esc/✕ closes
  function pickerPanel(mode) {
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
    // exclusion picker floats the player-hostile mods to the top - that's
    // what people exclude; wanted picker keeps props first, pool order after
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
        // one pick closes the picker - adding another mod is an explicit
        // "+ Add mod" click again (multi-add-stays-open felt pushy)
        state.sel.set(m.text, { mode, min: null });
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

  // custom mode body: label + raw pattern, straight into a bucket
  function customBody(card) {
    const lab = el('input', 'rx-in rx-save-label rx-block'); lab.placeholder = 'Label - what you’ll see in the list'; lab.value = state.customLabel;
    lab.oninput = () => { state.customLabel = lab.value; };
    card.appendChild(lab);
    const pat = el('textarea', 'rx-in rx-mono rx-custom-pattern'); pat.placeholder = 'Your regex, e.g. "rity: \\+(8[5-9]|9[0-9])"'; pat.value = state.customPattern;
    pat.oninput = () => { state.customPattern = pat.value; };
    card.appendChild(pat);
    const row = el('div', 'rx-save-row');
    row.appendChild(el('span', 'rx-flex'));
    if (state.buckets.length > 1) row.appendChild(bucketSelect());
    const sv = el('button', 'rx-btn', 'Save');
    sv.onclick = () => {
      if (!state.customPattern.trim()) return;
      saveEntry(state.customLabel.trim(), state.customPattern.trim());
      state.customLabel = ''; state.customPattern = '';
      render();
    };
    row.appendChild(sv);
    card.appendChild(row);
    return card;
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

  // ---- render ---------------------------------------------------------------
  function render() {
    const root = $('regex-root');
    if (!root || root.classList.contains('hidden')) return;
    root.innerHTML = '';
    const wrap = el('div', 'rx-wrap');
    if (state.notice) {
      const n = el('div', `rx-notice rx-${state.notice.kind}`, esc(state.notice.msg));
      n.onclick = () => { state.notice = null; render(); };
      wrap.appendChild(n);
    }
    wrap.appendChild(binderPanel());
    wrap.appendChild(builderSection());
    root.appendChild(wrap);
  }

  window.RegexTab = { render, seedFromText };
})();
