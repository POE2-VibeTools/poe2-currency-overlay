# POE2 Currency Overlay — Backlog

Planned features, in priority order. Release targets are aims, not commitments.

**By release**
- **~2.4** — Currency-tab Calculator (#1), Regex Builder / Tab Filter (#2), Command Hotkeys (#5), Reorder currencies within a bucket (#7), Multi-select add to bucket (#8), Paginate history lists (#9)
- **~2.5** — Dedicated Arbitrage Route tab (#3), In-app bug reporting for explicit events (#4)
- **~2.6** — Full currency exchange table (#6)

_Last shipped: **v2.3.1** — optional currency icons in place of names (Price Check + Desecrate)._

---

## 1. Currency-tab Calculator — target ~2.4

Values every special currency tab type (all except the Map tab). Reads the tab off-screen and tells you the exact value of everything in it; flip through all your currency tabs and it totals what your whole stash is worth — currency tabs only, not market tabs.

**Status:** Recognition + valuation proven offline. The digit reader hits 48/49 on the currency tab (the hardest one) and flags the rest rather than guessing; poe2scout pricing, icons, and FX are wired. Remaining work is the larger part: mapping each fixed slot to its currency (position-based, per tab), porting the Python prototype into the app, and building the live screen-capture + overlay UI (one-time calibration box-picker, per-cell flags, click-to-fill correction).

---

## 2. Regex Builder / Tab Filter — target ~2.4

A place to build and store regex searches that help users parse and find items inside their stash. The kind of thing a lot of people don't know they want until they see how useful it is.

**Status:** Not started (concept). Low-risk — no API or auth needed; reuses the existing clipboard/whisper plumbing.

---

## 5. Command Hotkeys — target ~2.4

Let users bind hotkeys to safe, non-disruptive in-game chat commands that don't run afoul of GGG's policy (e.g. `/hideout`). One key = one manually-triggered chat command. No logout or combat commands.

**Status:** Ready to build. Safe command list curated (`/hideout`, `/guild`, `/played`, `/deaths`, `/remaining`, `/kills`, `/afk`, `/dnd`, plus name-param `/invite`, `/whois`, `/kick`). GGG policy confirmed — Chris Wilson publicly OK'd chat-command macros; their line is one action per keypress, no timers, no auto-firing, which this respects. Ships with a copy fix: replace the app's "no automation" claim with the precise, true version ("no botting, no memory reading, no combat automation").

---

## 3. Dedicated Arbitrage Route tab — target ~2.5

Expand the Arbitrage section into its own tab. Today it only surfaces the single best route for a pair with no fidelity — you can't build or check your own route. This adds "create a route" and "check a route," not just view what the system hands you.

**Status:** Not started (concept). Builds on the existing arbitrage engine.

---

## 4. In-app bug reporting for explicit events — target ~2.5

Let users report the actual thing that bugged out — a currency row, a search entry, a specific search result, a desecration — instead of relying on them to copy/paste an item and describe it. The report carries the real underlying data.

**Status:** Not started (concept).

---

## 6. Full currency exchange table — target ~2.6

Inspired by Ange's in-game market screen (the "I HAVE" / "I WANT" view): show every currency you hold with its live exchange rate to Exalted, auto-populated. A one-glance table of what everything is worth. Community-suggested, and cheap to add on the stash-tab pricer's valuation backbone (#1) once that lands.

**Status:** Idea (community request).

---

## 7. Reorder currencies within a bucket — target ~2.4

Drag the currencies inside a bucket to reorder them, so each bucket sits the way you like instead of the app's default order.

**Status:** Not started (concept).

---

## 8. Multi-select when adding to a bucket — target ~2.4

Add more than one currency to a bucket at once with multi-select, instead of adding them one at a time.

**Status:** Not started (concept).

---

## 9. Paginate history lists — target ~2.4

Give the Price Check and Desecrate history proper pagination instead of a "load more" button that grows one endlessly long list.

**Status:** Not started (concept).
