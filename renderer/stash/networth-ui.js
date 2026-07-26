// Net Worth panel: capture a special stash tab (screen-OCR in main), value it via
// the live catalog, and keep a running per-tab tally with a grand total.
// Reading lives in main (ipc 'stash-capture'); this module only renders + tallies.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtEx = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US') + ' ex';
  const fmtDiv = (n) => n == null ? null : (n >= 100 ? Math.round(n) : n.toFixed(1)).toLocaleString('en-US') + ' div';
  const fmtCount = (n) => Number(n).toLocaleString('en-US');

  // running tally, this session: tab id -> latest capture result
  const state = { tabs: {}, expanded: {}, busy: false, phase: 'idle', pendingTab: null, notice: null };
  const TAB_LABEL = { currency: 'Currency' };

  // Fold a capture result into the tally (dedup by detected tab), or surface a
  // notice. Shared by the in-app button and the global hotkey push.
  function applyResult(res) {
    if (!res || !res.ok) { state.notice = { kind: 'err', msg: `Capture failed: ${res && res.error || 'unknown error'}` }; return render(); }
    if (res.mismatch) { state.notice = { kind: 'warn', msg: `Couldn't read a supported tab (${res.readCount || 0} slots). Open a special stash tab in game, keep it fully visible, and capture again.` }; return render(); }
    state.tabs[res.tab] = res;   // keyed by detected tab -> updates that row, no dupes
    state.expanded[res.tab] = state.expanded[res.tab] || false;
    state.notice = null;
    render();
  }

  // Fire-and-forget: main runs the capture in a worker and streams staged events
  // (capturing -> detected -> captured) back, which drive the UI below.
  function capture() {
    if (state.busy) return;
    state.notice = null;
    try { window.api.stashCaptureStart(); } catch (e) { state.notice = { kind: 'err', msg: 'Capture unavailable.' }; render(); }
  }

  function grandTotals() {
    let ex = 0, div = null, divPrice = null;
    for (const k of Object.keys(state.tabs)) { const r = state.tabs[k]; ex += r.totalEx || 0; if (r.divPrice) divPrice = r.divPrice; }
    if (divPrice) div = ex / divPrice;
    return { ex, div };
  }

  function tabCard(r) {
    const open = !!state.expanded[r.tab];
    const card = el('div', 'nw-card' + (open ? ' nw-open' : ''));
    const head = el('div', 'nw-card-head');
    head.title = open ? 'Collapse' : 'Expand';
    const title = el('div', 'nw-card-title');
    title.appendChild(el('span', 'nw-chev', open ? '▾' : '▸'));
    title.appendChild(document.createTextNode(TAB_LABEL[r.tab] || r.tab));
    head.appendChild(title);
    const tot = el('div', 'nw-card-total');
    tot.appendChild(el('span', 'nw-ex', fmtEx(r.totalEx)));
    if (r.totalDiv != null) tot.appendChild(el('span', 'nw-div', fmtDiv(r.totalDiv)));
    head.appendChild(tot);
    head.onclick = () => { state.expanded[r.tab] = !state.expanded[r.tab]; render(); };
    card.appendChild(head);
    if (!open) return card; // collapsed: name + total only

    const list = el('div', 'nw-lines');
    for (const ln of r.lines) {
      if (!ln.count) continue;
      const row = el('div', 'nw-line');
      if (ln.icon) { const img = el('img', 'nw-ic'); img.src = ln.icon; img.onerror = () => img.remove(); row.appendChild(img); }
      else row.appendChild(el('div', 'nw-ic nw-ic-none'));
      row.appendChild(el('div', 'nw-name', esc(ln.name)));
      row.appendChild(el('div', 'nw-cnt', '×' + fmtCount(ln.count)));
      row.appendChild(el('div', 'nw-val', ln.valueEx == null ? '<span class="nw-noprice">no price</span>' : fmtEx(ln.valueEx)));
      list.appendChild(row);
    }
    card.appendChild(list);

    if (r.flags && r.flags.length) {
      const names = r.flags.map((f) => esc(f.name)).join(', ');
      card.appendChild(el('div', 'nw-flags', `${r.flags.length} slot${r.flags.length === 1 ? '' : 's'} empty or unread (not counted): ${names}`));
    }
    return card;
  }

  function render() {
    const root = $('networth-root'); if (!root) return;
    root.innerHTML = '';
    const wrap = el('div', 'nw');

    // header: grand total + capture button
    const gt = grandTotals();
    const captured = Object.keys(state.tabs).length;
    const header = el('div', 'nw-header');
    const totBox = el('div', 'nw-grand');
    totBox.appendChild(el('div', 'nw-grand-lab', captured ? `Running total · ${captured} tab${captured === 1 ? '' : 's'}` : 'Running total'));
    const gline = el('div', 'nw-grand-val');
    gline.appendChild(el('span', 'nw-ex', fmtEx(captured ? gt.ex : null)));
    if (gt.div != null) gline.appendChild(el('span', 'nw-div', fmtDiv(gt.div)));
    totBox.appendChild(gline);
    header.appendChild(totBox);

    const btn = el('button', 'nw-capture', state.busy ? 'Capturing…' : 'Capture tab (F7)');
    btn.disabled = state.busy;
    btn.onclick = capture;
    header.appendChild(btn);
    wrap.appendChild(header);

    if (state.notice) wrap.appendChild(el('div', 'nw-notice nw-' + state.notice.kind, esc(state.notice.msg)));

    // while a capture runs, show a placeholder for the tab being worked on so the
    // detected tab appears immediately with a spinner, then fills in when ready
    const pending = state.busy && state.phase === 'detecting' ? state.pendingTab : null;

    if (!captured && !state.busy) {
      wrap.appendChild(el('div', 'nw-empty',
        'Open a special stash tab in game, keep it fully visible, and press <b>F7</b> (or the Capture button).<br>'
        + 'The tab is detected automatically and added here with its own total, plus a running grand total. '
        + 'Flip to the next tab, press F7 again — re-capturing a tab updates its row.<br>'
        + '<span style="color:var(--tx-faint)">Currency tab supported now; more tabs coming.</span>'));
    } else {
      for (const k of Object.keys(state.tabs)) {
        if (k === pending) wrap.appendChild(busyCard(k)); // updating this row
        else wrap.appendChild(tabCard(state.tabs[k]));
      }
      if (pending && !state.tabs[pending]) wrap.appendChild(busyCard(pending));   // new tab, first capture
      if (state.busy && state.phase !== 'detecting') wrap.appendChild(busyCard(null)); // scanning
      if (captured) {
        const reset = el('button', 'nw-reset', 'Clear tally');
        reset.onclick = () => { state.tabs = {}; state.notice = null; render(); };
        wrap.appendChild(reset);
      }
    }
    root.appendChild(wrap);
  }

  // placeholder card shown while a capture is in flight
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

  // staged events from main drive the live feedback (works even while hidden)
  if (window.api) {
    if (window.api.onStashCapturing) window.api.onStashCapturing(() => { state.busy = true; state.phase = 'scanning'; state.pendingTab = null; state.notice = null; render(); });
    if (window.api.onStashDetected) window.api.onStashDetected((tab) => { state.busy = true; state.phase = 'detecting'; state.pendingTab = tab; render(); });
    if (window.api.onStashCaptured) window.api.onStashCaptured((res) => { state.busy = false; state.phase = 'idle'; state.pendingTab = null; applyResult(res); });
  }

  window.NetWorth = { render, capture };
})();
