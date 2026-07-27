# Stash Net-Worth Calculator — Handoff

Feature #1 for ~2.4. Reads PoE2 **special stash tabs** off-screen and totals their value.
Written for a fresh agent with zero prior context. Terse operational doc; "why" is in code
comments. **Everything rides into 2.4 — no version bump, no release.**

## User flow
F6 overlay → **Net Worth** tab. Open a special stash tab in-game, press **F7** (or Capture).
App screen-captures → detects which tab (template match) → OCRs each slot's count → prices via
live poe2scout → adds a row to a running tally (per-tab + grand total). Flip tabs, F7 each;
re-capturing a tab updates its row. Item-sort toggle (value / stash layout) persists in config.

## STATUS (2026-07-26)
**Committed on `master`.** 9 tabs fully working (detect + read + price):
Currency, Abyss, Essence, Runes, Kalguuran Runes, Ritual, Soul Cores, Idols, Ancient Augments.
- **Detection = template match** (tab-detect.js) — fill/darkness independent, resolution-ready.
  Replaced the old read-fraction/offset-search (deleted). Sparse tabs (e.g. a 1-item AA) detect.
- All 9 maps Drew-verified. Prices via the FULL 17-category catalog (theses=incursion, gaze=abyss,
  emergent/carved=expedition, raven-touched-shard=ritual, etc.).

**NOT mapped yet (detect-only templates exist, no read map):** **Delirium, Breach, Expedition.**
They correlate as tabs but have no `*-tab-map.js`, so the worker returns `mismatch{unsupported}`.
Breach: catalysts only (skip wombgifts, per Drew).

**Deferred:** currency dynamic bottom rows; calibration UI (for non-1080 resolutions).

## Architecture (current)
- **`renderer/stash/tab-detect.js`** — template-match detector (pure JS, runs in worker).
  `panelSignature(buf,W,H,box,tw,th)` = box-downsample the panel to a TWxTH edge-thumbnail,
  L2-normalized. `detect(buf,W,H,calBox,templatesJSON)` → `{tab,score,runnerUp,runnerScore}` by
  NCC vs each baked template. `scalePos(cx,cy,refBox,calBox)` maps a reference cell coord into the
  live calibration box. NO per-cell CV at runtime — cell positions come from the map, scaled.
- **`renderer/stash/tab-templates.json`** — `{box (reference panel rect {x:18,y:168,w:582,h:606}),
  tw:64, th:66, scale:1000, templates:{tab:[int-scaled edge-thumbnail]}}`. 12 templates
  (9 mapped + delirium/breach/expedition). Regenerate: capture refs then run the gen script that
  uses `tab-detect.panelSignature` (see "Adding a tab"). Raw ref PNGs live in
  `dev/stash-matcher/refs/` (gitignored, ~2MB each).
- **`renderer/stash/<tab>-tab-map.js`** — one per mapped tab. Exports
  `{ tab, captureSize:{w:1920,h:1080}, STATIC_SLOTS:[{cx,cy,apiId}], EMPTY_STATIC_TODO, readParams? }`.
  cx,cy = stack-number center in the 1920x1080 reference frame. `readParams` optionally overrides
  digit-reader DEFAULTS per tab (e.g. Kalguuran `{stripWidth:12}` — art bleeds flush against counts).
- **`renderer/stash/digit-reader.js`** — the OCR (pure JS, UMD). `valueChannelDesatMax`, `readCell`,
  `templatesFromJSON`, `DEFAULTS{floor:122,up:12,dn:12,stripWidth:15,iouThresh:0.76,...}`.
  Tuning that shipped: `overlaps()` tolerates ≤1px kerning slop (fixes "41"→"4").
- **`renderer/stash/digit-templates.json`** — baked 0-9 glyphs (currency screenshot, desat-max).
- **`renderer/stash/reader-worker.js`** — worker thread. `TABS`={9 maps}. On message
  `{bitmap,W,H,calBox}`: `TD.detect` → if score<0.3 mismatch; if detected tab has no map →
  `mismatch{unsupported,detectedTab}`; else post `{phase:'detected',tab}`, then read every slot at
  `TD.scalePos(...)` and post `{ok,tab,reads,readCount,slotCount}`. **Register a new tab in `TABS`.**
- **`renderer/stash/networth-ui.js`** — the panel. `TAB_LABEL` map (add new tabs here), tally,
  accordion, include/exclude, drag-reorder, dup-tabs modal, sort toggle, flags line. `window.NetWorth`.
- **`main.js`** — `doStashCapture`→`runReaderWorker` (transfers frame + `calBox:config.stashCalibration||null`),
  `captureAndBroadcast`, `getStashPriceMap`→`fetchFullCatalog` (all 17 cats, 5-min cache),
  `getCurrencyCategories` (`/Items/Categories`). DEFAULT_CONFIG: `stashHotkey`, `stashDupTabs`,
  `stashSortLayout`, `stashCalibration`(null). IPC `set-stash-dup`/`set-stash-sort`.
- `preload.js`, `renderer/index.html` (#tab-networth), `renderer/item/item-tab.js` setTab('networth').
- **`renderer/stash/icon-matcher.js`** — kept for the deferred dynamic currency rows; NOT used by
  detection anymore.

## KEY FACTS (don't relearn the hard way)
1. **SCREEN capture, not window** (`desktopCapturer types:['screen']`); window grabs of the DirectX
   game corrupt glyphs. Live frame 1920x1080, game windowed top-left → panel at the reference box.
2. **desat-max channel:** `V=(max-min<=40)?max:0` — isolates flat-white counts from saturated art.
3. **Detection is template match, NOT fill-counting** — matches the frame LAYOUT, so it works
   empty↔full. Cross-tab margins 0.51-0.90. Confusable cluster: soulcore/idol/AA (all Augment,
   similar grids) at ~0.49 runner-up — still clears. If ever mislabeled, the highlighted subtab
   icon (inside the cropped panel) is the tiebreak.
4. **Resolution:** detection is scale-robust (downsamples the calBox). Reading currently assumes
   the reference resolution (calBox=null→reference box; digit templates are fixed-size). Full
   non-1080 support = the calibration UI + scaling the digit templates (Phase 2, see NEXT UP).
5. **Pricing:** `getStashPriceMap`→`fetchFullCatalog` over ALL 17 categories. Everything in these
   tabs is a currency item and prices this way (Drew's rule: it's all one currency feature). Only
   genuinely-unlisted: panther/stoat/hawk idols (untradeable). League `Runes of Aldur`.
6. **No silent misses:** unreadable/empty slots → "?" → null count → flagged + excluded, never guessed.
7. **Cells are STATIC + regular** (Drew's key insight). Constant cell pitch (~63px). Rows with fewer
   cells than the widest are CENTERED (offset a half-cell) — see soulcore/idol maps.

## Adding a tab (current workflow — e.g. DELIRIUM next)
The template already detects delirium/breach/expedition; they just need a read map.
1. **Reference already captured** at `dev/stash-matcher/refs/delirium.png` (also breach, expedition).
   To recapture: `REF=<tab> npx electron` a capref script that screen-grabs + saves to refs/.
2. **Establish the grid.** Cells are static + regular. Crop/zoom the ref (nativeImage) to measure
   column x's + row y's (number-center = top-left of each cell). Watch for centered short rows
   (half-cell offset) and multi-section layouts (different pitch per section — see idol tab).
3. **Get identities from Drew** (label by row). Resolve names → apiIds against the FULL catalog
   (17 cats). Delirium category = `delirium`.
4. **Bake `renderer/stash/delirium-tab-map.js`** (same shape as the others). Read counts at the
   grid to self-verify against the visible tab (the distinctive counts are the check).
5. **Wire:** add to `reader-worker.js` `TABS` + `networth-ui.js` `TAB_LABEL`. (Detection template is
   already baked; no template regen needed unless the ref changed.)
6. **Test** `npx electron scripts/test-stash-detect.js` (live: detect+read+price), then F7 in-app.
7. **Commit** (`~2.4 #1`, Co-Authored-By trailer). Relaunching the dev app is the agent's job
   (kill electron.exe first, NEVER the game `PathOfExile_x64Steam.exe`); never tell Drew to npm start.

## NEXT UP
1. **Delirium** — map it (workflow above). Then **Breach** (catalysts only, skip wombgifts) and
   **Expedition**. All three already detect; just need maps + wiring.
2. **Calibration UI** (resolution bridge) — a draggable box the user drops on the stash panel border
   once → store `config.stashCalibration={x,y,w,h}`. Then detection + reading scale into it. Also
   needs the digit templates rescaled by calBox/refBox for non-1080. Detection already supports it
   (pass calBox); reading needs the digit-template scaling.
3. **Currency dynamic bottom rows** (deferred) — 2 rows of arbitrary currency; runtime icon-match
   (`renderer/stash/icon-matcher.js`, proto `dev/stash-matcher/match-dynamic-rows.js`). Needs a
   fresh capture + confidence-flag + click-to-fill.

## Test commands
- `npm run test:stash` — digit-reader self-check on the reference currency screenshot (expect 48/49).
- `npx electron scripts/test-stash-detect.js` — live detect + read + full-catalog price (game open).

## Gotchas / preferences
- `screenshots/` + `dev/stash-matcher/refs/` are gitignored (large PNGs).
- Drew's style: brief; template/layout-first (don't over-engineer detection with per-cell CV — that
  was a dead end); no dead code left behind; NO em-dashes in user-facing copy; ask before build/
  release except an explicit "cut vX". Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Layout labels saved: `dev/stash-matcher/kalguuran-layout.md`, `ritual-layout.md`.
