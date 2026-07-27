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
  // respect the global "Show currency icons instead of names" toggle for the ex/div units
  const unit = (name, apiId) => {
    if (window.currencyIconsOn && window.currencyIconsOn() && window.currencyIconUrl) {
      const u = window.currencyIconUrl(apiId);
      if (u) return `<img class="nw-unit-ic" src="${u}" alt="${name}" title="${name}">`;
    }
    return name;
  };
  const fmtEx = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US') + ' ' + unit('ex', 'exalted');
  const fmtDiv = (n) => n == null ? null : (n >= 100 ? Math.round(n) : n.toFixed(1)).toLocaleString('en-US') + ' ' + unit('div', 'divine');
  const fmtCount = (n) => Number(n).toLocaleString('en-US');

  const state = { rows: [], expanded: {}, nextId: 1, dup: false, sortLayout: false, showMissing: false, showConfidence: false, calibrated: false, hotkey: 'F7', dragId: null, busy: false, phase: 'idle', pendingTab: null, notice: null, modal: null };
  const TAB_LABEL = { currency: 'Currency', abyss: 'Abyss', essence: 'Essence', runes: 'Runes', 'runes-kalguuran': 'Kalguuran Runes', ritual: 'Ritual', soulcore: 'Soul Cores', idol: 'Idols', 'ancient-augment': 'Ancient Augments', delirium: 'Delirium', breach: 'Breach', expedition: 'Expedition' };
  const MIRROR_ICON = 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lEdXBsaWNhdGUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/26bc31680e/CurrencyDuplicate.png';

  if (window.api && window.api.getConfig) window.api.getConfig().then((c) => { state.dup = !!(c && c.stashDupTabs); state.sortLayout = !!(c && c.stashSortLayout); state.showMissing = !!(c && c.stashShowMissing); state.showConfidence = !!(c && c.stashShowConfidence); state.calibrated = !!(c && c.stashCalibration); state.hotkey = (c && c.stashHotkey) || 'F7'; render(); }).catch(() => {});

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

  // effective per-line values, honouring manual count edits (userCount) + toggles (excluded)
  const effCount = (ln) => (ln.userCount != null ? ln.userCount : ln.count) || 0;
  const lineOn = (ln) => !ln.excluded;
  const lineVal = (ln) => (lineOn(ln) && ln.price != null) ? effCount(ln) * ln.price : 0;
  const rowTotalEx = (res) => (res.lines || []).reduce((s, ln) => s + lineVal(ln), 0);
  const rowEdited = (res) => (res.lines || []).some((ln) => ln.userCount != null);

  function grandTotals() {
    let ex = 0, divPrice = null, mirrorPrice = null, edited = false;
    for (const r of state.rows) {
      if (!r.included) continue;
      ex += rowTotalEx(r.result);
      if (rowEdited(r.result)) edited = true;
      if (r.result.divPrice) divPrice = r.result.divPrice;
      if (r.result.mirrorPrice) mirrorPrice = r.result.mirrorPrice;
    }
    return { ex, div: divPrice ? ex / divPrice : null, mirrors: mirrorPrice && ex >= mirrorPrice ? Math.floor(ex / mirrorPrice) : null, edited };
  }
  const anyEdits = () => state.rows.some((r) => (r.result.lines || []).some((ln) => ln.userCount != null || ln.excluded));

  // Net Worth settings live in the app Settings page (Settings -> Net Worth). This fills
  // that section with the toggles + calibration; the capture-hotkey field there is static
  // HTML bound in renderer.js. Called by renderer.js when the section opens.
  function renderSettings(root) {
    if (!root) return;
    root.innerHTML = '';
    // reuse the app's native switch component so it matches the rest of Settings
    const mkToggle = (checked, label, sub, apply) => {
      const lab = el('label', 'switch set-excl');
      const cbx = el('input'); cbx.type = 'checkbox'; cbx.checked = checked;
      cbx.onchange = () => { apply(cbx.checked); renderSettings(root); render(); };
      lab.appendChild(cbx);
      lab.appendChild(el('span', 'sw-track'));
      lab.appendChild(el('span', 'sw-lab', label));
      if (sub) lab.appendChild(el('span', 'set-sub', sub));
      return lab;
    };
    const toggles = el('div', 'nw-set-toggles');
    toggles.appendChild(mkToggle(state.dup, 'Capture duplicate tabs as separate rows',
      'Re-capturing a tab type asks whether to replace its row or add a new one.',
      (v) => { state.dup = v; try { window.api.setStashDupTabs(v); } catch {} }));
    toggles.appendChild(mkToggle(state.sortLayout, 'Sort items by stash layout',
      'List items in stash reading order instead of by value.',
      (v) => { state.sortLayout = v; try { window.api.setStashSortLayout(v); } catch {} }));
    toggles.appendChild(mkToggle(state.showMissing, 'Show missing / unread items',
      'List empty or unread slots as editable ×0 lines, so you can fill in anything the scan missed.',
      (v) => { state.showMissing = v; try { window.api.setStashShowMissing(v); } catch {} }));
    toggles.appendChild(mkToggle(state.showConfidence, 'Show OCR confidence %',
      'Show how sure the scan was of each count; low numbers are worth double-checking.',
      (v) => { state.showConfidence = v; try { window.api.setStashShowConfidence(v); } catch {} }));
    root.appendChild(toggles);
    // resolution calibration
    const cal = el('div', 'nw-set-cal');
    const head = el('div', 'nw-set-cal-head');
    head.appendChild(el('div', 'nw-set-cal-title', 'Resolution'));
    head.appendChild(el('div', 'nw-set-cal-badge' + (state.calibrated ? ' on' : ''), state.calibrated ? 'Calibrated' : 'Default 1920×1080'));
    cal.appendChild(head);
    cal.appendChild(el('div', 'nw-set-cal-desc', state.calibrated
      ? 'Reads are scaled to your window. If a scan ever mismatches its tab, re-calibrate.'
      : 'Assumes the game is fullscreen at 1920×1080. Any other size or a smaller window? Open a special tab, then calibrate once.'));
    const btns = el('div', 'nw-set-cal-btns');
    const calBtn = el('button', 'nw-set-btn', state.calibrated ? 'Re-calibrate' : 'Calibrate for my resolution');
    calBtn.onclick = () => { try { window.api.stashCalibrateStart(); } catch {} };
    btns.appendChild(calBtn);
    if (state.calibrated) {
      const clr = el('button', 'nw-set-btn nw-set-btn-ghost', 'Reset to default');
      clr.title = 'Remove calibration and go back to the default 1920×1080 assumption';
      clr.onclick = () => { try { window.api.clearStashCalibration(); } catch {} state.calibrated = false; renderSettings(root); render(); };
      btns.appendChild(clr);
    }
    cal.appendChild(btns);
    root.appendChild(cal);
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

    const rowEx = rowTotalEx(r);
    const tot = el('div', 'nw-card-total' + (rowEdited(r) ? ' nw-edited' : ''));
    tot.appendChild(el('span', 'nw-ex', fmtEx(rowEx)));
    if (r.divPrice) tot.appendChild(el('span', 'nw-div', fmtDiv(rowEx / r.divPrice)));
    head.appendChild(tot);
    head.onclick = (e) => { if (e.target === cb) return; state.expanded[row.id] = !open; render(); };

    // per-row remove
    const del = el('button', 'nw-del', '✕'); del.title = 'Remove this tab';
    del.onclick = (e) => { e.stopPropagation(); state.rows = state.rows.filter((x) => x !== row); render(); };
    head.appendChild(del);
    card.appendChild(head);
    if (!open) return card;

    const list = el('div', 'nw-lines');
    const byVal = (a, b) => (lineVal(b) - lineVal(a)) || ((b.count || 0) - (a.count || 0));
    const bySlot = (a, b) => (a.slot || 0) - (b.slot || 0);
    const all = r.lines.slice();
    const owned = all.filter((ln) => !ln.missing).sort(state.sortLayout ? bySlot : byVal);
    const missing = all.filter((ln) => ln.missing).sort(bySlot); // shown only with "Show missing", at the bottom
    const shown = state.showMissing ? owned.concat(missing) : owned;
    for (const ln of shown) {
      const line = el('div', 'nw-line'
        + (ln.userCount != null ? ' nw-line-edited' : '')
        + (ln.excluded ? ' nw-line-off' : '')
        + (ln.missing ? ' nw-line-missing' : ''));
      const tg = el('input', 'nw-line-inc'); tg.type = 'checkbox'; tg.checked = !ln.excluded; tg.title = 'Include in total';
      tg.onclick = (e) => { e.stopPropagation(); ln.excluded = !tg.checked; render(); };
      line.appendChild(tg);
      if (ln.icon) { const img = el('img', 'nw-ic'); img.src = ln.icon; img.onerror = () => img.remove(); line.appendChild(img); }
      else line.appendChild(el('div', 'nw-ic nw-ic-none'));
      line.appendChild(el('div', 'nw-name', esc(ln.name)));
      if (state.showConfidence && ln.conf != null) {
        const pct = Math.round(ln.conf * 100);
        const cl = pct >= 88 ? 'ok' : (pct >= 80 ? 'mid' : 'low');
        const cf = el('div', 'nw-conf nw-conf-' + cl, pct + '%');
        cf.title = 'OCR confidence - low numbers are worth double-checking';
        line.appendChild(cf);
      }
      const cnt = el('div', 'nw-cnt'); cnt.innerHTML = `<span class="nw-x">×</span>${esc(fmtCount(effCount(ln)))}`;
      cnt.title = 'Click to edit count';
      cnt.onclick = (e) => { e.stopPropagation(); startEdit(ln, cnt); };
      line.appendChild(cnt);
      line.appendChild(el('div', 'nw-val', ln.price == null ? '<span class="nw-noprice">no price</span>' : fmtEx(lineVal(ln))));
      const rb = el('button', 'nw-line-reset' + ((ln.userCount != null || ln.excluded) ? '' : ' nw-line-reset-off'), '↺');
      rb.title = 'Reset this line to its scanned value';
      rb.onclick = (e) => { e.stopPropagation(); ln.userCount = undefined; ln.excluded = false; render(); };
      line.appendChild(rb);
      list.appendChild(line);
    }
    card.appendChild(list);
    return card;
  }

  // click-to-edit a line's count; matching the original value clears the override
  function startEdit(ln, cntEl) {
    const inp = el('input', 'nw-cnt-edit');
    inp.type = 'text'; inp.inputMode = 'numeric'; inp.value = String(effCount(ln));
    cntEl.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const raw = String(inp.value).replace(/[^0-9]/g, '');
      const v = raw === '' ? 0 : parseInt(raw, 10);
      ln.userCount = (v === (ln.count || 0)) ? undefined : v;
      render();
    };
    inp.onblur = commit;
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { done = true; render(); } };
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
    const gline = el('div', 'nw-grand-val' + (rows && gt.edited ? ' nw-edited' : ''));
    gline.appendChild(el('span', 'nw-total-lab', 'Total'));
    gline.appendChild(el('span', 'nw-ex', fmtEx(rows ? gt.ex : null)));
    if (gt.div != null) gline.appendChild(el('span', 'nw-div', fmtDiv(gt.div)));
    if (rows && gt.mirrors != null) gline.appendChild(el('span', 'nw-mirror',
      `(${gt.mirrors.toLocaleString('en-US')}<img class="nw-mirror-ic" src="${MIRROR_ICON}" alt="mirror">)`));
    totBox.appendChild(gline);
    header.appendChild(totBox);
    const controls = el('div', 'nw-controls');
    if (state.busy) controls.appendChild(el('span', 'nw-scanning', 'Scanning…'));
    const gear = el('button', 'nw-gear', '⚙'); gear.title = `Net Worth settings (capture hotkey: ${state.hotkey})`;
    gear.onclick = () => { if (window.openNetWorthSettings) window.openNetWorthSettings(); };
    controls.appendChild(gear);
    header.appendChild(controls);
    wrap.appendChild(header);

    if (state.notice) wrap.appendChild(el('div', 'nw-notice nw-' + state.notice.kind, esc(state.notice.msg)));

    const pending = state.busy && state.phase === 'detecting' ? state.pendingTab : null;
    if (!rows && !state.busy) {
      wrap.appendChild(el('div', 'nw-empty',
        `Open a special stash tab in game, keep it fully visible, and press <b>${esc(state.hotkey)}</b> (or Capture).<br>`
        + 'It detects the tab, values it, and adds a row here plus a running grand total. Flip tabs and capture again.<br>'
        + '<span style="color:var(--tx-faint)">Not at 1920&times;1080 fullscreen? Open <b>&#x2699; settings</b> and calibrate once.</span>'));
    } else {
      for (const row of state.rows) wrap.appendChild(rowCard(row));
      if (state.busy) wrap.appendChild(busyCard(pending));
      if (rows) {
        const footer = el('div', 'nw-footer');
        const clear = el('button', 'nw-reset', 'Clear tally');
        clear.onclick = () => { state.rows = []; state.expanded = {}; state.notice = null; render(); };
        footer.appendChild(clear);
        if (anyEdits()) {
          const re = el('button', 'nw-reset nw-reset-edits', 'Reset all edits');
          re.title = 'Undo every manual count edit + row toggle across all tabs';
          re.onclick = () => { for (const r of state.rows) for (const ln of r.result.lines) { ln.userCount = undefined; ln.excluded = false; } render(); };
          footer.appendChild(re);
        }
        wrap.appendChild(footer);
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
    if (window.api.onStashCalibrated) window.api.onStashCalibrated((res) => {
      state.busy = false; state.phase = 'idle'; state.pendingTab = null; state.calibrated = true;
      const scale = res && typeof res.calScale === 'number' ? res.calScale : 1;
      const small = scale < 0.92;
      const smallMsg = small ? ` Your panel is ${Math.round(scale * 100)}% of reference size - below 1920×1080, so some counts may misread. Play at 1920×1080 or larger for reliable reads, and edit any that are off.` : '';
      if (res && res.ok && !res.mismatch) {
        applyResult(res);
        state.notice = { kind: small ? 'warn' : 'ok', msg: `Calibration saved ✓ - detected ${TAB_LABEL[res.tab] || res.tab}, read ${res.readCount}/${res.slotCount} items.${smallMsg}` };
      } else {
        state.notice = { kind: 'warn', msg: `Calibration saved ✓, but no tab was read. Open a special stash tab (fully visible), make sure your box covered the coloured bounding box, then re-calibrate or press ${state.hotkey}.${smallMsg}` };
      }
      render();
    });
  }

  window.NetWorth = { render, capture, renderSettings };
})();
