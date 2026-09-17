'use strict';
// Static slot -> soul core map for the PoE2 Rune tab, subtab 3 "Soul Cores" (fixed grid).
// Coords are REFERENCE-frame (REF_BOX in main.js), which is what TD.scalePos expects -
// it maps them into whatever box the finder locates live. Measuring in a live frame and
// storing THAT is the trap: the reads come out plausible but wrong (a 1 read as 11).
//
// RE-MEASURED for 0.5.5 (Forbidden Rites), which re-laid-out this tab: 30 slots in 4
// rows became 47 in 7, the whole grid moved up (~90px) and the cell pitch widened
// 63 -> 67.5. The stale map did not fail loudly - the panel signature stopped matching
// and detection fell through to OTHER tabs (ancient-augment, then idol), so the tab
// read 1 line instead of 30. Re-bake tab-templates.json alongside any change here:
//   dev/stash-matcher/bake-tab-template.js --tab soulcore --img <capture> --box 21,157,619,647
//
// Layout: 7 rows, 8/7/8/7/7/6/4. Odd rows of 8 start at x77; rows of 7 are CENTERED so
// they sit half a cell in (x111); row 6 (6 cells) and row 7 (4 cells) step in further.
// Groups: rows 1-2 = 15 base cores, rows 3-4 = 15 original named, rows 5-6 = 13
// Jiquani's (new in 0.5.5), row 7 = 4 Atziri's (new, socket-bound, gold-bordered tier).
//
// Rows 1-4 identities are the July 2026 Drew-verified order, unchanged (0.5.5 appended
// rather than reordered). Rows 5-7 identities Drew-verified 2026-09-17 by reading the
// tab left-to-right, top-to-bottom; that order matches GGG's own item ordering.
//
// Coords were FITTED, not eyeballed: cell centres came from connected-component
// detection of the slot interiors, then the count-badge offset was swept against a
// capture with known counts. 126 offsets read 47/47; (-20,-16) from cell centre is the
// centre of that plateau, so the map has ~10px horizontal and ~2px vertical slack.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).soulcoreTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STATIC_SLOTS = [
    { cx: 71, cy: 262, apiId: 'soul-core-of-topotante' },
    { cx: 134, cy: 262, apiId: 'soul-core-of-tacati' },
    { cx: 198, cy: 262, apiId: 'soul-core-of-opiloti' },
    { cx: 261, cy: 262, apiId: 'soul-core-of-jiquani' },
    { cx: 325, cy: 262, apiId: 'soul-core-of-zalatl' },
    { cx: 388, cy: 262, apiId: 'soul-core-of-citaqualotl' },
    { cx: 451, cy: 262, apiId: 'soul-core-of-puhuarte' },
    { cx: 514, cy: 262, apiId: 'soul-core-of-tzamoto' },
    { cx: 103, cy: 325, apiId: 'soul-core-of-xopec' },
    { cx: 166, cy: 325, apiId: 'soul-core-of-quipolatl' },
    { cx: 230, cy: 325, apiId: 'soul-core-of-ticaba' },
    { cx: 293, cy: 325, apiId: 'soul-core-of-atmohua' },
    { cx: 356, cy: 325, apiId: 'soul-core-of-cholotl' },
    { cx: 419, cy: 325, apiId: 'soul-core-of-zantipi' },
    { cx: 483, cy: 325, apiId: 'soul-core-of-azcapa' },
    { cx: 71, cy: 407, apiId: 'atmohuas-soul-core-of-retreat' },
    { cx: 134, cy: 407, apiId: 'hayoxis-soul-core-of-heatproofing' },
    { cx: 198, cy: 407, apiId: 'zalatls-soul-core-of-insulation' },
    { cx: 261, cy: 407, apiId: 'topotantes-soul-core-of-dampening' },
    { cx: 325, cy: 407, apiId: 'cholotls-soul-core-of-war' },
    { cx: 388, cy: 407, apiId: 'quipolatls-soul-core-of-flow' },
    { cx: 451, cy: 407, apiId: 'tzamotos-soul-core-of-ferocity' },
    { cx: 514, cy: 407, apiId: 'uromotis-soul-core-of-attenuation' },
    { cx: 103, cy: 471, apiId: 'opilotis-soul-core-of-assault' },
    { cx: 166, cy: 471, apiId: 'guatelitzis-soul-core-of-endurance' },
    { cx: 230, cy: 471, apiId: 'xopecs-soul-core-of-power' },
    { cx: 293, cy: 471, apiId: 'estazuntis-soul-core-of-convalescence' },
    { cx: 356, cy: 471, apiId: 'tacatis-soul-core-of-affliction' },
    { cx: 419, cy: 471, apiId: 'xipocados-soul-core-of-dominion' },
    { cx: 483, cy: 471, apiId: 'citaqualotls-soul-core-of-foulness' },
    { cx: 103, cy: 553, apiId: 'jiquanis-soul-core-of-automation' },
    { cx: 166, cy: 553, apiId: 'jiquanis-soul-core-of-malediction' },
    { cx: 230, cy: 553, apiId: 'jiquanis-soul-core-of-targeting' },
    { cx: 293, cy: 553, apiId: 'jiquanis-soul-core-of-rallying' },
    { cx: 356, cy: 553, apiId: 'jiquanis-soul-core-of-radiance' },
    { cx: 419, cy: 553, apiId: 'jiquanis-soul-core-of-severing' },
    { cx: 483, cy: 553, apiId: 'jiquanis-soul-core-of-rippling' },
    { cx: 134, cy: 616, apiId: 'jiquanis-soul-core-of-quaking' },
    { cx: 198, cy: 616, apiId: 'jiquanis-soul-core-of-munitions' },
    { cx: 261, cy: 616, apiId: 'jiquanis-soul-core-of-snares' },
    { cx: 325, cy: 616, apiId: 'jiquanis-soul-core-of-abundance' },
    { cx: 388, cy: 616, apiId: 'jiquanis-soul-core-of-squalls' },
    { cx: 451, cy: 616, apiId: 'jiquanis-soul-core-of-thundering' },
    { cx: 198, cy: 698, apiId: 'atziris-soul-core-of-devotion' },
    { cx: 261, cy: 698, apiId: 'atziris-soul-core-of-vitality' },
    { cx: 325, cy: 698, apiId: 'atziris-soul-core-of-alacrity' },
    { cx: 388, cy: 698, apiId: 'atziris-soul-core-of-inoculation' },
  ];
  const EMPTY_STATIC_TODO = [];
  return { tab: 'soulcore', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
