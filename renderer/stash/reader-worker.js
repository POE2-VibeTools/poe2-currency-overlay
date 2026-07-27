'use strict';
// Worker thread: runs the CPU-heavy stash OCR off the main process so the event loop
// (global hotkeys, IPC, window toggle) stays responsive during a capture.
//
// Detection is template-match (tab-detect.js): downsample the calibrated panel box to a
// fixed thumbnail, edge-correlate against a baked template per tab, pick the match. This
// is fill/darkness independent (no per-cell detection) and resolution-robust (the box is
// calibrated + downsampled). Reading then scales the matched tab's static slot positions
// into the live box and OCRs each count. Pricing stays in main (needs network/cache).
const { parentPort } = require('worker_threads');
const DR = require('./digit-reader');
const TD = require('./tab-detect');
const TAB_TEMPLATES = require('./tab-templates.json'); // { box (reference), tw, th, templates }
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
  delirium: require('./delirium-tab-map'),
  breach: require('./breach-tab-map'),
  expedition: require('./expedition-tab-map'),
};
const DIGITS = DR.templatesFromJSON(require('./digit-templates.json'));
const MIN_SCORE = 0.3; // below this the panel isn't a recognized stash tab

// per-tab OCR params: DEFAULTS with any map.readParams override (e.g. Kalguuran runes
// bleed art flush against the count -> tighter stripWidth).
function paramsFor(m) { return m && m.readParams ? Object.assign({}, DR.DEFAULTS, m.readParams) : DR.DEFAULTS; }

parentPort.on('message', (msg) => {
  try {
    const { bitmap, W, H, calBox } = msg;
    const buf = Buffer.from(bitmap);
    const refBox = TAB_TEMPLATES.box;
    const box = calBox || refBox; // no calibration yet -> assume reference resolution

    // 1) which tab? (template correlation, fill/darkness independent)
    const det = TD.detect(buf, W, H, box, TAB_TEMPLATES);
    if (!det || det.score < MIN_SCORE) {
      parentPort.postMessage({ ok: true, mismatch: true, readCount: 0, slotCount: 0 });
      return;
    }
    const tab = det.tab;
    const map = TABS[tab];
    if (!map) {
      // recognized the tab (e.g. delirium/breach/expedition) but it has no read map yet
      parentPort.postMessage({ ok: true, mismatch: true, detectedTab: tab, unsupported: true, readCount: 0, slotCount: 0 });
      return;
    }
    parentPort.postMessage({ phase: 'detected', tab }); // let the UI pre-create the row

    // 2) read every slot at its reference position scaled into the live box.
    // scale = how much bigger the calibrated panel is than the reference (drives
    // digit-template normalisation); 1 when uncalibrated / at reference resolution.
    const V = DR.valueChannelDesatMax(buf, W, H);
    const P = paramsFor(map);
    const scale = box.h / refBox.h;
    const reads = []; let readCount = 0;
    for (const s of map.STATIC_SLOTS) {
      const pos = TD.scalePos(s.cx, s.cy, refBox, box);
      const raw = DR.readCell(V, W, H, pos.cx, pos.cy, DIGITS, P, scale);
      if (raw !== '?') readCount++;
      reads.push({ apiId: s.apiId, count: raw === '?' ? null : parseInt(raw, 10) });
    }
    parentPort.postMessage({ ok: true, tab, score: det.score, readCount, slotCount: map.STATIC_SLOTS.length, reads });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
});
