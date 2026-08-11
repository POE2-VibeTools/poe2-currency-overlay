# Patch notes runbook

Drew writes the notes. You transcribe them. That is the whole job.

## The rule

**Copy his text. Do not edit it.** Not for grammar, not for tone, not for length, not for
accuracy, not for consistency with a previous entry. If you think a line is wrong, put it
in verbatim anyway and say so in chat afterwards. He decides.

## The only change you may make

Add a colon to a group header so it renders as a heading.

He writes `Currency` / `Net Worth` / `App-wide`. The renderer turns a line ending in `:`
into a section heading, so those go in as `Currency:` / `Net Worth:` / `App-wide:`.
That is the convention his own 2.6.7 and 2.6.3 entries already use.

Nothing else. Not the arrow in `1.81:1 → 4.78:1`. Not `(hopefully)`. Not `My bad.`
Not the capitalisation. Not a missing full stop.

## Format

`renderer/release-notes.js`, newest entry on top:

```js
{
  version: '2.7.0',
  date: 'YYYY-MM-DD',
  title: "his title",     // optional, renders as a subheader
  notes: [ ... ],
}
```

Inside `notes`, four things exist and nothing else:

| what he wrote | how to enter it | renders as |
| --- | --- | --- |
| a group name | line ending in `:` | bold section heading |
| a normal line | plain string | bullet |
| a reply under a quoted report | string with a **leading space** | dimmer indented sub-bullet |
| the release's one-line summary | `title` field | subheader under the version |

No bold, no italics, no links, no images. Escape `"` inside double-quoted strings.

## Steps

1. Paste his notes in. Add colons to group headers. Change nothing else.
2. `node --check renderer/release-notes.js`
3. Render the popup and show him the screenshot BEFORE asking anything:
   `node_modules/electron/dist/electron.exe dev/render-notes.js industry`
   (it prints the PNG path; `npx electron` may not resolve, use the binary directly)
   (renders the newest entry through the app's own stylesheets and the same
   note-to-HTML rules as `renderer.js renderNoteEntry`)
4. Report what you changed (the colons) and anything that looks off in the render.
   Then stop. Version bumps and releases are separate, and separately asked for.

## Do not

- Do not ask which format he wants. The format is above.
- Do not ask whether to add the colons. Add them.
- Do not "improve" a bullet you believe is inaccurate.
- Do not reorder, merge or split his bullets.
- Do not drop a line because it reads as redundant.
- Do not add a line for work he did not mention.
- Do not use an em dash anywhere, ever.
- Do not bump the version or build unless he says to.

## Why this file exists

This went badly enough to be worth writing down. The failure was not the format, it was
second-guessing his copy and asking him to re-decide things he had already decided. He
said it plainly: *"If i give you patch notes, just faithfully represent them."*

See `RELEASING.md` for where notes sit in the release sequence: `release-notes.js` is the
one file that must land BEFORE the build, because it bakes into the app.
