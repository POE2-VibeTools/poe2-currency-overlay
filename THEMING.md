# Theming

## Add a theme

1. Add an entry to `THEMES` in `dev/gen-theme.js`. One function per hue family:
   `amber`, `lime`, `green`, `red`, `blue`, `violet`, `neutral`. Each takes the default
   colour and returns `[hue, saturation, lightness]`. Lightness must be passed through
   unchanged unless you intend to change contrast.
2. `node dev/gen-theme.js` → regenerates `renderer/themes.css`.
3. Add the option to `#theme-select` in `renderer/index.html` and to the `theme` values
   accepted in `main.js` (`ipcMain.handle('set-theme')`).
4. i18n: `ui.settings.theme_<name>` in `dev-docs/i18n/ui-tutorial.json`, then
   `npm run i18n:build && npm run i18n:check` (must exit 0).
5. Relaunch: kill `electron.exe` AND `POE2 Currency Overlay.exe`, then `npm start`.

## Highlights

A marked row (edited, unreliable, best price) is never styled by hand. It sets one
variable and the recipe does the rest:

```css
.nw-line-edited { --hl: var(--info); }
```

`--hl-fill` / `--hl-edge` / `--hl-ink` in `tokens.css` define what a highlight *is*:
tint strength, rail strength, and how far the row's own numbers pull toward the state
colour. A theme overrides all three at once via `highlight: { fill, edge, ink }` in its
`THEMES` entry. Every tab reads the same three values, so Price Check and Net Worth
cannot drift.

**Separation comes from lightness and chroma, not from a foreign hue.** `--info` is
re-themed like every other colour, then lifted (`infoChroma`, `infoLift`) so it is
brighter and more saturated than anything around it. On a monochrome palette that means
a bright steel row on steel — correct. Rotating the hue instead would put a violet row
in a steel theme, which separates the state at the cost of the whole palette.

`--warn` and `--danger` are the exception: they keep their hue in every theme, because
they carry meaning rather than style.

## Files

| file | role |
| --- | --- |
| `renderer/tokens.css` | every colour the app draws, 137 tokens. Single source of truth. |
| `renderer/themes.css` | GENERATED. Do not hand-edit. |
| `dev/gen-theme.js` | theme definitions + generator |
| `dev/migrate-to-tokens.js` | collapses new colour literals onto tokens |

## Rules

- **Never write a colour literal in a rule.** A literal is a colour no theme can reach.
  Add a token to `tokens.css` and use `var(--token)`.
- **Alpha variants use `color-mix`**, not a new rgba: `color-mix(in srgb, var(--am) 30%, transparent)`.
  An rgba literal is frozen to one palette.
- **Status colour keeps its hue in every theme.** Green = better, red = worse. Also give it
  a non-colour signal (arrow, glyph, position) — colour alone fails for ~1 in 12 men and
  at low background opacity.
- **The splash is not themed.** `renderer/splash.html` is brand, like the app icon.
  It links neither `tokens.css` nor `themes.css`. Keep it that way.
- **Shape is not a token.** Radius, gradients, shadows, borders need hand-written rules in
  the `html[data-theme="..."]` block at the bottom of `dev/gen-theme.js`.
- **Gradient stops only snap on an exact match** — a shifted stop bands against its neighbour.

## Every document that needs the theme

Five windows render their own HTML. Each must link `tokens.css` + `themes.css` AND set
`data-theme` on `<html>`:

| document | gets `data-theme` from |
| --- | --- |
| `renderer/index.html` | `renderer.js` on boot, from `config.theme` |
| `renderer/item/peek.html` | `peek-client.js`, from the `peek-content` IPC payload |
| `renderer/stash/calibrate.html` | `?theme=` query, set by `main.js` at `loadFile` |
| `renderer/item/login-shell.html` | `?theme=` query, set by `main.js` at `loadFile` |
| `renderer/splash.html` | **never** — brand surface |

A new window added later needs the same two links and the attribute, or it silently keeps
the default palette.

## Traps

- **HTML inside translated strings cannot be restyled.** `item.history.paste_prompt_alt`
  contains `<kbd>Ctrl</kbd>+<kbd>V</kbd>` in six languages. Style the element
  (`kbd { margin }`), never the markup you think is there.
- **`var()` inside a colour.** `rgba(20, 18, 15, var(--bg-alpha))` is not a literal.
  `dev/migrate-to-tokens.js` skips anything containing `var(`; keep that guard.
- **Two `:root` blocks drift.** There is exactly one, in `tokens.css`. Do not add another.

## Check before shipping

```bash
node dev/migrate-to-tokens.js          # report only; should find ~0 new literals
node dev/gen-theme.js                  # regenerate after any token change
npm run i18n:check                     # must exit 0
```

Then switch themes in Settings → App and walk: Price Check results + hover peek, Net Worth,
Desecrate, Regex, Grand Expedition, Settings, the calibration overlay.

See `THEMING-RATIONALE.md` for why these rules exist.
