// Net Worth panel: capture currency tabs (screen-OCR in main), value them via
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
  const fmtEx = (n) => n == null ? t('networth.value.none') : Math.round(n).toLocaleString('en-US') + ' ' + unit(t('networth.unit.ex_label'), 'exalted');
  const fmtDiv = (n) => n == null ? null : (n >= 100 ? Math.round(n) : n.toFixed(1)).toLocaleString('en-US') + ' ' + unit(t('networth.unit.div_label'), 'divine');
  const fmtCount = (n) => Number(n).toLocaleString('en-US');

  const state = { rows: [], expanded: {}, nextId: 1, dup: false, sortLayout: false, showMissing: false, showConfidence: false, calibrated: false, hotkey: 'F7', dragId: null, busy: false, phase: 'idle', pendingTab: null, notice: null, modal: null };
  const TAB_LABEL = { currency: t('networth.tab.currency'), abyss: t('networth.tab.abyss'), essence: t('networth.tab.essence'), runes: t('networth.tab.runes'), 'runes-kalguuran': t('networth.tab.runes_kalguuran'), ritual: t('networth.tab.ritual'), soulcore: t('networth.tab.soulcore'), idol: t('networth.tab.idol'), 'ancient-augment': t('networth.tab.ancient_augment'), delirium: t('networth.tab.delirium'), breach: t('networth.tab.breach'), expedition: t('networth.tab.expedition') };
  const MIRROR_ICON = 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lEdXBsaWNhdGUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/26bc31680e/CurrencyDuplicate.png';

  if (window.api && window.api.getConfig) window.api.getConfig().then((c) => { state.dup = !!(c && c.stashDupTabs); state.sortLayout = !!(c && c.stashSortLayout); state.showMissing = !!(c && c.stashShowMissing); state.showConfidence = !!(c && c.stashShowConfidence); state.calibrated = !!(c && c.stashCalibration); state.hotkey = (c && c.stashHotkey) || 'F7'; render(); }).catch(() => {});

  const rowsOfType = (tab) => state.rows.filter((r) => r.tab === tab);
  function labelFor(row) {
    const same = rowsOfType(row.tab);
    const base = TAB_LABEL[row.tab] || row.tab;
    return same.length <= 1 ? base : t('networth.row.label_with_index', { tabName: base, index: same.indexOf(row) + 1 });
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
    try { window.api.stashCaptureStart(); } catch (e) { state.notice = { kind: 'err', msg: t('networth.notice.capture_unavailable') }; render(); }
  }

  // Fold a capture result into the tally. Dedup-by-type unless the duplicate
  // setting is on, in which case ask what to do when the type already exists.
  function applyResult(res) {
    // remembered so Settings can offer manual calibration only once auto-detection
    // has actually come up empty
    if (res && typeof res.autoFound === 'boolean') state.autoFound = res.autoFound;
    if (!res || !res.ok) { state.notice = { kind: 'err', msg: t('networth.notice.capture_failed', { error: res && res.error || 'unknown error' }) }; return render(); }
    if (res.mismatch) { state.notice = { kind: 'warn', msg: t('networth.notice.mismatch', { readCount: res.readCount || 0, supportedTabs: Object.values(TAB_LABEL).join(', ') }) }; return render(); }
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
    toggles.appendChild(mkToggle(state.dup, t('networth.settings.toggle_dup_label'),
      t('networth.settings.toggle_dup_sub'),
      (v) => { state.dup = v; try { window.api.setStashDupTabs(v); } catch {} }));
    toggles.appendChild(mkToggle(state.sortLayout, t('networth.settings.toggle_sort_label'),
      t('networth.settings.toggle_sort_sub'),
      (v) => { state.sortLayout = v; try { window.api.setStashSortLayout(v); } catch {} }));
    toggles.appendChild(mkToggle(state.showMissing, t('networth.settings.toggle_missing_label'),
      t('networth.settings.toggle_missing_sub'),
      (v) => { state.showMissing = v; try { window.api.setStashShowMissing(v); } catch {} }));
    toggles.appendChild(mkToggle(state.showConfidence, t('networth.settings.toggle_confidence_label'),
      t('networth.settings.toggle_confidence_sub'),
      (v) => { state.showConfidence = v; try { window.api.setStashShowConfidence(v); } catch {} }));
    root.appendChild(toggles);
    // Resolution calibration is a FALLBACK now, not a step. The panel is found by its
    // coloured border on every capture, so this block stays hidden until auto-detection
    // has actually failed - a permanent orange "Calibrate for my resolution" button reads
    // as required, and a Linux user sat clicking it because of that. If you have never
    // seen a failure there is nothing here to press, which is the honest state.
    if (state.autoFound !== false && !state.calibrated) return;
    // resolution calibration
    const cal = el('div', 'nw-set-cal');
    const head = el('div', 'nw-set-cal-head');
    head.appendChild(el('div', 'nw-set-cal-title', t('networth.settings.cal_title')));
    head.appendChild(el('div', 'nw-set-cal-badge' + (state.calibrated ? ' on' : ''), state.calibrated ? t('networth.settings.cal_badge_calibrated') : t('networth.settings.cal_badge_default')));
    cal.appendChild(head);
    cal.appendChild(el('div', 'nw-set-cal-desc', state.calibrated
      ? t('networth.settings.cal_desc_calibrated')
      : t('networth.settings.cal_desc_default')));
    const btns = el('div', 'nw-set-cal-btns');
    const calBtn = el('button', 'nw-set-btn', state.calibrated ? t('networth.settings.cal_button_recalibrate') : t('networth.settings.cal_button_calibrate'));
    calBtn.onclick = () => { try { window.api.stashCalibrateStart(); } catch {} };
    btns.appendChild(calBtn);
    if (state.calibrated) {
      const clr = el('button', 'nw-set-btn nw-set-btn-ghost', t('networth.settings.cal_reset_button'));
      clr.title = t('networth.settings.cal_reset_title');
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

    const grip = el('div', 'nw-grip', '⠿'); grip.title = t('networth.row.drag_title'); grip.draggable = true;
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

    const cb = el('input', 'nw-inc'); cb.type = 'checkbox'; cb.checked = row.included; cb.title = t('networth.row.include_title');
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
    const del = el('button', 'nw-del', '✕'); del.title = t('networth.row.remove_title');
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
      // Rows our own testing says to distrust are marked, so a wrong number is visible
      // rather than silently averaged into the total. `rel` is measured per slot against
      // every ground-truthed capture we hold; a user edit clears the flag, because once
      // they have typed the real number there is nothing left to doubt.
      const relFlag = ln.userCount == null ? (ln.rel || null) : null;
      const line = el('div', 'nw-line'
        + (ln.userCount != null ? ' nw-line-edited' : '')
        + (ln.excluded ? ' nw-line-off' : '')
        + (ln.missing ? ' nw-line-missing' : '')
        + (relFlag ? ' nw-line-rel-' + relFlag : ''));
      if (relFlag) {
        line.title = relFlag === 'low'
          ? t('networth.line.unreliable_low')
          : t('networth.line.unreliable_mixed');
      }
      const tg = el('input', 'nw-line-inc'); tg.type = 'checkbox'; tg.checked = !ln.excluded; tg.title = t('networth.row.include_title');
      tg.onclick = (e) => { e.stopPropagation(); ln.excluded = !tg.checked; render(); };
      line.appendChild(tg);
      if (ln.icon) { const img = el('img', 'nw-ic'); img.src = ln.icon; img.onerror = () => img.remove(); line.appendChild(img); }
      else line.appendChild(el('div', 'nw-ic nw-ic-none'));
      line.appendChild(el('div', 'nw-name', esc(window.gameName(ln.name)))); // feed is English; show the client's own name
      if (state.showConfidence && ln.conf != null) {
        const pct = Math.round(ln.conf * 100);
        const cl = pct >= 88 ? 'ok' : (pct >= 80 ? 'mid' : 'low');
        const cf = el('div', 'nw-conf nw-conf-' + cl, pct + '%');
        cf.title = t('networth.line.confidence_title');
        line.appendChild(cf);
      }
      const cnt = el('div', 'nw-cnt'); cnt.innerHTML = `<span class="nw-x">×</span>${esc(fmtCount(effCount(ln)))}`;
      cnt.title = t('networth.line.edit_count_title');
      cnt.onclick = (e) => { e.stopPropagation(); startEdit(ln, cnt); };
      line.appendChild(cnt);
      line.appendChild(el('div', 'nw-val', ln.price == null ? t('networth.line.no_price') : fmtEx(lineVal(ln))));
      const rb = el('button', 'nw-line-reset' + ((ln.userCount != null || ln.excluded) ? '' : ' nw-line-reset-off'), '↺');
      rb.title = t('networth.line.reset_title');
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
    head.appendChild(el('div', 'nw-card-title', tabId ? esc(TAB_LABEL[tabId] || tabId) : t('networth.status.scanning')));
    const st = el('div', 'nw-card-total');
    st.appendChild(el('span', 'nw-spin'));
    st.appendChild(el('span', 'nw-busy-lab', tabId ? t('networth.status.calculating') : t('networth.status.detecting_tab')));
    head.appendChild(st);
    card.appendChild(head);
    return card;
  }

  // replace-which / add-new modal (duplicates setting on, type already captured)
  function modalEl() {
    const m = state.modal;
    const back = el('div', 'nw-modal-back');
    const box = el('div', 'nw-modal');
    box.appendChild(el('div', 'nw-modal-title', t('networth.modal.title', { tabName: esc(TAB_LABEL[m.res.tab] || m.res.tab) })));
    box.appendChild(el('div', 'nw-modal-sub', t('networth.modal.subtitle')));
    for (const row of m.existing) {
      const b = el('button', 'nw-modal-opt');
      b.innerHTML = t('networth.modal.replace_option', { rowLabel: esc(labelFor(row)), amount: fmtEx(row.result.totalEx) });
      b.onclick = () => { row.result = m.res; state.modal = null; render(); };
      box.appendChild(b);
    }
    const addB = el('button', 'nw-modal-opt nw-modal-new', t('networth.modal.add_new'));
    addB.onclick = () => { addRow(m.res); state.modal = null; render(); };
    box.appendChild(addB);
    const cancel = el('button', 'nw-modal-cancel', t('networth.modal.cancel'));
    cancel.onclick = () => { state.modal = null; render(); };
    box.appendChild(cancel);
    back.appendChild(box);
    back.onclick = (e) => { if (e.target === back) { state.modal = null; render(); } };
    return back;
  }

  // ---------- community screenshot submission ----------
  // The reader is tuned against one screenshot and misreads other setups. Rather than
  // pretend otherwise, the tab says so and offers a way to send the captures that would
  // let it be fixed. Guided: currency tab first (most numbers = most useful), then any
  // two more. Nothing leaves the machine until the user sees it and presses send.
  const SAMPLE_MAX = 3;
  function sampleStep() { return state.sample ? state.sample.shots.length : 0; }

  function sampleModalEl() {
    const s = state.sample;
    const back = el('div', 'nw-modal-back');
    const box = el('div', 'nw-modal nw-sample-modal');
    const step = s.shots.length;

    box.appendChild(el('div', 'nw-modal-title', t('networth.sample.title')));
    if (s.sending) {
      box.appendChild(el('div', 'nw-modal-sub', t('networth.sample.sending')));
      back.appendChild(box); return back;
    }
    if (s.done) {
      box.appendChild(el('div', 'nw-modal-sub', tn('networth.sample.thanks', s.done, { count: s.done })));
      const ok = el('button', 'nw-modal-opt nw-modal-new', t('networth.sample.close'));
      ok.onclick = () => { state.sample = null; render(); };
      box.appendChild(ok);
      back.appendChild(box); return back;
    }

    box.appendChild(el('div', 'nw-modal-sub', step === 0
      ? t('networth.sample.step_currency')
      : t('networth.sample.step_more', { n: step, max: SAMPLE_MAX })));

    if (s.error) box.appendChild(el('div', 'nw-notice nw-error', esc(s.error)));

    if (s.shots.length) {
      const strip = el('div', 'nw-sample-strip');
      s.shots.forEach((shot, i) => {
        const cell = el('div', 'nw-sample-thumb');
        const im = document.createElement('img');
        im.src = shot.dataUrl; im.alt = '';
        cell.appendChild(im);
        const cap = el('div', 'nw-sample-cap',
          esc(shot.meta && shot.meta.read && shot.meta.read.tab ? (TAB_LABEL[shot.meta.read.tab] || shot.meta.read.tab) : t('networth.sample.unknown_tab')));
        cell.appendChild(cap);
        const x = el('button', 'nw-sample-drop', '✕');
        x.title = t('networth.sample.remove');
        x.onclick = async () => {
          await window.api.stashSampleDrop(i);
          s.shots.splice(i, 1); render();
        };
        cell.appendChild(x);
        strip.appendChild(cell);
      });
      box.appendChild(strip);
      box.appendChild(el('div', 'nw-sample-note', t('networth.sample.preview_note')));
    }

    if (s.shots.length < SAMPLE_MAX) {
      const cap = el('button', 'nw-modal-opt', s.shots.length === 0
        ? t('networth.sample.capture_first') : t('networth.sample.capture_more'));
      cap.onclick = async () => {
        s.error = null; s.capturing = true; render();
        const r = await window.api.stashSampleCapture();
        s.capturing = false;
        if (!r || !r.ok) s.error = t('networth.sample.capture_failed', { error: esc((r && r.error) || '?') });
        else s.shots.push({ dataUrl: r.dataUrl, meta: r.meta });
        render();
      };
      box.appendChild(cap);
    }

    if (s.shots.length) {
      const send = el('button', 'nw-modal-opt nw-modal-new', tn('networth.sample.send', s.shots.length, { count: s.shots.length }));
      send.onclick = async () => {
        s.sending = true; render();
        const r = await window.api.stashSampleSend({ note: '' });
        s.sending = false;
        if (r && r.ok) { s.done = r.sent; s.shots = []; }
        else s.error = t('networth.sample.send_failed', { error: esc((r && r.error) || '?') });
        render();
      };
      box.appendChild(send);
    }

    const cancel = el('button', 'nw-modal-cancel', t('networth.modal.cancel'));
    cancel.onclick = async () => { await window.api.stashSampleReset(); state.sample = null; render(); };
    box.appendChild(cancel);
    back.appendChild(box);
    back.onclick = (e) => { if (e.target === back) { cancel.onclick(); } };
    return back;
  }

  // Tiny legend for the row tints. Only rendered when a captured tab actually contains
  // flagged rows - a key to symbols that are not on screen is just clutter. Deliberately
  // small and quiet: it explains a subtle cue, it should not out-shout the numbers.
  function reliabilityLegend() {
    const anyLow = state.rows.some((r) => (r.result.lines || []).some((ln) => ln.rel === 'low' && ln.userCount == null));
    const anyMixed = state.rows.some((r) => (r.result.lines || []).some((ln) => ln.rel === 'mixed' && ln.userCount == null));
    if (!anyLow && !anyMixed) return null;
    const wrap = el('div', 'nw-legend');
    wrap.appendChild(el('span', 'nw-legend-lab', t('networth.legend.label')));
    if (anyMixed) {
      const k = el('span', 'nw-legend-key');
      k.appendChild(el('span', 'nw-legend-sw nw-legend-sw-mixed'));
      k.appendChild(el('span', null, t('networth.legend.mixed')));
      k.title = t('networth.line.unreliable_mixed');
      wrap.appendChild(k);
    }
    if (anyLow) {
      const k = el('span', 'nw-legend-key');
      k.appendChild(el('span', 'nw-legend-sw nw-legend-sw-low'));
      k.appendChild(el('span', null, t('networth.legend.low')));
      k.title = t('networth.line.unreliable_low');
      wrap.appendChild(k);
    }
    return wrap;
  }

  function experimentalBanner() {
    const b = el('div', 'nw-exp');
    b.appendChild(el('div', 'nw-exp-body', t('networth.experimental.explain')));
    const btn = el('button', 'nw-exp-btn', t('networth.experimental.submit_button'));
    btn.onclick = async () => {
      await window.api.stashSampleReset();
      state.sample = { shots: [], error: null, sending: false, done: 0 };
      render();
    };
    b.appendChild(btn);
    return b;
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
    totBox.appendChild(el('div', 'nw-grand-lab', rows ? tn('networth.header.tabs_included', rows, { included, total: rows }) : t('networth.header.no_tabs_captured')));
    const gline = el('div', 'nw-grand-val' + (rows && gt.edited ? ' nw-edited' : ''));
    gline.appendChild(el('span', 'nw-total-lab', t('networth.header.total_label')));
    gline.appendChild(el('span', 'nw-ex', fmtEx(rows ? gt.ex : null)));
    if (gt.div != null) gline.appendChild(el('span', 'nw-div', fmtDiv(gt.div)));
    if (rows && gt.mirrors != null) gline.appendChild(el('span', 'nw-mirror',
      `(${gt.mirrors.toLocaleString('en-US')}<img class="nw-mirror-ic" src="${MIRROR_ICON}" alt="${t('networth.grand.mirror_alt')}">)`));
    totBox.appendChild(gline);
    header.appendChild(totBox);
    const controls = el('div', 'nw-controls');
    if (state.busy) controls.appendChild(el('span', 'nw-scanning', t('networth.status.scanning')));
    const gear = el('button', 'nw-gear', '⚙'); gear.title = t('networth.header.settings_tooltip', { hotkey: state.hotkey });
    gear.onclick = () => { if (window.openNetWorthSettings) window.openNetWorthSettings(); };
    controls.appendChild(gear);
    header.appendChild(controls);
    wrap.appendChild(header);
    wrap.appendChild(experimentalBanner());
    { const lg = reliabilityLegend(); if (lg) wrap.appendChild(lg); }

    if (state.notice) wrap.appendChild(el('div', 'nw-notice nw-' + state.notice.kind, esc(state.notice.msg)));

    const pending = state.busy && state.phase === 'detecting' ? state.pendingTab : null;
    if (!rows && !state.busy) {
      wrap.appendChild(el('div', 'nw-empty',
        t('networth.empty.instructions', { hotkey: esc(state.hotkey) }) + '<br>'
        + t('networth.empty.explain') + '<br>'
        ));
    } else {
      for (const row of state.rows) wrap.appendChild(rowCard(row));
      if (state.busy) wrap.appendChild(busyCard(pending));
      if (rows) {
        const footer = el('div', 'nw-footer');
        const clear = el('button', 'nw-reset', t('networth.footer.clear_tally'));
        clear.onclick = () => { state.rows = []; state.expanded = {}; state.notice = null; render(); };
        footer.appendChild(clear);
        if (anyEdits()) {
          const re = el('button', 'nw-reset nw-reset-edits', t('networth.footer.reset_edits'));
          re.title = t('networth.footer.reset_edits_title');
          re.onclick = () => { for (const r of state.rows) for (const ln of r.result.lines) { ln.userCount = undefined; ln.excluded = false; } render(); };
          footer.appendChild(re);
        }
        wrap.appendChild(footer);
      }
    }
    root.appendChild(wrap);
    if (state.modal) root.appendChild(modalEl());
    if (state.sample) root.appendChild(sampleModalEl());
  }

  // staged events from main drive live feedback (works even while hidden)
  if (window.api) {
    // a capture always brings the tally into view - the tab can be hidden via
    // App Settings, but its hotkey still works, and a capture nobody can see
    // would look broken
    if (window.api.onStashCapturing) window.api.onStashCapturing(() => {
      state.busy = true; state.phase = 'scanning'; state.pendingTab = null; state.notice = null;
      if (window.showNetWorthTab) window.showNetWorthTab();
      render();
    });
    if (window.api.onStashDetected) window.api.onStashDetected((tab) => { state.busy = true; state.phase = 'detecting'; state.pendingTab = tab; render(); });
    if (window.api.onStashCaptured) window.api.onStashCaptured((res) => { state.busy = false; state.phase = 'idle'; state.pendingTab = null; applyResult(res); });
    if (window.api.onStashCalibrated) window.api.onStashCalibrated((res) => {
      state.busy = false; state.phase = 'idle'; state.pendingTab = null; state.calibrated = true;
      const scale = res && typeof res.calScale === 'number' ? res.calScale : 1;
      const small = scale < 0.92;
      const smallMsg = small ? t('networth.calibrate.small_panel_warning', { scalePercent: Math.round(scale * 100) }) : '';
      if (res && res.ok && !res.mismatch) {
        applyResult(res);
        state.notice = { kind: small ? 'warn' : 'ok', msg: t('networth.calibrate.success', { tabName: TAB_LABEL[res.tab] || res.tab, readCount: res.readCount, slotCount: res.slotCount, smallPanelWarning: smallMsg }) };
      } else {
        state.notice = { kind: 'warn', msg: t('networth.calibrate.no_tab_read', { hotkey: state.hotkey, smallPanelWarning: smallMsg }) };
      }
      render();
    });
  }

  window.NetWorth = { render, capture, renderSettings };
})();
