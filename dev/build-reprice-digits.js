// Cut the digit template set for the Set Item Price box from real captures.
//
// The price digits are the game's own font at a size the stash templates were never cut
// for, so they need their own set. This takes captures whose contents you know and emits
// renderer/stash/reprice-digits.json.
//
//   node_modules/electron/dist/electron.exe dev/build-reprice-digits.js <png>=<digits> ...
//
// e.g.  dev/build-reprice-digits.js shots/a.png=12345 shots/b.png=67890
//
// Each PNG must be a crop of the price field with the number SELECTED - that is the only
// state the reader ever sees, because the game selects the value the moment the dialog
// opens. A capture of the typing state has a caret in it and renders on a different
// background, and templates cut from it will not match at runtime.
//
// Every glyph found must line up with the digits you declared, or the file is refused:
// a set built from a mislabelled capture reads plausible wrong numbers forever, and this
// feature puts those numbers on a clipboard the user pastes into a trade.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RR = require(path.join(ROOT, 'renderer', 'stash', 'reprice-reader.js'));
const OUT = path.join(ROOT, 'renderer', 'stash', 'reprice-digits.json');

function loadRGBA(file) {
  const img = nativeImage.createFromPath(file);
  const s = img.getSize();
  if (!s.width) throw new Error('cannot read ' + file);
  const bgra = img.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, w: s.width, h: s.height };
}

function ascii(mask) {
  let out = '';
  for (let y = 0; y < mask.h; y++) {
    let row = '    ';
    for (let x = 0; x < mask.w; x++) row += mask.data[y * mask.w + x] ? '#' : '.';
    out += row + '\n';
  }
  return out;
}

app.whenReady().then(() => {
  const args = process.argv.slice(1).filter((a) => a.includes('=') && /\.png=/i.test(a));
  if (!args.length) {
    console.log('usage: build-reprice-digits.js <png>=<digits> [...]');
    console.log('  each png must be the price field with the number SELECTED');
    app.exit(1); return;
  }

  const acc = {};   // char -> [mask]
  let failed = false;

  for (const arg of args) {
    const idx = arg.lastIndexOf('=');
    const file = arg.slice(0, idx), digits = arg.slice(idx + 1);
    const im = loadRGBA(file);
    const V = RR.valueChannel(im.rgba, im.w, im.h);
    const comps = RR.glyphs(V, im.w, im.h);
    console.log(`${path.basename(file)}  declared "${digits}"  found ${comps.length} glyph(s)`);
    if (comps.length !== digits.length) {
      console.log(`  MISMATCH: ${digits.length} digits declared, ${comps.length} found. Refusing.`);
      for (const c of comps) console.log(ascii(c.mask));
      failed = true;
      continue;
    }
    comps.forEach((c, i) => {
      const ch = digits[i];
      (acc[ch] || (acc[ch] = [])).push(c.mask);
      console.log(`  '${ch}'  ${c.mask.w}x${c.mask.h}`);
    });
  }

  if (failed) { console.log('\nnothing written.'); app.exit(1); return; }

  const missing = '0123456789'.split('').filter((d) => !acc[d]);
  if (missing.length) {
    console.log('\nmissing digits: ' + missing.join(', ') + ' - capture those too. Nothing written.');
    app.exit(1); return;
  }

  // Where a digit was captured more than once, keep the pixels that agree. A majority
  // vote drops antialiasing that only appeared in one sample.
  const templates = {};
  for (const ch of Object.keys(acc).sort()) {
    const list = acc[ch];
    const w = Math.round(list.reduce((s, m) => s + m.w, 0) / list.length);
    const h = Math.round(list.reduce((s, m) => s + m.h, 0) / list.length);
    const sum = new Float64Array(w * h);
    for (const m of list) {
      const r = RR.resizeMask(m, w, h);
      for (let i = 0; i < sum.length; i++) sum[i] += r[i];
    }
    const data = [];
    for (let i = 0; i < sum.length; i++) data.push(sum[i] / list.length >= 0.5 ? 1 : 0);
    templates[ch] = { w, h, data };
    console.log(`'${ch}' from ${list.length} sample(s) -> ${w}x${h}`);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    source: 'Set Item Price field, selected state',
    built: 'dev/build-reprice-digits.js',
    templates,
  }, null, 1) + '\n');
  console.log('\nwrote ' + path.relative(ROOT, OUT));

  // Prove the set reads back what it was built from, rather than trusting it.
  console.log('\nself-check:');
  const tpl = {};
  for (const ch of Object.keys(templates)) tpl[ch] = { w: templates[ch].w, h: templates[ch].h, data: Uint8Array.from(templates[ch].data) };
  for (const arg of args) {
    const idx = arg.lastIndexOf('=');
    const file = arg.slice(0, idx), digits = arg.slice(idx + 1);
    const im = loadRGBA(file);
    const r = RR.read({ data: im.rgba, w: im.w, h: im.h }, tpl, 0.55);
    const ok = r.text === digits;
    console.log(`  ${path.basename(file)}  read "${r.text}"  expected "${digits}"  ${ok ? 'OK' : 'FAIL'}`
      + (r.scores.length ? '  iou ' + r.scores.map((s) => s.toFixed(2)).join(',') : ''));
  }
  app.quit();
});
