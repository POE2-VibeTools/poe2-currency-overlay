'use strict';
// Static slot -> rune map for the PoE2 Augment tab, subtab 2 "Kalguuran Runes".
// Coords = stack-count number center, LIVE 1920x1080 desktopCapturer frame.
// Grid geometry visually confirmed + identities Drew-verified 2026-07-26. Blanks
// resolved by family single-missing elimination + Drew buying the 4 cheap uniques.
// Number positions corrected -10px onto the digits (these silver/white rune icons
// bleed low-saturation art into a strip centered on the art-pulled detection centroid;
// reading -10 left lands on the pure-white count and drops the art). Reads all rows
// vs ground truth clean except a couple cells where art sits flush against the digit.
// Families: Warding (R1-3), Ancient (R4 + R5 left), Rune-of (R5 right + R6), uniques (R7-8).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).runesKalguuranTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const STATIC_SLOTS = [
    { cx: 139, cy: 253, apiId: 'warding-rune-of-reinforcement' },
    { cx: 202, cy: 253, apiId: 'warding-rune-of-protection' },
    { cx: 265, cy: 253, apiId: 'warding-rune-of-disintegration' },
    { cx: 328, cy: 253, apiId: 'warding-rune-of-desperation' },
    { cx: 391, cy: 253, apiId: 'warding-rune-of-courage' },
    { cx: 454, cy: 253, apiId: 'warding-rune-of-nourishment' },
    { cx: 139, cy: 316, apiId: 'warding-rune-of-symbiosis' },
    { cx: 202, cy: 316, apiId: 'warding-rune-of-stability' },
    { cx: 265, cy: 316, apiId: 'warding-rune-of-glancing' },
    { cx: 328, cy: 316, apiId: 'warding-rune-of-heart' },
    { cx: 391, cy: 316, apiId: 'warding-rune-of-annihilation' },
    { cx: 454, cy: 316, apiId: 'warding-rune-of-salvaging' },
    { cx: 173, cy: 380, apiId: 'warding-rune-of-armature' },
    { cx: 236, cy: 380, apiId: 'warding-rune-of-obsession' },
    { cx: 299, cy: 380, apiId: 'warding-rune-of-equinox' },
    { cx: 362, cy: 380, apiId: 'warding-rune-of-bodyguards' },
    { cx: 425, cy: 380, apiId: 'warding-rune-of-hollowing' },
    { cx: 46, cy: 449, apiId: 'ancient-rune-of-splinters' },
    { cx: 109, cy: 449, apiId: 'ancient-rune-of-dueling' },
    { cx: 173, cy: 449, apiId: 'ancient-rune-of-the-titan' },
    { cx: 236, cy: 449, apiId: 'ancient-rune-of-shattering' },
    { cx: 299, cy: 449, apiId: 'ancient-rune-of-prowess' },
    { cx: 362, cy: 449, apiId: 'ancient-rune-of-control' },
    { cx: 426, cy: 449, apiId: 'ancient-rune-of-discovery' },
    { cx: 489, cy: 449, apiId: 'ancient-rune-of-decay' },
    { cx: 552, cy: 449, apiId: 'ancient-rune-of-witchcraft' },
    { cx: 46, cy: 512, apiId: 'ancient-rune-of-the-horde' },
    { cx: 109, cy: 512, apiId: 'ancient-rune-of-animosity' },
    { cx: 173, cy: 512, apiId: 'ancient-rune-of-detonation' },
    { cx: 236, cy: 512, apiId: 'ancient-rune-of-retaliation' },
    { cx: 362, cy: 512, apiId: 'rune-of-vitality' },
    { cx: 426, cy: 512, apiId: 'rune-of-the-hunt' },
    { cx: 489, cy: 512, apiId: 'rune-of-acrobatics' },
    { cx: 552, cy: 512, apiId: 'rune-of-culmination' },
    { cx: 46, cy: 576, apiId: 'rune-of-renown' },
    { cx: 109, cy: 576, apiId: 'rune-of-accumulation' },
    { cx: 173, cy: 576, apiId: 'rune-of-foundations' },
    { cx: 236, cy: 576, apiId: 'rune-of-the-prism' },
    { cx: 299, cy: 576, apiId: 'rune-of-the-blossom' },
    { cx: 362, cy: 576, apiId: 'rune-of-consistency' },
    { cx: 426, cy: 576, apiId: 'rune-of-reach' },
    { cx: 489, cy: 576, apiId: 'rune-of-vital-flame' },
    { cx: 552, cy: 576, apiId: 'rune-of-confrontation' },
    { cx: 100, cy: 646, apiId: 'passion-of-aldur' },
    { cx: 163, cy: 646, apiId: 'breath-of-aldur' },
    { cx: 226, cy: 646, apiId: 'ire-of-aldur' },
    { cx: 289, cy: 646, apiId: 'betrayal-of-aldur' },
    { cx: 352, cy: 646, apiId: 'serles-triumph' },
    { cx: 415, cy: 646, apiId: 'cadigans-epiphany' },
    { cx: 478, cy: 646, apiId: 'astrids-creativity' },
    { cx: 48, cy: 707, apiId: 'uhtreds-sidereus' },
    { cx: 111, cy: 707, apiId: 'kolrs-hunt' },
    { cx: 174, cy: 707, apiId: 'voranas-carnage' },
    { cx: 237, cy: 707, apiId: 'thruds-might' },
    { cx: 300, cy: 707, apiId: 'medveds-tending' },
    { cx: 363, cy: 707, apiId: 'katlas-gloom' },
    { cx: 426, cy: 707, apiId: 'masterwork-rune' },
    { cx: 489, cy: 707, apiId: 'aldurs-legacy' },
  ];
  const EMPTY_STATIC_TODO = [];
  // These silver/white rune icons bleed low-saturation art flush against the count;
  // a tighter read window (stripWidth 12 vs default 15) drops it. Fits 2-digit counts
  // (Masterwork=10 reads fine); 3+ digit counts on these runes would clip (rare).
  const readParams = { stripWidth: 12 };
  return { tab: 'runes-kalguuran', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO, readParams };
});
