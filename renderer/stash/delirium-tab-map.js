'use strict';
// Static slot -> item map for the PoE2 Delirium stash tab. Fixed, symmetric left/right
// block layout; coords = stack-count number center in the LIVE 1920x1080 desktopCapturer
// frame. Identities Drew-verified 2026-07-27; counts auto-located via desat-max blob
// centroids then OCR-confirmed (all read clean at digit-reader DEFAULTS).
//
// Layout (top->bottom, left->right = reading order = slot index, drives the layout sort):
//   top pair  : Simulacrum Splinter, Simulacrum   (Map Fragments, priced via [fragments])
//   center    : Raven's Reflection (Map Fragment; trades via Ange but NOT indexed by
//               poe2scout -> currently no price. apiId is the poe2scout convention so it
//               auto-prices if they ever add it).
//   L/R blocks: the Liquid Emotions. Emotions only exist at the tiers the game grants them:
//               Ire/Guilt/Greed -> Diluted (+ Ancient Diluted); Disgust/Despair -> Liquid
//               (+ Ancient Liquid); Fear/Suffering/Isolation -> Concentrated (+ Ancient
//               Concentrated); Melancholy/Ferocity/Contempt -> Potent (+ Ancient Potent).
// Short rows are centered (half-cell offset) per the standard special-tab layout.
// The 3 recessed center slots are the Simulacrum assembly slots, not item cells (unmapped).
// Ancient Potent Liquid Contempt (bottom-right corner) is the priciest item in the tab and
// is currently empty for Drew -> mapped so it auto-counts when acquired; reads "?" (flagged)
// while empty. 94's number center sits at cy 240 (art bleeds 2px lower than the rest).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).deliriumTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const STATIC_SLOTS = [
    // top pair + center fragment
    { cx: 271, cy: 238, apiId: 'simulacrum-splinter' },
    { cx: 342, cy: 240, apiId: 'simulacrum' },
    { cx: 296, cy: 300, apiId: 'raven-s-reflection' },
    // R3: Diluted (Ire/Guilt/Greed) | Liquid Disgust/Despair, Concentrated Fear
    { cx: 95, cy: 369, apiId: 'diluted-liquid-ire' },
    { cx: 157, cy: 370, apiId: 'diluted-liquid-guilt' },
    { cx: 218, cy: 369, apiId: 'diluted-liquid-greed' },
    { cx: 381, cy: 370, apiId: 'liquid-disgust' },
    { cx: 445, cy: 369, apiId: 'liquid-despair' },
    { cx: 506, cy: 370, apiId: 'concentrated-liquid-fear' },
    // R4: Liquid Paranoia/Envy | Concentrated Suffering/Isolation
    { cx: 123, cy: 433, apiId: 'liquid-paranoia' },
    { cx: 187, cy: 433, apiId: 'liquid-envy' },
    { cx: 412, cy: 432, apiId: 'concentrated-liquid-suffering' },
    { cx: 473, cy: 432, apiId: 'concentrated-liquid-isolation' },
    // R5: Ancient Diluted (Ire/Guilt/Greed) | Ancient Liquid Disgust/Despair, Ancient Concentrated Fear
    { cx: 95, cy: 511, apiId: 'ancient-diluted-liquid-ire' },
    { cx: 158, cy: 512, apiId: 'ancient-diluted-liquid-guilt' },
    { cx: 218, cy: 511, apiId: 'ancient-diluted-liquid-greed' },
    { cx: 382, cy: 511, apiId: 'ancient-liquid-disgust' },
    { cx: 445, cy: 512, apiId: 'ancient-liquid-despair' },
    { cx: 506, cy: 512, apiId: 'ancient-concentrated-liquid-fear' },
    // R6: Ancient Liquid Paranoia/Envy | Ancient Concentrated Suffering/Isolation
    { cx: 122, cy: 575, apiId: 'ancient-liquid-paranoia' },
    { cx: 185, cy: 575, apiId: 'ancient-liquid-envy' },
    { cx: 410, cy: 574, apiId: 'ancient-concentrated-liquid-suffering' },
    { cx: 473, cy: 574, apiId: 'ancient-concentrated-liquid-isolation' },
    // R7: Potent (Melancholy/Ferocity/Contempt) | Ancient Potent (Melancholy/Ferocity/Contempt)
    { cx: 104, cy: 656, apiId: 'potent-liquid-melancholy' },
    { cx: 168, cy: 657, apiId: 'potent-liquid-ferocity' },
    { cx: 233, cy: 656, apiId: 'potent-liquid-contempt' },
    { cx: 361, cy: 656, apiId: 'ancient-potent-liquid-melancholy' },
    { cx: 424, cy: 656, apiId: 'ancient-potent-liquid-ferocity' },
    { cx: 487, cy: 656, apiId: 'ancient-potent-liquid-contempt' }, // empty for Drew -> reads "?"
  ];
  const EMPTY_STATIC_TODO = [];
  return { tab: 'delirium', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
