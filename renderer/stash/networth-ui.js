// Net Worth panel: capture special stash tabs (screen-OCR in main), value them via
// the live catalog, keep a running tally. Rows are tab INSTANCES: with the
// "duplicate tabs" setting on, re-capturing a type asks replace-which / add-new,
// so streamers can track multiple same-type tabs and include/exclude each.
// Reading lives in main (staged ipc events); this module renders + tallies.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtEx = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US') + ' ex';
  const fmtDiv = (n) => n == null ? null : (n >= 100 ? Math.round(n) : n.toFixed(1)).toLocaleString('en-US') + ' div';
  const fmtCount = (n) => Number(n).toLocaleString('en-US');

  const state = { rows: [], expanded: {}, nextId: 1, dup: false, sortLayout: false, dragId: null, busy: false, phase: 'idle', pendingTab: null, notice: null, modal: null };
  const TAB_LABEL = { currency: 'Currency', abyss: 'Abyss', essence: 'Essence', runes: 'Runes', 'runes-kalguuran': 'Kalguuran Runes', ritual: 'Ritual', soulcore: 'Soul Cores' };

  if (window.api && window.api.getConfig) window.api.getConfig().then((c) => { state.dup = !!(c && c.stashDupTabs); state.sortLayout = !!(c && c.stashSortLayout); render(); }).catch(() => {});

  const rowsOfType = (tab) => state.rows.filter((r) => r.tab === tab);
  function labelFor(row) {
    const same = rowsOfType(row.tab);
    const base = TAB_LABEL[row.tab] || row.tab;
    return same.length <= 1 ? base : `${base} #${same.indexOf(row) + 1}`;
  }
  function addRow(res) { const row = { id: state.nextId++, tab: res.tab, result: res, included: true }; state.rows.push(row); state.expanded[row.id] = false; return row; }
  function reorderRow(dragId, targetId, before) {
    const from = state.rows.findIndex((r) => r.id === dragId);
    if (from < 0) return;
    const [moved] = state.rows.splice(from, 1);
    let ti = state.rows.findIndex((r) => r.id === targetId);
    if (ti < 0) { state.rows.push(moved); return; }
    if (!before) ti++;
    state.rows.splice(ti, 0, moved);
  }

  function capture() {
    if (state.busy) return;
    state.notice = null;
    try { window.api.stashCaptureStart(); } catch (e) { state.notice = { kind: 'err', msg: 'Capture unavailable.' }; render(); }
  }

  // Fold a capture result into the tally. Dedup-by-type unless the duplicate
  // setting is on, in which case ask what to do when the type already exists.
  function applyResult(res) {
    if (!res || !res.ok) { state.notice = { kind: 'err', msg: `Capture failed: ${res && res.error || 'unknown error'}` }; return render(); }
    if (res.mismatch) { state.notice = { kind: 'warn', msg: `Couldn't recognize this tab (${res.readCount || 0} slots read). Supported: ${Object.values(TAB_LABEL).join(', ')}. Make sure a supported tab is open and fully visible, then capture again.` }; return render(); }
    state.notice = null;
    const existing = rowsOfType(res.tab);
    if (!existing.length) { addRow(res); return render(); }
    if (!state.dup) { existing[0].result = res; return render(); } // single row per type: update it
    state.modal = { res, existing };                               // duplicates on: ask
    render();
  }

  function grandTotals() {
    let ex = 0, divPrice = null;
    for (const r of state.rows) { if (!r.included) continue; ex += r.result.totalEx || 0; if (r.result.divPrice) divPrice = r.result.divPrice; }
    return { ex, div: divPrice ? ex / divPrice : null };
  }

  function rowCard(row) {
    const r = row.result;
    const open = !!state.expanded[row.id];
    const card = el('div', 'nw-card' + (open ? ' nw-open' : '') + (row.included ? '' : ' nw-excluded'));

    const head = el('div', 'nw-card-head');

    const grip = el('div', 'nw-grip', '⠿'); grip.title = 'Drag to reorder'; grip.draggable = true;
    grip.onclick = (e) => e.stopPropagation();
    grip.ondragstart = (e) => { state.dragId = row.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(row.id)); } catch {} };
    grip.ondragend = () => { state.dragId = null; render(); };
    head.appendChild(grip);
    card.ondragover = (e) => { if (state.dragId == null || state.dragId === row.id) return; e.preventDefault(); card.classList.add('nw-drop'); };
    card.ondragleave = () => card.classList.remove('nw-drop');
    card.ondrop = (e) => {
      if (state.dragId == null) return; e.preventDefault();
      const rect = card.getBoundingClientRect();
      reorderRow(state.dragId, row.id, e.clientY < rect.top + rect.height / 2);
      state.dragId = null; render();
    };

    const cb = el('input', 'nw-inc'); cb.type = 'checkbox'; cb.checked = row.included; cb.title = 'Include in total';
    cb.onclick = (e) => { e.stopPropagation(); row.included = cb.checked; render(); };
    head.appendChild(cb);

    const title = el('div', 'nw-card-title');
    title.appendChild(el('span', 'nw-chev', open ? '▾' : '▸'));
    title.appendChild(document.createTextNode(labelFor(row)));
    head.appendChild(title);

    const tot = el('div', 'nw-card-total');
    tot.appendChild(el('span', 'nw-ex', fmtEx(r.totalEx)));
    if (r.totalDiv != null) tot.appendChild(el('span', 'nw-div', fmtDiv(r.totalDiv)));
    head.appendChild(tot);
    head.onclick = (e) => { if (e.target === cb) return; state.expanded[row.id] = !open; render(); };

    // per-row remove
    const del = el('button', 'nw-del', '✕'); del.title = 'Remove this tab';
    del.onclick = (e) => { e.stopPropagation(); state.rows = state.rows.filter((x) => x !== row); render(); };
    head.appendChild(del);
    card.appendChild(head);
    if (!open) return card;

    const list = el('div', 'nw-lines');
    const ordered = r.lines.slice().sort(state.sortLayout
      ? (a, b) => (a.slot || 0) - (b.slot || 0)          // stash reading order
      : (a, b) => (b.valueEx || 0) - (a.valueEx || 0));   // value, highest first
    for (const ln of ordered) {
      if (!ln.count) continue;
      const line = el('div', 'nw-line');
      if (ln.icon) { const img = el('img', 'nw-ic'); img.src = ln.icon; img.onerror = () => img.remove(); line.appendChild(img); }
      else line.appendChild(el('div', 'nw-ic nw-ic-none'));
      line.appendChild(el('div', 'nw-name', esc(ln.name)));
      line.appendChild(el('div', 'nw-cnt', '×' + fmtCount(ln.count)));
      line.appendChild(el('div', 'nw-val', ln.valueEx == null ? '<span class="nw-noprice">no price</span>' : fmtEx(ln.valueEx)));
      list.appendChild(line);
    }
    card.appendChild(list);
    if (r.flags && r.flags.length) {
      const names = r.flags.map((f) => esc(f.name)).join(', ');
      card.appendChild(el('div', 'nw-flags', `${r.flags.length} slot${r.flags.length === 1 ? '' : 's'} empty or unread (not counted): ${names}`));
    }
    return card;
  }

  function busyCard(tabId) {
    const card = el('div', 'nw-card nw-busy');
    const head = el('div', 'nw-card-head');
    head.appendChild(el('div', 'nw-card-title', tabId ? esc(TAB_LABEL[tabId] || tabId) : 'Scanning…'));
    const st = el('div', 'nw-card-total');
    st.appendChild(el('span', 'nw-spin'));
    st.appendChild(el('span', 'nw-busy-lab', tabId ? 'Calculating…' : 'Detecting tab…'));
    head.appendChild(st);
    card.appendChild(head);
    return card;
  }

  // replace-which / add-new modal (duplicates setting on, type already captured)
  function modalEl() {
    const m = state.modal;
    const back = el('div', 'nw-modal-back');
    const box = el('div', 'nw-modal');
    box.appendChild(el('div', 'nw-modal-title', `You captured a ${esc(TAB_LABEL[m.res.tab] || m.res.tab)} tab`));
    box.appendChild(el('div', 'nw-modal-sub', 'Replace one you already have, or add it as a new row?'));
    for (const row of m.existing) {
      const b = el('button', 'nw-modal-opt');
      b.innerHTML = `Replace <b>${esc(labelFor(row))}</b> <span class="nw-modal-tot">${fmtEx(row.result.totalEx)}</span>`;
      b.onclick = () => { row.result = m.res; state.modal = null; render(); };
      box.appendChild(b);
    }
    const addB = el('button', 'nw-modal-opt nw-modal-new', '+ Add as new row');
    addB.onclick = () => { addRow(m.res); state.modal = null; render(); };
    box.appendChild(addB);
    const cancel = el('button', 'nw-modal-cancel', 'Cancel');
    cancel.onclick = () => { state.modal = null; render(); };
    box.appendChild(cancel);
    back.appendChild(box);
    back.onclick = (e) => { if (e.target === back) { state.modal = null; render(); } };
    return back;
  }

  function render() {
    const root = $('networth-root'); if (!root) return;
    root.innerHTML = '';
    const wrap = el('div', 'nw');

    const gt = grandTotals();
    const rows = state.rows.length;
    const included = state.rows.filter((r) => r.included).length;
    const header = el('div', 'nw-header');
    const totBox = el('div', 'nw-grand');
    totBox.appendChild(el('div', 'nw-grand-lab', rows ? `${included}/${rows} tab${rows === 1 ? '' : 's'} included` : 'No tabs captured'));
    const gline = el('div', 'nw-grand-val');
    gline.appendChild(el('span', 'nw-total-lab', 'Total'));
    gline.appendChild(el('span', 'nw-ex', fmtEx(rows ? gt.ex : null)));
    if (gt.div != null) gline.appendChild(el('span', 'nw-div', fmtDiv(gt.div)));
    totBox.appendChild(gline);
    header.appendChild(totBox);
    const btn = el('button', 'nw-capture', state.busy ? 'Capturing…' : 'Capture tab (F7)');
    btn.disabled = state.busy; btn.onclick = capture;
    header.appendChild(btn);
    wrap.appendChild(header);

    // Net Worth setting: allow duplicate same-type tabs as separate rows
    const setline = el('label', 'nw-setting');
    const dcb = el('input'); dcb.type = 'checkbox'; dcb.checked = state.dup;
    dcb.onchange = () => { state.dup = dcb.checked; try { window.api.setStashDupTabs(state.dup); } catch {} render(); };
    setline.appendChild(dcb);
    setline.appendChild(el('span', null, 'Capture duplicate tabs as separate rows'));
    setline.title = 'On: re-capturing a tab type you already have asks whether to replace an existing row or add a new one - for owning multiple of the same tab. Off: re-capturing just updates the one row.';
    wrap.appendChild(setline);

    // Net Worth setting: item sort order within each tab's list
    const sortline = el('label', 'nw-setting');
    const scb = el('input'); scb.type = 'checkbox'; scb.checked = state.sortLayout;
    scb.onchange = () => { state.sortLayout = scb.checked; try { window.api.setStashSortLayout(state.sortLayout); } catch {} render(); };
    sortline.appendChild(scb);
    sortline.appendChild(el('span', null, 'Sort items by stash layout'));
    sortline.title = 'On: list items in stash reading order (left to right, top to bottom). Off: list by value, highest first.';
    wrap.appendChild(sortline);

    if (state.notice) wrap.appendChild(el('div', 'nw-notice nw-' + state.notice.kind, esc(state.notice.msg)));

    const pending = state.busy && state.phase === 'detecting' ? state.pendingTab : null;
    if (!rows && !state.busy) {
      wrap.appendChild(el('div', 'nw-empty',
        'Open a special stash tab in game, keep it fully visible, and press <b>F7</b> (or the Capture button).<br>'
        + 'The tab is detected automatically and added here with its own total, plus a running grand total. '
        + 'Flip to the next tab, press F7 again.<br>'
        + '<span style="color:var(--tx-faint)">Currency & Abyss tabs supported now; more coming.</span>'));
    } else {
      for (const row of state.rows) wrap.appendChild(rowCard(row));
      if (state.busy) wrap.appendChild(busyCard(pending));
      if (rows) {
        const reset = el('button', 'nw-reset', 'Clear tally');
        reset.onclick = () => { state.rows = []; state.expanded = {}; state.notice = null; render(); };
        wrap.appendChild(reset);
      }
    }
    root.appendChild(wrap);
    if (state.modal) root.appendChild(modalEl());
  }

  // staged events from main drive live feedback (works even while hidden)
  if (window.api) {
    if (window.api.onStashCapturing) window.api.onStashCapturing(() => { state.busy = true; state.phase = 'scanning'; state.pendingTab = null; state.notice = null; render(); });
    if (window.api.onStashDetected) window.api.onStashDetected((tab) => { state.busy = true; state.phase = 'detecting'; state.pendingTab = tab; render(); });
    if (window.api.onStashCaptured) window.api.onStashCaptured((res) => { state.busy = false; state.phase = 'idle'; state.pendingTab = null; applyResult(res); });
  }

  window.NetWorth = { render, capture };
})();
