'use strict';
// Static slot -> rune map for the PoE2 Augment tab, subtab 1 "Runes" (fixed layout).
// Coords are the stack-count number center, in the LIVE 1920x1080 desktopCapturer
// frame (reader uses coords directly + a small offset search; captureSize is metadata).
// Verified 2026-07-26 against a live capture (Runes of Aldur): all owned cells read.
//
// Layout:
//  - BLUE basic runes: 15 types x 3 tier-columns (Lesser | Base | Greater). Perfect
//    is NOT stocked in this tab. Rows are 3 types wide; down-columns per Drew:
//      A: desert iron vision robust stone | B: glacial body rebirth adept ward
//      C: storm mind inspiration resolve charging. (charging has no Lesser tier.)
//  - PURPLE named runes: dense 9-col grid, rows y581/646/708 (R6 partial, R7/R8 full).
//
// "Hunt" @ (422,581) confirmed by Drew = farruls-rune-of-the-hunt.
// R6 left group (x=44,107,171,232) = the 4 "Greater Rune of X" crystals, L->R:
//   Leadership, Tithing, Alacrity, Nobility (confirmed by Drew). x=296,359 = decorative
//   GAP (no slots). R6 right (x=422,485,549) + R7/R8 = pantheon named runes.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).runesTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const STATIC_SLOTS = [
    // --- blue basic runes (lesser | base | greater) ---
    { cx: 34, cy: 255, apiId: 'lesser-desert-rune' },
    { cx: 97, cy: 255, apiId: 'desert-rune' },
    { cx: 160, cy: 255, apiId: 'greater-desert-rune' },
    { cx: 230, cy: 255, apiId: 'lesser-glacial-rune' },
    { cx: 293, cy: 255, apiId: 'glacial-rune' },
    { cx: 356, cy: 255, apiId: 'greater-glacial-rune' },
    { cx: 426, cy: 255, apiId: 'lesser-storm-rune' },
    { cx: 489, cy: 255, apiId: 'storm-rune' },
    { cx: 552, cy: 255, apiId: 'greater-storm-rune' },
    { cx: 34, cy: 318, apiId: 'lesser-iron-rune' },
    { cx: 97, cy: 318, apiId: 'iron-rune' },
    { cx: 160, cy: 318, apiId: 'greater-iron-rune' },
    { cx: 230, cy: 318, apiId: 'lesser-body-rune' },
    { cx: 293, cy: 318, apiId: 'body-rune' },
    { cx: 356, cy: 318, apiId: 'greater-body-rune' },
    { cx: 426, cy: 318, apiId: 'lesser-mind-rune' },
    { cx: 489, cy: 318, apiId: 'mind-rune' },
    { cx: 552, cy: 318, apiId: 'greater-mind-rune' },
    { cx: 34, cy: 381, apiId: 'lesser-vision-rune' },
    { cx: 97, cy: 381, apiId: 'vision-rune' },
    { cx: 160, cy: 381, apiId: 'greater-vision-rune' },
    { cx: 230, cy: 381, apiId: 'lesser-rebirth-rune' },
    { cx: 293, cy: 381, apiId: 'rebirth-rune' },
    { cx: 356, cy: 381, apiId: 'greater-rebirth-rune' },
    { cx: 426, cy: 381, apiId: 'lesser-inspiration-rune' },
    { cx: 489, cy: 381, apiId: 'inspiration-rune' },
    { cx: 552, cy: 381, apiId: 'greater-inspiration-rune' },
    { cx: 34, cy: 444, apiId: 'lesser-robust-rune' },
    { cx: 97, cy: 444, apiId: 'robust-rune' },
    { cx: 160, cy: 444, apiId: 'greater-robust-rune' },
    { cx: 230, cy: 444, apiId: 'lesser-adept-rune' },
    { cx: 293, cy: 444, apiId: 'adept-rune' },
    { cx: 356, cy: 444, apiId: 'greater-adept-rune' },
    { cx: 426, cy: 444, apiId: 'lesser-resolve-rune' },
    { cx: 489, cy: 444, apiId: 'resolve-rune' },
    { cx: 552, cy: 444, apiId: 'greater-resolve-rune' },
    { cx: 34, cy: 506, apiId: 'lesser-stone-rune' },
    { cx: 97, cy: 506, apiId: 'stone-rune' },
    { cx: 160, cy: 506, apiId: 'greater-stone-rune' },
    { cx: 230, cy: 506, apiId: 'lesser-ward-rune' },
    { cx: 293, cy: 506, apiId: 'ward-rune' },
    { cx: 356, cy: 506, apiId: 'greater-ward-rune' },
    { cx: 489, cy: 506, apiId: 'charging-rune' },
    { cx: 552, cy: 506, apiId: 'greater-charging-rune' },
    // --- purple named runes ---
    { cx: 44, cy: 581, apiId: 'greater-rune-of-leadership' },
    { cx: 107, cy: 581, apiId: 'greater-rune-of-tithing' },
    { cx: 171, cy: 581, apiId: 'greater-rune-of-alacrity' },
    { cx: 232, cy: 581, apiId: 'greater-rune-of-nobility' },
    { cx: 422, cy: 581, apiId: 'farruls-rune-of-the-hunt' },
    { cx: 485, cy: 581, apiId: 'thane-myrks-rune-of-summer' },
    { cx: 549, cy: 581, apiId: 'lady-hestras-rune-of-winter' },
    { cx: 44, cy: 646, apiId: 'thane-lelds-rune-of-spring' },
    { cx: 107, cy: 646, apiId: 'fenumus-rune-of-agony' },
    { cx: 171, cy: 646, apiId: 'thane-girts-rune-of-wildness' },
    { cx: 232, cy: 646, apiId: 'hedgewitch-assandras-rune-of-wisdom' },
    { cx: 296, cy: 646, apiId: 'saqawals-rune-of-the-sky' },
    { cx: 359, cy: 646, apiId: 'the-greatwolfs-rune-of-willpower' },
    { cx: 422, cy: 646, apiId: 'craiceanns-rune-of-recovery' },
    { cx: 485, cy: 646, apiId: 'craiceanns-rune-of-warding' },
    { cx: 549, cy: 646, apiId: 'countess-seskes-rune-of-archery' },
    { cx: 44, cy: 708, apiId: 'saqawals-rune-of-erosion' },
    { cx: 107, cy: 708, apiId: 'saqawals-rune-of-memory' },
    { cx: 171, cy: 708, apiId: 'the-greatwolfs-rune-of-claws' },
    { cx: 232, cy: 708, apiId: 'courtesan-mannans-rune-of-cruelty' },
    { cx: 296, cy: 708, apiId: 'thane-grannells-rune-of-mastery' },
    { cx: 359, cy: 708, apiId: 'fenumus-rune-of-spinning' },
    { cx: 422, cy: 708, apiId: 'fenumus-rune-of-draining' },
    { cx: 485, cy: 708, apiId: 'farruls-rune-of-grace' },
    { cx: 549, cy: 708, apiId: 'farruls-rune-of-the-chase' },
  ];

  const EMPTY_STATIC_TODO = []; // R6 unknown slots pending a capture (see header)

  return { tab: 'runes', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
