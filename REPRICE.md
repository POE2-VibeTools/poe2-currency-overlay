# Reprice mode

While the mode is on, right-clicking an item to reprice reads the price the game already
put in the box, applies your rule, and leaves the result on the clipboard. You still
press Ctrl+V and you still press List Item. The app never sends a key or a click.

## Finishing it: the digit templates

Everything works except reading the number, because the price field uses the game's font
at a size no existing template set covers. Cutting that set needs one capture from the
real game. Three steps:

1. **Calibrate.** Settings > Reprice > Calibrate. Open Set Item Price in game first, then
   drag a box around the number. Settings shows you the captured strip - check the digits
   are fully inside it, not clipped.

2. **Capture the digits.**
   ```
   node_modules/electron/dist/electron.exe dev/capture-reprice-box.js 60
   ```
   In game: type `12345`, press **Ctrl+A**, wait ~2s. Then `67890`, **Ctrl+A**, wait ~2s.

   Ctrl+A is not optional. The game selects the value the instant the dialog opens, so the
   SELECTED rendering is the only one the reader ever sees - different background, and no
   caret. Templates cut from the typing state do not match at runtime.

   Frames land in `dev/reprice-captures/`.

3. **Build the set.**
   ```
   node_modules/electron/dist/electron.exe dev/build-reprice-digits.js dev/reprice-captures/fNNN.png=12345 dev/reprice-captures/fMMM.png=67890
   ```
   It refuses to write if the glyph count disagrees with the label or if any of 0-9 is
   missing, then reads its own output back to prove the set decodes what it was built
   from. Writes `renderer/stash/reprice-digits.json`.

Then Settings > Reprice > **Test read** should report a number.

## How it reads

The field is three tones, not two: the dark surround, the selection highlight behind the
number, and the digits. A single Otsu split lands between surround and highlight and
merges the highlight into the glyphs, so the reader also tries a second Otsu computed
over the pixels above the first, and keeps whichever segmentation looks most like a row
of digits (similar heights, shared baseline). One unreadable glyph voids the whole read -
"9?" could be 9 or 95, and pasting either is a guess at someone's money.

## Why the capture path is what it is

`desktopCapturer.getSources()` costs **~1000ms per grab** on Windows regardless of
thumbnail size, because it re-enumerates displays every call. Measured, not assumed. That
is far more than the budget here, so the mode holds a `getDisplayMedia` stream open while
it is on and pulls single frames off it (~18-35ms). Opening the stream costs ~2s, paid
once when the mode is switched on.

## Rules

`renderer/reprice-rules.js`, tested by `npm run test:reprice`.

Nodes are recursive, so a tree like "if Divine then whichever is smaller [a,b] else [...]"
already evaluates. The settings screen exposes one level of it: Always, whichever changes
the price more/less, or an if/else on the price.

**"Changes the price more" compares the SIZE OF THE CHANGE, not the resulting price.** On
100 a -10% (10 off) beats a -2; on 5 the -2 beats a -10% (0.5 off). That is the whole
reason to pair rules - percent governs expensive listings, flat governs cheap ones,
without switching modes by hand. The settings screen shows worked examples at both
magnitudes so this is visible rather than something to take on trust.

Results are rounded and never go below 1. An unknown currency takes the else branch;
guessing one would silently misprice.

## Files

| file | role |
| --- | --- |
| `reprice.js` | mode, stream, right-click hook, retry, clipboard |
| `renderer/reprice-rules.js` | the arithmetic, shared by settings and main |
| `renderer/stash/reprice-reader.js` | segmentation + digit matching |
| `renderer/stash/reprice-calibrate*` | the drag-a-box sheet |
| `renderer/stash/reprice-indicator*` | the badge shown over the game |
| `dev/capture-reprice-box.js` | capture the calibrated region |
| `dev/build-reprice-digits.js` | cut the template set |
| `dev/test-reprice-rules.js` | `npm run test:reprice` |
