'use strict';
// Static slot -> currency map for the PoE2 Currency stash tab.
// The tab is fixed-layout: every slot always holds the same currency for every
// player (empty if you own 0). So identity is by POSITION, not pixels.
// Coords are the stack-count number center (cx,cy) at 1920x1032 native capture
// — the same anchor the digit reader uses. Verified against a live tab
// (POE2-VibeTools, Runes of Aldur, 2026-07-25).
//
// The 2 BOTTOM 7-wide rows are DYNAMIC (arbitrary contents) — not here; they
// need icon identification and are handled separately.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).currencyTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // { cx, cy, apiId }  — apiId matches the poe2scout catalog slug.
  const STATIC_SLOTS = [
    // top row — Transmutation (base/greater/perfect), Alchemy, Vaal, Annul, Jeweller's (lesser/greater/perfect)
    { cx: 50, cy: 209, apiId: 'transmute' },
    { cx: 108, cy: 209, apiId: 'greater-orb-of-transmutation' },
    { cx: 164, cy: 209, apiId: 'perfect-orb-of-transmutation' },
    { cx: 240, cy: 208, apiId: 'alch' },
    { cx: 301, cy: 209, apiId: 'vaal' },
    { cx: 378, cy: 209, apiId: 'annul' },
    { cx: 438, cy: 209, apiId: 'lesser-jewellers-orb' },
    { cx: 495, cy: 209, apiId: 'greater-jewellers-orb' },
    { cx: 550, cy: 208, apiId: 'perfect-jewellers-orb' },
    // 2nd row — Augmentation (b/g/p), Chance, Fracturing, Divine, Artificer's Orb
    { cx: 47, cy: 271, apiId: 'aug' },
    { cx: 107, cy: 271, apiId: 'greater-orb-of-augmentation' },
    { cx: 161, cy: 272, apiId: 'perfect-orb-of-augmentation' },
    { cx: 240, cy: 272, apiId: 'chance' },
    { cx: 300, cy: 272, apiId: 'fracturing-orb' },
    { cx: 368, cy: 271, apiId: 'divine' },
    { cx: 554, cy: 271, apiId: 'artificers' },
    // 3rd row — Regal (b/g/p). Mirror + Hinekora's Lock slots sit here too but were
    // empty in the reference tab; their coords are TODO (add on next capture that has them).
    { cx: 51, cy: 334, apiId: 'regal' },
    { cx: 104, cy: 334, apiId: 'greater-regal-orb' },
    { cx: 159, cy: 334, apiId: 'perfect-regal-orb' },
    // offset row — Arcanist's Etcher, Armourer's Scrap, Blacksmith's Whetstone
    { cx: 429, cy: 354, apiId: 'etcher' },
    { cx: 491, cy: 353, apiId: 'scrap' },
    { cx: 555, cy: 354, apiId: 'whetstone' },
    // 4th row — Exalted (b/g/p)
    { cx: 54, cy: 397, apiId: 'exalted' },
    { cx: 106, cy: 397, apiId: 'greater-exalted-orb' },
    { cx: 163, cy: 397, apiId: 'perfect-exalted-orb' },
    // offset row — Glassblower's Bauble, Gemcutter's Prism
    { cx: 489, cy: 416, apiId: 'bauble' },
    { cx: 556, cy: 416, apiId: 'gcp' },
    // 5th row — Chaos (b/g/p)
    { cx: 53, cy: 460, apiId: 'chaos' },
    { cx: 101, cy: 461, apiId: 'greater-chaos-orb' },
    { cx: 157, cy: 460, apiId: 'perfect-chaos-orb' },
    // offset row — Scroll of Wisdom
    { cx: 553, cy: 498, apiId: 'wisdom' },
    // shard row — Transmutation / Regal / Chance / Artificer's shards
    { cx: 200, cy: 581, apiId: 'transmutation-shard' },
    { cx: 264, cy: 580, apiId: 'regal-shard' },
    { cx: 328, cy: 581, apiId: 'chance-shard' },
    { cx: 390, cy: 581, apiId: 'artificers-shard' },
  ];

  // Known static slots that were empty in the reference tab (coords TBD via a
  // future capture that has them filled). Listed so we don't forget they exist.
  const EMPTY_STATIC_TODO = ['mirror', 'hinekoras-lock'];

  // The 2 dynamic bottom rows: contents are arbitrary -> icon match required.
  // Row anchors (y) known; per-cell identification deferred to the icon matcher.
  const DYNAMIC_ROWS = [
    { y: 650, xs: [127, 184, 241, 299, 353, 412, 468] },
    { y: 706, xs: [128, 181, 240, 297, 355, 413, 473] },
  ];

  return {
    tab: 'currency',
    captureSize: { w: 1920, h: 1032 },
    STATIC_SLOTS,
    EMPTY_STATIC_TODO,
    DYNAMIC_ROWS,
  };
});
