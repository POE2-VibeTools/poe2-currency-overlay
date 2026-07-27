# Stash Net-Worth Calculator — Handoff

Feature #1 for ~2.4. Reads PoE2 **special stash tabs** off-screen and totals their
value. This memo is written for a fresh agent with zero prior context. Read it, then
the referenced files. Terse on purpose — the "why" is in the code comments.

## What it does (user flow)
Open the F6 overlay → **Net Worth** tab. Open a special stash tab in-game, press **F7**
(or the Capture button). The app screen-captures, detects which tab it is, OCRs each
slot's stack count, prices it via the live poe2scout catalog, and adds a row to a
**running tally** (per-tab total + grand total). Flip tabs, press F7 each; re-capturing
a tab updates its row.

## STATUS (2026-07-26)
**Shipped & committed on `master`** (no version bump; rides into 2.4):
- Panel, F7 hotkey + button, running tally, per-row include/exclude + drag-reorder + ✕,
  "duplicate tabs" setting (replace-which/add-new modal), staged "Capturing…/Calculating…"
  feedback, worker-thread OCR (main stays responsive), offset caching (~0.1s repeat capture).
- **Tabs live: Currency, Abyss, Essence.**
- **Icon-matcher ported** to `renderer/stash/icon-matcher.js` (20/20 parity; validate with `node dev/stash-matcher/validate-matcher.js`).

**Not done:** Runes (5 subtabs), Ritual (labels ready, needs grid pinning), breach /
expedition / delirium / augments, and the **dynamic currency rows** (the matcher's real job).

## Architecture / files
- `renderer/stash/digit-reader.js` — the OCR. Pure JS on typed arrays: `valueChannelDesatMax`,
  `otsu`, 4-conn `components`, `slideMatch` (IoU), `readCell`, `extractTemplates`,
  `templatesFromJSON`, `DEFAULTS`. UMD (works in Node + browser + worker).
- `renderer/stash/digit-templates.json` — baked 0-9 glyph templates (from the reference
  currency screenshot, desat-max). Regenerate: `npm run` → `scripts/gen-stash-templates.js`.
- `renderer/stash/<tab>-tab-map.js` — one per tab (`currency`, `abyss`, `essence`). Exports
  `{ tab, captureSize, STATIC_SLOTS:[{cx,cy,apiId}] }`. cx,cy = stack-number center.
- `renderer/stash/currency-prices.sample.json` — price snapshot (test fixture only; runtime
  uses live prices).
- `renderer/stash/reader-worker.js` — worker thread. Requires digit-reader + all tab maps +
  templates. Detects which tab (best-matching layout via anchor coarse-to-fine search, honors
  an offset `hint`), reads all slots, posts staged messages. **Register new tabs in its `TABS`.**
- `renderer/stash/networth-ui.js` — the panel (renderer). Tally state, accordion rows,
  include/exclude, drag-reorder, dup-tabs modal, staged-event handlers. `window.NetWorth`.
- `main.js` — screen capture + pricing + IPC. Key bits: `doStashCapture(onDetected)`,
  `runReaderWorker` (transfers the frame, caches `stashOffsetHint`), `captureAndBroadcast`
  (emits `stash-capturing`/`stash-detected`/`stash-captured`), `registerStashHotkey` (F7),
  `getStashPriceMap` (builds apiId→{price,icon,name} from `fetchFullCatalog`, 5-min cache),
  IPC `stash-capture-start` / `set-stash-dup`. DEFAULT_CONFIG: `stashHotkey`, `stashDupTabs`.
- `preload.js` — `stashCaptureStart`, `onStashCapturing/Detected/Captured`, `setStashDupTabs`.
- `renderer/index.html` — `#tab-networth` button + `#networth-root`; loads networth-ui.js.
- `renderer/item/item-tab.js` `setTab()` — handles `'networth'`; `renderer/styles.css` — `.nw-*`.

## Data flow (one capture)
F7/button → `stash-capture-start` → `captureAndBroadcast` → send `stash-capturing` →
`doStashCapture`: hide overlay (setOpacity 0) → `desktopCapturer` **screen** grab → send frame
to worker with cached offset hint → worker detects tab + reads slots → main applies live prices
→ send `stash-captured{tab,lines,totalEx,totalDiv,flags,...}` → panel folds into tally.

## KEY TECHNICAL FACTS (don't relearn these the hard way)
1. **SCREEN capture, not window.** `desktopCapturer` *window* grab of a DirectX game is soft
   and corrupts glyphs (~50% reads); *screen* grab (`types:['screen']`) is crisp. Live frame is
   1920x1080; game windowed at top-left → panel lands ~at reference coords (offset ~0).
2. **desat-max value channel:** `V = (max(R,G,B) - min(R,G,B) <= 40) ? max(R,G,B) : 0`. Stack
   numbers are flat white (low saturation); gold/blue icon art is saturated → zeroed. Plain
   max(R,G,B) treats gold icons as ink and floods the binary. This was THE unlock for reading.
3. **Templates are glyphs 0-9**, same font every tab, so one baked set works everywhere.
   `stripWidth` in DEFAULTS is 15 (fits 4-digit counts).
4. **Alignment:** worker finds the (dx,dy) that maximizes valid reads (anchor coarse-to-fine),
   caches it in main as `stashOffsetHint`; repeat captures verify at the hint and skip the scan.
5. **Pricing:** `getStashPriceMap` → `fetchFullCatalog` (all categories) → apiId→{price,icon,name}.
   Category-agnostic, so a tab mixing categories (e.g. abyss bones + ritual omens) prices fine.
   League currently `Runes of Aldur`. Divine price from the `divine` apiId's ex price.
6. **No silent misses:** unreadable/empty slots return "?" → flagged + excluded, never guessed.

## Adding a tab (the reusable pipeline)
1. Open the tab in-game; grab: `dev/stash-matcher` tools or `scripts/test-stash-capture.js`
   (screen grab lands at `os.tmpdir()/poe2-screen-capture.png`).
2. Auto-detect slot positions: `dev/stash-matcher/detect-positions.js` (`IMG=<png> npx electron ...`).
3. Download candidate icons for the tab's poe2scout category(ies): `dev/stash-matcher` +
   the `dl-icons.mjs` pattern (`OUT=<dir> CAT=<category> node dl-icons.mjs`).
4. Run the **icon-matcher** (`dev/stash-matcher/icon-matcher-reference.js` = the winner) to draft
   position→apiId. For grid tabs (row=type × col=tier, like essence/runes) let the STRUCTURE give
   tier+position and the matcher/Drew give the ~N row TYPES — see `dev/stash-matcher/essence-build.js`.
5. Have Drew verify types (matcher is reliable on TIER/position + color-distinct types; unreliable
   on near-identical icons like ritual omens → use Drew's labels there).
6. Generate `renderer/stash/<tab>-tab-map.js`, register in `reader-worker.js` `TABS`, add a
   `TAB_LABEL` in networth-ui.js, verify counts read, commit.

## THE ICON-MATCHER (solved — port it)
Cracked via 5 parallel agents on diverse metrics vs the Abyss ground truth (20 known cells /
82 candidates). **Winner: foreground-weighted SSD + ±4px alignment search = 20/20.**
- Reference impl: `dev/stash-matcher/icon-matcher-reference.js` (harness test form) +
  `dev/stash-matcher/harness.js`. Regenerate the abyss dataset with `buildset.js` (in scratchpad).
- **DONE: ported to `renderer/stash/icon-matcher.js`** — pure typed-array UMD module
  (`prepCell`/`prepCandidate`/`score`/`match`), 20/20 on the abyss dataset via
  `dev/stash-matcher/validate-matcher.js`. Still the enabler for (a) the dynamic currency rows at
  runtime and (b) faster tab auto-labeling. (Composites candidate RGBA on navy [26,26,40], masks the
  top-left number corner, weights by foreground, min weighted-SSD over dx,dy∈[-4,4].)

## NEXT UP (priority order)
1. **Runes / Augment tab** — 5 subtabs: **Runes, Kalguuran Runes, Soul Cores, Idols, Ancient
   Augments**. Each subtab = its own static map (`runes`, `runes-kalguuran`, …) registered in
   worker TABS; detection picks the showing subtab by best read-fraction. Decide tally UX (5 rows
   vs grouped). Priced from category `runes`=142 (`aldurs-legacy` 116k), `ultimatum`=soul cores,
   `idol`=idols. **Icon-matching does NOT work on runes** (near-identical glyphs) — these are
   FIXED grids, so position=identity like currency. Build each subtab by having Drew name the
   layout once (structural: types×tiers), then bake coords from a live capture.
   - **Subtab 1 "Runes" COMPLETE & confirmed (not yet wired/committed):** `renderer/stash/runes-tab-map.js`,
     69 slots, all Drew-verified, validated 38/38 owned reads against a live capture + all apiIds
     price. Blue basic runes = 15 types × 3 tier-cols (Lesser|Base|Greater; Perfect not in tab).
     R6 left = 4 "Greater Rune of X" crystals (x44,107,171,232 = Leadership,Tithing,Alacrity,Nobility;
     x296,359 = gap/no slots). R6 right + R7/R8 = pantheon named runes. THEN register in worker
     TABS + add a TAB_LABEL.
   - **Subtab 2 "Kalguuran Runes" mapped (not wired):** `runes-kalguuran-tab-map.js`, 58 slots,
     all Drew-verified + all price. Dense irregular layout SOLVED by defining the fixed regular
     grid (cells are static) + a numbered-overlay visual check (`dev/stash-matcher/overlay-render.js`),
     NOT per-capture detection (too noisy). Blanks resolved by family single-missing elimination +
     Drew buying the 4 cheap uniques so a recapture placed them (Aldur's Legacy fell out by
     elimination). **BLOCKER before wiring: count-OCR misreads these icons** (7->"71", some "?") —
     needs a tightened digit-read window; positions/identities are solid. Subtab 1 reads fine, so
     it's icon-specific.
   - **Subtabs 3-5 TODO:** Soul Cores, Idols, Ancient Augments — same fixed-grid + overlay approach.
   - **Reusable tooling:** `dev/stash-matcher/overlay-render.js` (numbered overlay from a positions
     JSON), `draft-overlay.js` (matcher draft). `dev/stash-matcher/kalguuran-layout.md` has the labels.
2. **Ritual** — Drew's row-by-row labels are in the session transcript (search "R1 Left"/omens).
   apiIds all resolve (ritual omens + `head-of-the-king` + `an-audience-with-the-king` in fragments).
   Dense twin-column-group layout broke auto-detect → pin the fixed grid carefully before baking.
3. **breach, expedition, delirium, augments** — should go like essence (screenshots in `screenshots/`).
4. **Dynamic currency rows** (DEFERRED — do the static tabs first) — the 2 bottom rows of the currency
   tab hold arbitrary currency-class items; no static map → runtime icon-match. PROTO'd in
   `dev/stash-matcher/match-dynamic-rows.js`: matches well against a BROAD pool — abyss bones and
   ritual omens landed correctly; the match score is a clean confidence gate (~-4k good, ~-10k flag).
   To finish: (a) pool must include ESSENCES (the blue/red crystals are essences), plus the full
   currency-class catalog; (b) needs a FRESH live capture — the `currency tab.png` fixture is STALE
   (Drew reorganised the rows, counts/items changed); (c) confidence-flag + click-to-fill for the
   uncertain ones (no silent misses). The bones/omens result validates the approach; just needs the
   full pool + a live frame + the correction UI.

## Test commands
- `npm run test:stash` — reader self-check on reference currency screenshot (expect 48/49).
- `npm run test:value` — offline currency-tab valuation.
- `npx electron scripts/test-stash-capture.js` — live screen-capture valuation (game open).

## Gotchas
- Fixtures `screenshots/` are gitignored (~3MB each); they're the reference tabs.
- Dev scratchpad tools live at (session-specific, but persists on disk):
  `%LOCALAPPDATA%\Temp\claude\C--Users-dbatc-Documents-Overlay-App\5d9c0f92-...\scratchpad\stash-reader-proto\`
  — the durable copies are in `dev/stash-matcher/`.
- Relaunching the dev app is the agent's job (kill `electron.exe` first). Never tell Drew to `npm start`.
- Don't bump the version or cut a release — everything rides into 2.4.
