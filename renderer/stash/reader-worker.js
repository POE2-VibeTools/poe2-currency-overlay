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
const PF = require('./panel-finder');
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
// multi-rendering bank: the base exemplars plus one set per baked capture, so a digit
// drawn slightly differently on someone else's machine still has something to match
const { bank: DIGITS, unmap: UNMAP } = DR.bankFromJSON(require('./digit-templates.json'));
const MIN_SCORE = 0.3; // below this the panel isn't a recognized stash tab

// per-tab OCR params: DEFAULTS with any map.readParams override (e.g. Kalguuran runes
// bleed art flush against the count -> tighter stripWidth).
function paramsFor(m) { return m && m.readParams ? Object.assign({}, DR.DEFAULTS, m.readParams) : DR.DEFAULTS; }

parentPort.on('message', (msg) => {
  try {
    const { bitmap, W, H, calBox } = msg;
    const buf = Buffer.from(bitmap);
    const refBox = TAB_TEMPLATES.box;
    // Find the panel by its coloured frame, which is what makes calibration optional: the
    // frame is a saturated rectangle on an otherwise brown UI, so it can be located
    // outright rather than asked for.
    //
    // When the user HAS calibrated, both boxes are scored and the better one wins. Auto
    // must not silently override a box someone deliberately set - that turns Calibrate
    // into a button that eats your effort and changes nothing. But a saved box also goes
    // stale the moment the resolution or UI scale changes, and a stale box is exactly what
    // produces silent misreads, so it does not get to win on seniority either. Letting the
    // detector judge is the only version that is honest in both directions.
    let box = calBox || refBox;
    let boxSource = calBox ? 'calibration' : 'reference';
    let panelCoverage = null;
    let autoFound = false;
    try {
      const found = PF.findPanel(buf, W, H);
      if (found) {
        const autoBox = PF.frameToContent(found);
        if (!calBox) {
          box = autoBox; boxSource = 'auto';
        } else {
          const autoDet = TD.detect(buf, W, H, autoBox, TAB_TEMPLATES);
          const calDet = TD.detect(buf, W, H, calBox, TAB_TEMPLATES);
          const autoScore = autoDet ? autoDet.score : 0;
          const calScore = calDet ? calDet.score : 0;
          // the saved box keeps the tie: if it is as good, the user's choice stands
          if (autoScore > calScore + 0.02) { box = autoBox; boxSource = 'auto'; }
        }
        panelCoverage = +found.coverage.toFixed(3);
        autoFound = true;
      }
    } catch (e) { /* fall back to whatever calBox gave us */ }

    // 1) which tab? (template correlation, fill/darkness independent)
    const det = TD.detect(buf, W, H, box, TAB_TEMPLATES);
    if (!det || det.score < MIN_SCORE) {
      parentPort.postMessage({ ok: true, mismatch: true, autoFound, readCount: 0, slotCount: 0 });
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

    // 2) read every slot at its reference position.
    // Above (or below) the reference resolution the PANEL is normalised back to
    // reference size ONCE, whole, and then every slot is read at scale 1. Rescaling
    // per cell instead - crop a scaled window, shrink that 40x32 window, threshold it -
    // measurably shredded the digits: on a 1.33x/1.5x panel (i.e. any 1440p or ultrawide
    // setup) multi-digit counts came back as confident nonsense, "1383" read as "8" and
    // "160" as "1", while normalising the whole panel first reads the same pixels
    // correctly. Anything left of the old per-cell path would just re-introduce that.
    const scale = box.h / refBox.h;
    const M = 24; // reference-px margin, so a slot's read strip never sits on the edge
    let V, W2, H2, originX, originY;
    if (Math.abs(scale - 1) > 0.005) {
      const kx = box.w / refBox.w, ky = box.h / refBox.h;
      W2 = Math.round(refBox.w + 2 * M); H2 = Math.round(refBox.h + 2 * M);
      const norm = DR.resampleRGBA(buf, W, H, box.x - M * kx, box.y - M * ky, (refBox.w + 2 * M) * kx, (refBox.h + 2 * M) * ky, W2, H2);
      V = DR.valueChannelDesatMax(norm, W2, H2);
      // reference-space slot coords -> normalised-panel coords
      originX = refBox.x - M; originY = refBox.y - M;
    } else {
      V = DR.valueChannelDesatMax(buf, W, H); W2 = W; H2 = H;
      originX = 0; originY = 0;
    }
    const P = paramsFor(map);
    const reads = []; let readCount = 0;
    for (const s of map.STATIC_SLOTS) {
      const pos = (originX || originY)
        ? { cx: s.cx - originX, cy: s.cy - originY }
        : TD.scalePos(s.cx, s.cy, refBox, box);
      // adaptive: pick the binarisation threshold per cell rather than trusting one
      // global floor, which only ever suited the capture the templates came from
      const r = DR.readCellAdaptive(V, W2, H2, pos.cx, pos.cy, DIGITS, P, 1);
      const raw = r.text === '?' ? '?' : UNMAP(r.text); // alt keys back to digits
      const conf = r.conf;
      if (raw !== '?') readCount++;
      // pass the measured reliability of this slot through, so the UI can flag the
      // rows our own testing says to distrust rather than showing them all alike
      const rel = (map.SLOT_RELIABILITY && map.SLOT_RELIABILITY[s.apiId]) || null;
      reads.push({ apiId: s.apiId, count: raw === '?' ? null : parseInt(raw, 10), conf: raw === '?' ? null : conf, rel });
    }
    parentPort.postMessage({ ok: true, tab, score: det.score, readCount, slotCount: map.STATIC_SLOTS.length, reads, boxSource, panelCoverage, autoFound, box });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
});
