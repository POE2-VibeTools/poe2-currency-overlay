'use strict';
// Static slot -> currency map for the PoE2 Abyss stash tab (fixed layout).
// Top diamond = abyss drops (Kulemak's Invitation, Cranium, Jawbones, Collarbones,
// Ribs); bottom row = abyss Omens. Coords are the stack-count number center at
// 1920x1032 native capture. Verified against a live tab (Runes of Aldur, 2026-07).
//
// TODO: the 4 Gazes (kurgals/tecrods/ulamans/amanamus) and the empty diamond slot
// below the ribs weren't owned in the reference capture - add their coords from a
// future capture that has them. Pricing spans all categories, so apiIds from
// abyss/ritual/fragments all resolve.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).abyssTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const STATIC_SLOTS = [
    // top: Kulemak's Invitation
    { cx: 295, cy: 239, apiId: 'kulemaks-invitation' },
    // Preserved Cranium
    { cx: 293, cy: 331, apiId: 'preserved-cranium' },
    // Jawbones: gnawed / preserved / ancient
    { cx: 232, cy: 392, apiId: 'gnawed-jawbone' },
    { cx: 300, cy: 392, apiId: 'preserved-jawbone' },
    { cx: 361, cy: 393, apiId: 'ancient-jawbone' },
    // Collarbones: gnawed / preserved / ancient / altered
    { cx: 201, cy: 454, apiId: 'gnawed-collarbone' },
    { cx: 268, cy: 454, apiId: 'preserved-collarbone' },
    { cx: 325, cy: 454, apiId: 'ancient-collarbone' },
    { cx: 387, cy: 454, apiId: 'altered-collarbone' },
    // Ribs: gnawed / preserved / ancient
    { cx: 234, cy: 517, apiId: 'gnawed-rib' },
    { cx: 304, cy: 517, apiId: 'preserved-rib' },
    { cx: 363, cy: 516, apiId: 'ancient-rib' },
    // Preserved Vertebrae (empty in ref; not on market yet -> flags "no price")
    { cx: 304, cy: 580, apiId: 'preserved-vertebrae' },
    // bottom row: Omens
    { cx: 85, cy: 670, apiId: 'omen-of-abyssal-echoes' },
    { cx: 140, cy: 671, apiId: 'omen-of-the-sovereign' },
    { cx: 204, cy: 671, apiId: 'omen-of-the-liege' },
    { cx: 270, cy: 670, apiId: 'omen-of-the-blackblooded' },
    { cx: 332, cy: 671, apiId: 'omen-of-putrefaction' },
    { cx: 391, cy: 671, apiId: 'omen-of-light' },
    { cx: 454, cy: 671, apiId: 'omen-of-sinistral-necromancy' },
    { cx: 515, cy: 671, apiId: 'omen-of-dextral-necromancy' },
  ];

  const EMPTY_STATIC_TODO = ['kurgals-gaze', 'tecrods-gaze', 'ulamans-gaze', 'amanamus-gaze'];

  return { tab: 'abyss', captureSize: { w: 1920, h: 1032 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
