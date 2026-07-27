'use strict';
// Static slot -> item map for the PoE2 Breach stash tab, CATALYSTS subtab only
// (Wombgifts subtab intentionally not mapped, per Drew). Coords = stack-count number
// center in the LIVE 1920x1080 desktopCapturer frame. Identities Drew-verified
// 2026-07-27; owned counts OCR-confirmed at digit-reader DEFAULTS (16/16), empties
// read "?" cleanly.
//
// Layout (below the Catalysts/Wombgifts subtab header at y~200):
//   top pair : Breach Splinter, Breachstone
//   center   : Breachlord Sac (large 2-wide slot; empty for Drew -> count UNVERIFIED,
//              estimated at the slot's top-left ~ (270,342); revisit when non-empty).
//   base catalysts : 13 across a 6-cell row (cy474) + a 7-cell row (cy536)
//   refined        : the same 13 as "Refined X Catalyst", 6-cell row (cy618) + 7-cell (cy681)
// 6-cell rows are CENTERED (half-cell offset) over the 7-cell rows. Catalyst order per
// row (Drew): [Flesh Neural Adaptive Uul-Netol's Xoph's Tul's] then
// [Esh's Chayula's Carapace Reaver Sibilant Skittering Necrotic].
// Most refined + a few base slots are 0-owned (empty) -> read "?" (excluded; surfaced
// only when the UI "Show missing" toggle is on). Necrotic's col-7 number sits at cx492
// (not the 64px pitch's 497 - art crowds the panel edge there).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).breachTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const STATIC_SLOTS = [
    // top pair + center
    { cx: 268, cy: 280, apiId: 'breach-splinter' },
    { cx: 330, cy: 280, apiId: 'breachstone' },
    { cx: 270, cy: 342, apiId: 'breachlord-sac' }, // large slot, empty -> position UNVERIFIED
    // base catalysts, row A (6-cell, centered)
    { cx: 145, cy: 474, apiId: 'flesh-catalyst' },
    { cx: 209, cy: 474, apiId: 'neural-catalyst' },
    { cx: 273, cy: 474, apiId: 'adaptive-catalyst' },
    { cx: 337, cy: 474, apiId: 'uul-netols-catalyst' },
    { cx: 401, cy: 474, apiId: 'xophs-catalyst' },
    { cx: 465, cy: 474, apiId: 'tuls-catalyst' },
    // base catalysts, row B (7-cell)
    { cx: 113, cy: 536, apiId: 'eshs-catalyst' },
    { cx: 177, cy: 536, apiId: 'chayulas-catalyst' },
    { cx: 241, cy: 536, apiId: 'carapace-catalyst' },
    { cx: 305, cy: 536, apiId: 'reaver-catalyst' },
    { cx: 369, cy: 536, apiId: 'sibilant-catalyst' },
    { cx: 433, cy: 536, apiId: 'skittering-catalyst' },
    { cx: 492, cy: 536, apiId: 'necrotic-catalyst' },
    // refined catalysts, row C (6-cell, centered) - mirrors row A
    { cx: 145, cy: 618, apiId: 'refined-flesh-catalyst' },
    { cx: 209, cy: 618, apiId: 'refined-neural-catalyst' },
    { cx: 273, cy: 618, apiId: 'refined-adaptive-catalyst' },
    { cx: 337, cy: 618, apiId: 'refined-uul-netols-catalyst' },
    { cx: 401, cy: 618, apiId: 'refined-xophs-catalyst' },
    { cx: 465, cy: 618, apiId: 'refined-tuls-catalyst' },
    // refined catalysts, row D (7-cell) - mirrors row B
    { cx: 113, cy: 681, apiId: 'refined-eshs-catalyst' },
    { cx: 177, cy: 681, apiId: 'refined-chayulas-catalyst' },
    { cx: 241, cy: 681, apiId: 'refined-carapace-catalyst' },
    { cx: 305, cy: 681, apiId: 'refined-reaver-catalyst' },
    { cx: 369, cy: 681, apiId: 'refined-sibilant-catalyst' },
    { cx: 433, cy: 681, apiId: 'refined-skittering-catalyst' },
    { cx: 492, cy: 681, apiId: 'refined-necrotic-catalyst' },
  ];
  const EMPTY_STATIC_TODO = [];
  return { tab: 'breach', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
