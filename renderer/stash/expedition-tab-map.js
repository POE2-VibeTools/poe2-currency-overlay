'use strict';
// Static slot -> item map for the PoE2 Expedition stash tab. Coords = stack-count number
// center in the LIVE 1920x1080 desktopCapturer frame. Identities Drew-verified 2026-07-27;
// owned counts OCR-confirmed at digit-reader DEFAULTS (31/31), empties read "?".
//
// The tab's items span several poe2scout categories (that's fine - getStashPriceMap merges
// all 17): sagas + fluxes are [expedition]; Verisium/Crests/Alloys are [verisium]; the two
// Triskelion items aren't in poe2scout at all and price off GGG's CX feed (see main.js
// CX_FALLBACK: shattered-triskelion, the-triskelion-reforged).
//
// Layout (top -> bottom):
//   top row (6) : Expedition Logbook + the 5 Sagas (Aldur's/Medved's/Vorana's/Uhtred's/Olroth's)
//   R2 (2)      : Shattered Triskelion + The Triskelion Reforged (large 2x2 slots; Reforged
//                 empty for Drew -> count position estimated, revisit when non-empty)
//   R3 (3)      : Verisium / Exceptional / Liquid Verisium
//   R4 (4)      : the 4 Crests (Medved's Circle, Vorana's Scythe, Uhtred's Chalice, Olroth's Sun)
//   R5 (7),R6(6): the 13 Alloys (R6 centered over R5)
//   R7 (4)      : the elemental Fluxes (Blazing/Chilling/Crackling/Void)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).expeditionTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const STATIC_SLOTS = [
    // top row: logbook + 5 sagas
    { cx: 139, cy: 233, apiId: 'expedition-logbook' },
    { cx: 212, cy: 233, apiId: 'aldurs-saga' },
    { cx: 275, cy: 233, apiId: 'medveds-saga' },
    { cx: 335, cy: 233, apiId: 'voranas-saga' },
    { cx: 397, cy: 233, apiId: 'uhtreds-saga' },
    { cx: 462, cy: 233, apiId: 'olroths-saga' },
    // R2: Triskelion pair (large 2x2 slots)
    { cx: 214, cy: 322, apiId: 'shattered-triskelion' },
    { cx: 327, cy: 322, apiId: 'the-triskelion-reforged' }, // count position verified live 2026-07-27
    // R3: Verisium tiers
    { cx: 209, cy: 441, apiId: 'verisium' },
    { cx: 270, cy: 441, apiId: 'exceptional-verisium' },
    { cx: 394, cy: 441, apiId: 'liquid-verisium' },
    // R4: Crests
    { cx: 212, cy: 503, apiId: 'medveds-crest-of-the-circle' },
    { cx: 266, cy: 503, apiId: 'voranas-crest-of-the-scythe' },
    { cx: 333, cy: 503, apiId: 'uhtreds-crest-of-the-chalice' },
    { cx: 396, cy: 503, apiId: 'olroths-crest-of-the-sun' },
    // R5: Alloys (7)
    { cx: 106, cy: 573, apiId: 'runic-alloy' },
    { cx: 168, cy: 573, apiId: 'adaptive-alloy' },
    { cx: 233, cy: 573, apiId: 'protective-alloy' },
    { cx: 298, cy: 573, apiId: 'expansive-alloy' },
    { cx: 360, cy: 573, apiId: 'swift-alloy' },
    { cx: 424, cy: 573, apiId: 'cyclonic-alloy' },
    { cx: 485, cy: 573, apiId: 'prismatic-alloy' },
    // R6: Alloys (6, centered over R5)
    { cx: 139, cy: 637, apiId: 'mystic-alloy' },
    { cx: 201, cy: 637, apiId: 'sovereign-alloy' },
    { cx: 262, cy: 637, apiId: 'celestial-alloy' },
    { cx: 327, cy: 637, apiId: 'transcendent-alloy' },
    { cx: 389, cy: 637, apiId: 'the-runebinders-alloy' },
    { cx: 452, cy: 637, apiId: 'the-runefathers-alloy' },
    // R7: elemental Fluxes
    { cx: 202, cy: 705, apiId: 'blazing-flux' },
    { cx: 275, cy: 705, apiId: 'chilling-flux' },
    { cx: 329, cy: 705, apiId: 'crackling-flux' },
    { cx: 390, cy: 705, apiId: 'void-flux' },
  ];
  const EMPTY_STATIC_TODO = [];
  return { tab: 'expedition', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
