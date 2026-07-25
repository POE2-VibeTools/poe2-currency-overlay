# POE2 Currency Overlay — Backlog

Planned features, in priority order. Release targets are aims, not commitments.

**By release**
- **~2.4** — Currency-tab Calculator (#1), Regex Builder / Tab Filter (#2), Command Hotkeys (#5)
- **~2.5** — Dedicated Arbitrage Route tab (#3), In-app bug reporting for explicit events (#4)

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
