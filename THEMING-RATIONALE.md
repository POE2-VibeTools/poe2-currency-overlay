# Theming — rationale

Background for `THEMING.md`. Not needed to add a theme; read it when a rule there looks
arbitrary, or before changing one.

## Why the token layer exists

Before 2026-08-11 the CSS held **745 colour literals across 349 distinct values**, against a
`:root` block that already named most of the roles the app has. Token coverage was 45%.

They were not 349 chosen colours. 60% were one warm/amber family at slightly different
lightnesses, written by hand a rule at a time across many sessions. `#9a927f` and `#9a927e`
both existed. So did `#17140f`, `#17130e` and `#16130f`. Nobody decided those differences.

The single worst gap: **`#d67e2c` was used 88 times and had no token at all** — the amber
every border, tint and rail was drawn from. `:root` defined `--am: #e8a04c`, a *different*
amber. Half the app was painting with a colour the design system did not know existed.

That is why a theme was impossible: there was no layer to swap.

## Why not just quantise the colours

Measured before choosing: snapping everything to a 7/9/12/16-step ramp per family gave
270–309 tokens and shifted colours by an average of 6–14/255. More tokens *and* a visible
change. The long tail was alpha variants, which multiply any ramp.

Collapsing onto the roles the app already had was better on both axes: 137 tokens, worst
shift 8/255 (~3% of one channel), and the alpha variants became `color-mix` over the same
token, which is what makes them follow a theme at all.

Drew's call made it possible: *"The app LOOKS visually consistent. So to the user, if you
were to unify these similar-type colours, i doubt it would be noticeable. Just dont break
gradients."* Hence the exact-match-only rule for gradient stops.

## Why status colour is exempt from the palette

The Industry design system is mono and its brief says gains and losses should read by arrow
rather than by green and red. Following that literally collapsed `+20` and `-65` to the same
steel, and Drew caught it: *"They both have the same colour. Thats not good UX."*

The design doc was right about the mechanism and wrong about the app: it assumed a surface
with no dense comparison table. The resolution is both — muted hues that sit in the palette,
plus an arrow so the meaning survives desaturation, colour-vision deficiency, and a
low-opacity overlay on a bright scene.

## Why the splash is excluded

It was themed in the first pass and Drew's reaction was immediate: *"Since when did a app
theme change the loading logo?"* Correct. Brand identity is not chrome. The loading mark is
the same category as the app icon: it identifies the product, so it does not move when a
user picks a palette.

## Why five documents and not one stylesheet

Electron windows are separate documents. The hover peek, the calibration overlay and the
login shell each had their own hardcoded palette and their own CSP. The peek was missed in
the first pass entirely — Drew found it: *"the theme implementation completely missed the
onhover popup"*. A window that renders its own HTML will silently keep the default palette
unless it is wired, and nothing fails loudly when it is not.

The token block was briefly duplicated into all five, which would have meant editing five
files to add one colour — the exact trap the work was meant to remove. It is one
`tokens.css` now.

## Bugs this process produced, and the guards that came from them

- **Fully transparent background.** `rgba(20, 18, 15, var(--bg-alpha))` — the alpha is a
  variable. The literal regex clipped it at the first `)`, parsed alpha as `NaN`, and wrote
  `color-mix(… NaN%)`, which renders as nothing. Guard: skip anything containing `var(`.
- **Circular token definitions.** Injecting the `:root` block into a document and *then*
  tokenising it rewrote `--s-root:#14120f` into `--s-root:var(--s-root)`. Order matters:
  tokenise the file's own styles first, inject definitions second.
- **A control character in the CSS.** A Python edit turned `\2191` (↑) into an octal escape.
  Glyphs belong in the markup, not in CSS `content` written through another language.
- **Clipped deltas, twice.** `.pk-cmp` reserved a fixed `40px` track while `.pk-delta` set
  its own `58px` width. Two places describing one size will disagree. The track is
  `max-content` now.

## The bug the theming work exposed

Not a theming bug, found while checking whether the delta colours read correctly: the
comparison panel computed `mine - theirs`, so a listing with **65 more** energy shield
rendered as a red `-65`, and a listing with **no quality at all** rendered as a green `+20`.
Every sign was inverted relative to what the card appears to say, and had been since the
panel was built.

It survived because the panel was only ever reviewed for whether it *rendered*, never
against an item whose numbers were known. Drew's question was *"is that clear?"* — a UX
question that turned out to be a correctness question.
