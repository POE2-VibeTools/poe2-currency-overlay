'use strict';
// Static slot -> omen map for the PoE2 Ritual stash tab (fixed, irregular twin-cluster layout).
// Coords = stack-count number center, LIVE 1920x1080 desktopCapturer frame. Identities
// Drew-verified 2026-07-26; positions read cluster-by-cluster (auto-detect misses cells here).
// Omens are grouped into "buckets", each with a small marker icon in the top-left corner of the
// leftmost omen (Drew's insight); the number is layered on top. All owned cells read clean here.
// sinistral-crystallisation's "41" (rune art fused to the "1") is fixed by the digit-reader's
// 1px kerning-overlap tolerance (see digit-reader overlaps()). chance @(258,520) is tuned to read
// "?" on the empty cell past its bucket marker.
// TODO: 3 unowned/unknown empties not mapped (R1 slot3, R2 slot1, R4 slot1).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).ritualTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const STATIC_SLOTS = [
    { cx: 208, cy: 209, apiId: 'an-audience-with-the-king' },
    { cx: 269, cy: 209, apiId: 'head-of-the-king' },
    { cx: 337, cy: 304, apiId: 'omen-of-gambling' },
    { cx: 394, cy: 304, apiId: 'omen-of-bartering' },
    { cx: 110, cy: 385, apiId: 'omen-of-sinistral-exaltation' },
    { cx: 173, cy: 385, apiId: 'omen-of-dextral-exaltation' },
    { cx: 228, cy: 385, apiId: 'omen-of-greater-exaltation' },
    { cx: 313, cy: 385, apiId: 'omen-of-sinistral-erasure' },
    { cx: 364, cy: 385, apiId: 'omen-of-dextral-erasure' },
    { cx: 427, cy: 385, apiId: 'omen-of-whittling' },
    { cx: 202, cy: 442, apiId: 'omen-of-catalysing-exaltation' },
    { cx: 312, cy: 442, apiId: 'omen-of-chaotic-rarity' },
    { cx: 368, cy: 442, apiId: 'omen-of-chaotic-quantity' },
    { cx: 426, cy: 442, apiId: 'omen-of-chaotic-monsters' },
    { cx: 488, cy: 442, apiId: 'omen-of-chaotic-effectiveness' },
    { cx: 137, cy: 525, apiId: 'omen-of-sinistral-annulment' },
    { cx: 194, cy: 525, apiId: 'omen-of-dextral-annulment' },
    { cx: 333, cy: 525, apiId: 'omen-of-the-ancients' },
    { cx: 410, cy: 525, apiId: 'omen-of-the-blessed' },
    { cx: 468, cy: 525, apiId: 'omen-of-sanctification' },
    { cx: 258, cy: 520, apiId: 'omen-of-chance' },
    { cx: 132, cy: 606, apiId: 'omen-of-dextral-crystallisation' },
    { cx: 186, cy: 606, apiId: 'omen-of-sinistral-crystallisation' },
    { cx: 110, cy: 700, apiId: 'omen-of-resurgence' },
    { cx: 166, cy: 700, apiId: 'omen-of-amelioration' },
    { cx: 222, cy: 700, apiId: 'omen-of-refreshment' },
    { cx: 300, cy: 700, apiId: 'omen-of-the-hunt' },
    { cx: 356, cy: 700, apiId: 'omen-of-answered-prayers' },
    { cx: 412, cy: 700, apiId: 'omen-of-secret-compartments' },
    { cx: 468, cy: 700, apiId: 'omen-of-reinforcements' },
  ];
  const EMPTY_STATIC_TODO = [];
  return { tab: 'ritual', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
