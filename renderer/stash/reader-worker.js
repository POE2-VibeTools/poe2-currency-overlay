'use strict';
// Worker thread: runs the CPU-heavy stash OCR off the main process so the event
// loop (global hotkeys, IPC, window toggle) stays responsive during a capture.
// Receives a raw screen bitmap, detects which special tab is shown, reads every
// static slot's count. Pricing stays in main (needs network/cache).
const { parentPort } = require('worker_threads');
const DR = require('./digit-reader');
const TABS = { currency: require('./currency-tab-map') };
const TEMPLATES = require('./digit-templates.json');

const T = DR.templatesFromJSON(TEMPLATES);
const P = DR.DEFAULTS;

function alignFor(m, V, W, H) {
  const score = (dx, dy) => m.STATIC_SLOTS.reduce((a, s) =>
    a + (DR.readCell(V, W, H, s.cx + dx, s.cy + dy, T, P) !== '?' ? 1 : 0), 0);
  let best = { dx: 0, dy: 0, n: -1 };
  for (let dy = -6; dy <= 10; dy++) for (let dx = -6; dx <= 8; dx++) {
    const n = score(dx, dy);
    if (n > best.n || (n === best.n && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, n };
  }
  return best;
}

parentPort.on('message', (msg) => {
  try {
    const { bitmap, W, H } = msg;
    const V = DR.valueChannelDesatMax(Buffer.from(bitmap), W, H);

    // detect which layout is on screen: the one that reads best
    let detected = null;
    for (const id of Object.keys(TABS)) {
      const m = TABS[id];
      const align = alignFor(m, V, W, H);
      const frac = align.n / m.STATIC_SLOTS.length;
      if (!detected || frac > detected.frac) detected = { id, map: m, align, frac };
    }
    if (!detected || detected.frac < 0.34) {
      parentPort.postMessage({ ok: true, mismatch: true, readCount: detected ? detected.align.n : 0, slotCount: detected ? detected.map.STATIC_SLOTS.length : 0 });
      return;
    }
    const { id: tab, map, align } = detected;
    parentPort.postMessage({ phase: 'detected', tab }); // let the UI pre-create the row
    const reads = [];
    for (const s of map.STATIC_SLOTS) {
      const raw = DR.readCell(V, W, H, s.cx + align.dx, s.cy + align.dy, T, P);
      reads.push({ apiId: s.apiId, count: raw === '?' ? null : parseInt(raw, 10) });
    }
    parentPort.postMessage({ ok: true, tab, offset: align, readCount: align.n, slotCount: map.STATIC_SLOTS.length, reads });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
});
