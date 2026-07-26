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
  const state = { tabs: {}, busy: false, notice: null };
  const TAB_LABEL = { currency: 'Currency' };

  async function capture() {
    if (state.busy) return;
    state.busy = true; state.notice = null; render();
    let res;
    try { res = await window.api.stashCapture('currency'); }
    catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
    state.busy = false;
    if (!res || !res.ok) { state.notice = { kind: 'err', msg: `Capture failed: ${res && res.error || 'unknown error'}` }; return render(); }
    if (res.mismatch) { state.notice = { kind: 'warn', msg: `Only read ${res.readCount}/${res.slotCount} slots — open the Currency tab in game, make sure it's fully visible, and Capture again.` }; return render(); }
    state.tabs[res.tab] = res;
    state.notice = null;
    render();
  }

  function grandTotals() {
    let ex = 0, div = null, divPrice = null;
    for (const k of Object.keys(state.tabs)) { const r = state.tabs[k]; ex += r.totalEx || 0; if (r.divPrice) divPrice = r.divPrice; }
    if (divPrice) div = ex / divPrice;
    return { ex, div };
  }

  function tabCard(r) {
    const card = el('div', 'nw-card');
    const head = el('div', 'nw-card-head');
    head.appendChild(el('div', 'nw-card-title', esc(TAB_LABEL[r.tab] || r.tab)));
    const tot = el('div', 'nw-card-total');
    tot.appendChild(el('span', 'nw-ex', fmtEx(r.totalEx)));
    if (r.totalDiv != null) tot.appendChild(el('span', 'nw-div', fmtDiv(r.totalDiv)));
    head.appendChild(tot);
    card.appendChild(head);

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

    const btn = el('button', 'nw-capture', state.busy ? 'Capturing…' : 'Capture current tab');
    btn.disabled = state.busy;
    btn.onclick = capture;
    header.appendChild(btn);
    wrap.appendChild(header);

    if (state.notice) wrap.appendChild(el('div', 'nw-notice nw-' + state.notice.kind, esc(state.notice.msg)));

    if (!captured) {
      wrap.appendChild(el('div', 'nw-empty',
        'Open a special stash tab in game (Currency for now), keep it fully visible, and press <b>Capture current tab</b>.<br>'
        + 'Each tab you capture is added here with its own total, plus a running grand total.'));
    } else {
      for (const k of Object.keys(state.tabs)) wrap.appendChild(tabCard(state.tabs[k]));
      const reset = el('button', 'nw-reset', 'Clear tally');
      reset.onclick = () => { state.tabs = {}; state.notice = null; render(); };
      wrap.appendChild(reset);
    }
    root.appendChild(wrap);
  }

  window.NetWorth = { render, capture };
})();
