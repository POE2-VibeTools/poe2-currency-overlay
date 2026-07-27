'use strict';
// Worker thread: runs the CPU-heavy stash OCR off the main process so the event
// loop (global hotkeys, IPC, window toggle) stays responsive during a capture.
// Receives a raw screen bitmap, detects which special tab is shown, reads every
// static slot's count. Pricing stays in main (needs network/cache).
const { parentPort } = require('worker_threads');
const DR = require('./digit-reader');
const TABS = {
  currency: require('./currency-tab-map'),
  abyss: require('./abyss-tab-map'),
  essence: require('./essence-tab-map'),
  runes: require('./runes-tab-map'),
  'runes-kalguuran': require('./runes-kalguuran-tab-map'),
  ritual: require('./ritual-tab-map'),
  soulcore: require('./soulcore-tab-map'),
  idol: require('./idol-tab-map'),
  'ancient-augment': require('./ancient-augment-tab-map'),
};
const TEMPLATES = require('./digit-templates.json');

const T = DR.templatesFromJSON(TEMPLATES);
// per-tab read params: DEFAULTS with any map.readParams override (e.g. Kalguuran
// runes bleed art flush against the count -> tighter stripWidth).
function paramsFor(m) { return m && m.readParams ? Object.assign({}, DR.DEFAULTS, m.readParams) : DR.DEFAULTS; }

// count valid reads over a slot subset at a given offset
function countAt(V, W, H, slots, dx, dy, P) {
  let n = 0;
  for (const s of slots) if (DR.readCell(V, W, H, s.cx + dx, s.cy + dy, T, P) !== '?') n++;
  return n;
}
// ~6 slots spread across a layout — enough to lock alignment without reading all
function anchorsOf(m) {
  const s = m.STATIC_SLOTS;
  if (s.length <= 8) return s;
  return [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((f) => s[Math.min(s.length - 1, Math.round(f * (s.length - 1)))]);
}
// coarse (step 3) then fine (±2) search on anchors only -> ~15x fewer matches
function searchOffset(m, V, W, H) {
  const anc = anchorsOf(m);
  const P = paramsFor(m);
  const pick = (best, dx, dy) => {
    const n = countAt(V, W, H, anc, dx, dy, P);
    return (!best || n > best.n || (n === best.n && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) ? { dx, dy, n } : best;
  };
  let best = null;
  for (let dy = -6; dy <= 10; dy += 3) for (let dx = -6; dx <= 8; dx += 3) best = pick(best, dx, dy);
  let fine = null;
  for (let dy = best.dy - 2; dy <= best.dy + 2; dy++) for (let dx = best.dx - 2; dx <= best.dx + 2; dx++) fine = pick(fine, dx, dy);
  return fine;
}

parentPort.on('message', (msg) => {
  try {
    const { bitmap, W, H, hint } = msg;
    const V = DR.valueChannelDesatMax(Buffer.from(bitmap), W, H);

    // 1) fast path: a cached offset from a prior capture usually still fits (same
    //    resolution + window position) -> just verify which tab reads best there.
    let detected = null;
    if (hint) {
      for (const id of Object.keys(TABS)) {
        const m = TABS[id];
        const frac = countAt(V, W, H, m.STATIC_SLOTS, hint.dx, hint.dy, paramsFor(m)) / m.STATIC_SLOTS.length;
        if (!detected || frac > detected.frac) detected = { id, map: m, align: { dx: hint.dx, dy: hint.dy }, frac };
      }
      if (detected && detected.frac < 0.5) detected = null; // hint didn't fit; fall through to search
    }
    // 2) slow path: anchor-based coarse-to-fine search per layout
    if (!detected) {
      for (const id of Object.keys(TABS)) {
        const m = TABS[id];
        const a = searchOffset(m, V, W, H);
        const frac = a.n / anchorsOf(m).length;
        if (!detected || frac > detected.frac) detected = { id, map: m, align: a, frac };
      }
    }
    if (!detected || detected.frac < 0.34) {
      parentPort.postMessage({ ok: true, mismatch: true, readCount: detected ? (detected.align.n || 0) : 0, slotCount: detected ? detected.map.STATIC_SLOTS.length : 0 });
      return;
    }
    const { id: tab, map, align } = detected;
    parentPort.postMessage({ phase: 'detected', tab }); // let the UI pre-create the row
    const RP = paramsFor(map);
    const reads = []; let readCount = 0;
    for (const s of map.STATIC_SLOTS) {
      const raw = DR.readCell(V, W, H, s.cx + align.dx, s.cy + align.dy, T, RP);
      if (raw !== '?') readCount++;
      reads.push({ apiId: s.apiId, count: raw === '?' ? null : parseInt(raw, 10) });
    }
    parentPort.postMessage({ ok: true, tab, offset: { dx: align.dx, dy: align.dy }, readCount, slotCount: map.STATIC_SLOTS.length, reads });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
});
