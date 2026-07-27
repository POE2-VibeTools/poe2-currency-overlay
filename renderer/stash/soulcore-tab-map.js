'use strict';
// Static slot -> soul core map for the PoE2 Augment tab, subtab 3 "Soul Cores" (fixed grid).
// Coords = stack-count number center, LIVE 1920x1080 frame. Identities Drew-verified 2026-07-26.
// Regular grid, constant cell pitch (~63). 8-cell rows (1,3) start at x75; 7-cell rows (2,4)
// are CENTERED, so offset +half a cell (start x107) - Drew's key layout insight. Rows y 362/
// 424/534/600. Base cores (rows 1-2, soul-core-of-<name>) + named cores (rows 3-4,
// <owner>s-soul-core-of-<effect>). All 30 read clean.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Stash = root.Stash || {}).soulcoreTabMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STATIC_SLOTS = [
    { cx: 75, cy: 362, apiId: 'soul-core-of-topotante' },
    { cx: 138, cy: 362, apiId: 'soul-core-of-tacati' },
    { cx: 201, cy: 362, apiId: 'soul-core-of-opiloti' },
    { cx: 264, cy: 362, apiId: 'soul-core-of-jiquani' },
    { cx: 327, cy: 362, apiId: 'soul-core-of-zalatl' },
    { cx: 390, cy: 362, apiId: 'soul-core-of-citaqualotl' },
    { cx: 453, cy: 362, apiId: 'soul-core-of-puhuarte' },
    { cx: 516, cy: 362, apiId: 'soul-core-of-tzamoto' },
    { cx: 107, cy: 424, apiId: 'soul-core-of-xopec' },
    { cx: 170, cy: 424, apiId: 'soul-core-of-quipolatl' },
    { cx: 233, cy: 424, apiId: 'soul-core-of-ticaba' },
    { cx: 296, cy: 424, apiId: 'soul-core-of-atmohua' },
    { cx: 359, cy: 424, apiId: 'soul-core-of-cholotl' },
    { cx: 422, cy: 424, apiId: 'soul-core-of-zantipi' },
    { cx: 485, cy: 424, apiId: 'soul-core-of-azcapa' },
    { cx: 75, cy: 534, apiId: 'atmohuas-soul-core-of-retreat' },
    { cx: 138, cy: 534, apiId: 'hayoxis-soul-core-of-heatproofing' },
    { cx: 201, cy: 534, apiId: 'zalatls-soul-core-of-insulation' },
    { cx: 264, cy: 534, apiId: 'topotantes-soul-core-of-dampening' },
    { cx: 327, cy: 534, apiId: 'cholotls-soul-core-of-war' },
    { cx: 390, cy: 534, apiId: 'quipolatls-soul-core-of-flow' },
    { cx: 453, cy: 534, apiId: 'tzamotos-soul-core-of-ferocity' },
    { cx: 516, cy: 534, apiId: 'uromotis-soul-core-of-attenuation' },
    { cx: 107, cy: 600, apiId: 'opilotis-soul-core-of-assault' },
    { cx: 170, cy: 600, apiId: 'guatelitzis-soul-core-of-endurance' },
    { cx: 233, cy: 600, apiId: 'xopecs-soul-core-of-power' },
    { cx: 296, cy: 600, apiId: 'estazuntis-soul-core-of-convalescence' },
    { cx: 359, cy: 600, apiId: 'tacatis-soul-core-of-affliction' },
    { cx: 422, cy: 600, apiId: 'xipocados-soul-core-of-dominion' },
    { cx: 485, cy: 600, apiId: 'citaqualotls-soul-core-of-foulness' },
  ];
  const EMPTY_STATIC_TODO = [];
  return { tab: 'soulcore', captureSize: { w: 1920, h: 1080 }, STATIC_SLOTS, EMPTY_STATIC_TODO };
});
