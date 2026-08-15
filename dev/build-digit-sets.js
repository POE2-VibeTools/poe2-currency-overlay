'use strict';
// Bake digit templates at MORE THAN ONE SCALE.
//
//   npx electron dev/build-digit-sets.js
//
// The single set cut at 1080p read fine there and fell apart in a 1440x900 window: the
// glyphs are ~14px tall at one and ~11px at the other, and thin strokes do not survive
// being resampled between the two. This is the same thing that fixed the Net Worth
// reader - a corpus that covers how the game actually renders, rather than a cleverer
// matcher over one rendering.
//
// Each source is a full-screen capture with a KNOWN price highlighted. The dialog finder
// locates the selection block, the digits are segmented out of it, and they are labelled
// left to right from the filename. A capture whose segmentation does not produce exactly
// the expected number of glyphs is refused rather than guessed at - a mislabelled
// template would be worse than a missing one.
//
// Output: renderer/stash/reprice-digit-sets.json
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const F = require(path.join(__dirname, '..', 'renderer', 'stash', 'price-dialog-finder.js'));
const DR = require(path.join(__dirname, '..', 'renderer', 'stash', 'digit-reader.js'));

const DIR = path.join(__dirname, 'dialog-captures');
const OUT = path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digit-sets.json');
const LEGACY = path.join(__dirname, '..', 'renderer', 'stash', 'reprice-digits.json');

// file -> the digits actually on screen, left to right. The optional third column is a
// bucket tag: sources tagged differently are cut into SEPARATE sets even when their
// block heights collide. The windowed-1039 submissions measure the same 19px block as
// the 1440x900 captures but render the glyphs differently enough that "1" scored 0.67
// against the 1440 templates and lost to "3" - the reader happily tries both sets and
// keeps whichever scores higher, so a duplicate height costs nothing.
const SOURCES = [
  ['digits-1440-12345.png', '12345'],
  ['digits-1440-6789.png', '6789'],
  ['digits-1440-0.png', '0'],
  ['digits-1600-12345.png', '12345'],
  ['digits-1600-6789.png', '6789'],
  ['digits-1600-0.png', '0'],
  ['digits-2560-12345.png', '12345'],
  ['digits-2560-6789.png', '6789'],
  ['digits-2560-0.png', '0'],
  // true windowed-fullscreen 1920x1080 - every prior capture was WINDOWED, which
  // renders the dialog slightly smaller; fullscreen is its own scale (block h23)
  ['reprice-fullscreen-12345.png', '12345'],
  ['reprice-fullscreen-6789.png', '6789'],
  ['reprice-fullscreen-0.png', '0'],
  // 2560x1440 monitor in windowed fullscreen - block h29 (windowed was h27)
  ['reprice-2560fs-12345.png', '12345'],
  ['reprice-2560fs-6789.png', '6789'],
  ['reprice-2560fs-0.png', '0'],
  // user-submitted via Settings -> Reprice, game windowed at 1920x1039
  ['sub-1039w-12345.png', '12345', 'w'],
  ['sub-1039w-6789.png', '6789', 'w'],
  ['sub-1039w-0.png', '0', 'w'],
];

function load(file) {
  const img = nativeImage.createFromPath(path.join(DIR, file));
  const s = img.getSize();
  if (!s.width) return null;
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

// Inside the selection block there are exactly two things: the warm block and the pale
// digits on top of it, so a plain brightness split separates them cleanly.
//
// Splitting that into individual digits is the hard part, and blob labelling cannot do it
// at this size: neighbouring digits touch and merge, while a thin "0" ring breaks and
// splits. Baking knows something the reader does not - HOW MANY digits are there - so it
// uses a column projection and forces exactly that many groups. Wrong-by-construction
// beats wrong-by-luck: a mislabelled template would poison every future read.
function binarise(im, blockIn) {
  // Match the reader EXACTLY: same 3px padding around the block, same Otsu-of-the-upper
  // threshold. Baking from a differently binarised crop produced templates that scored
  // 0.54 against the very capture they were cut from - below the reader's own floor -
  // while the set cut at another resolution scored higher. Templates have to be made the
  // way they will be measured.
  const pad = 3;
  const x = blockIn.x - pad, y = blockIn.y - pad;
  const w = blockIn.w + pad * 2, h = blockIn.h + pad * 2;
  const V = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const q = ((y + yy) * im.w + (x + xx)) * 4;
      const r = im.rgba[q], g = im.rgba[q + 1], b = im.rgba[q + 2];
      V[yy * w + xx] = r > g ? (r > b ? r : b) : (g > b ? g : b);
    }
  }
  const t1 = DR.otsu(V);
  const upper = V.filter((v) => v > t1);
  const cut = upper.length > 16 ? DR.otsu(upper) : t1;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < V.length; i++) on[i] = V[i] > cut ? 1 : 0;
  return { on, w, h };
}

function columnSums(b) {
  const col = new Int32Array(b.w);
  for (let x = 0; x < b.w; x++) {
    let n = 0;
    for (let y = 0; y < b.h; y++) if (b.on[y * b.w + x]) n++;
    col[x] = n;
  }
  return col;
}

// Contiguous runs of inked columns, then forced to exactly n groups: merge across the
// narrowest gaps when there are too many, split the widest group at its thinnest column
// when there are too few.
function groups(col, n) {
  let runs = [];
  let cur = null;
  for (let x = 0; x < col.length; x++) {
    if (col[x] > 0) { if (!cur) { cur = { x0: x, x1: x }; runs.push(cur); } else cur.x1 = x; }
    else cur = null;
  }
  // The padding around the block reaches the field's own tan border, which is bright
  // enough to survive the threshold and shows up as a one-pixel column the full height of
  // the crop. It is furniture, not a digit, and it is always against an edge.
  runs = runs.filter((r) => r.x0 > 0 && r.x1 < col.length - 1);
  if (!runs.length) return [];

  while (runs.length > n) {
    let best = -1, bestGap = 1e9;
    for (let i = 0; i + 1 < runs.length; i++) {
      const gap = runs[i + 1].x0 - runs[i].x1 - 1;
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    runs[best].x1 = runs[best + 1].x1;
    runs.splice(best + 1, 1);
  }

  while (runs.length < n) {
    let wid = 0;
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].x1 - runs[i].x0 > runs[wid].x1 - runs[wid].x0) wid = i;
    }
    const r = runs[wid];
    if (r.x1 - r.x0 < 3) break;   // nothing left worth splitting
    let cutAt = -1, min = 1e9;
    // avoid slicing off a sliver: look only in the middle of the run
    const pad = Math.max(1, Math.round((r.x1 - r.x0) * 0.25));
    for (let x = r.x0 + pad; x <= r.x1 - pad; x++) {
      if (col[x] < min) { min = col[x]; cutAt = x; }
    }
    if (cutAt < 0) break;
    const right = { x0: cutAt + 1, x1: r.x1 };
    r.x1 = cutAt;
    runs.splice(wid + 1, 0, right);
  }
  return runs;
}

// Trim a column range to its inked rows and lift it out as a mask.
function lift(b, x0, x1) {
  let y0 = b.h, y1 = -1;
  for (let y = 0; y < b.h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (b.on[y * b.w + x]) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
    }
  }
  if (y1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = b.on[(y + y0) * b.w + (x + x0)] ? 1 : 0;
  }
  return { x: x0, w, h, data };
}

function segment(im, block, n) {
  const b = binarise(im, block);
  const col = columnSums(b);
  // The field's own border runs the full height of the crop; a digit covers about half of
  // it. Blanking those columns removes the frame without touching the digits.
  for (let x = 0; x < col.length; x++) if (col[x] > b.h * 0.7) col[x] = 0;
  const gs = groups(col, n);
  return gs.map((r) => lift(b, r.x0, r.x1)).filter(Boolean);
}

app.whenReady().then(() => {
  const sets = new Map();   // block height -> { ch -> template }

  for (const [file, label, tag] of SOURCES) {
    const im = load(file);
    if (!im) { console.log('  missing ' + file); continue; }
    const hit = F.find(im.rgba, im.w, im.h);
    if (!hit) { console.log('  no dialog found in ' + file); continue; }
    // Use the block as returned. Growing it reaches past the orange into the field's
    // bright border, and that border then connects every digit into a single blob.
    const glyphs = segment(im, hit.block, label.length);
    if (glyphs.length !== label.length) {
      console.log('  REFUSED ' + file + ': segmented ' + glyphs.length
        + ' glyph(s) but the price is "' + label + '" - labelling would be a guess');
      console.log('          found: ' + glyphs.map((g) => g.w + 'x' + g.h + '@' + g.x).join('  '));
      continue;
    }
    const key = String(hit.block.h) + (tag || '');
    if (!sets.has(key)) sets.set(key, { blockH: hit.block.h, glyphs: {} });
    const bucket = sets.get(key).glyphs;
    label.split('').forEach((ch, i) => {
      const g = glyphs[i];
      // first one wins, so an earlier capture is not silently overwritten by a later one
      if (!bucket[ch]) bucket[ch] = { w: g.w, h: g.h, data: Array.from(g.data) };
    });
    console.log('  ' + file.padEnd(28) + 'set ' + key + '  '
      + glyphs.map((g, i) => label[i] + ':' + g.w + 'x' + g.h).join(' '));
  }

  // Carry the existing 1080p set in unchanged. It works at that scale and is what every
  // current user is reading with; replacing it would be a regression dressed as a fix.
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8')).templates;
    const chars = Object.keys(legacy || {});
    if (chars.length) {
      const h = Math.round(chars.reduce((a, c) => a + legacy[c].h, 0) / chars.length);
      // the 1080p captures measured a block height of 21 around ~11-12px glyphs
      sets.set('21', { blockH: 21, glyphs: legacy });
      console.log('  carried the existing set in at block h21 (mean glyph height ' + h + ')');
    }
  } catch { console.log('  no legacy reprice-digits.json to carry in'); }

  const out = { sets: [...sets.values()].map((s) => ({ blockH: s.blockH, glyphs: s.glyphs })) };
  out.sets.sort((a, b) => a.blockH - b.blockH);
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('\n' + out.sets.length + ' set(s): '
    + out.sets.map((s) => 'h' + s.blockH + ' (' + Object.keys(s.glyphs).length + '/10)').join(', '));
  console.log(OUT + '  (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');
  app.exit(0);
});
