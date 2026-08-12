'use strict';
// Grab the whole primary screen while the Set Item Price dialog is open, so the dialog
// finder can be built against real pixels instead of assumptions.
//
//   npx electron dev/capture-price-dialog.js [label] [delaySeconds]
//
// Uses desktopCapturer rather than the live stream: this runs once, so the ~1s cost is
// irrelevant, and it avoids the offscreen-stream path entirely.
//
// Capture several items that differ in the ways that move the dialog - a tall icon (bow)
// against a short one (boots, ring), and a long currency name against a short one. Those
// differences ARE the problem being solved, so a corpus of one proves nothing.
const { app, screen, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'dialog-captures');
const args = process.argv.slice(2).filter((a) => !a.endsWith('.js') && !a.startsWith('-'));
const LABEL = args[0] || 'shot';
const DELAY = Number(args[1]) > 0 ? Number(args[1]) : 5;

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const w = Math.round(d.size.width * d.scaleFactor);
  const h = Math.round(d.size.height * d.scaleFactor);
  console.log('primary display ' + w + 'x' + h + ' - capturing in ' + DELAY + 's');
  for (let i = DELAY; i > 0; i--) {
    process.stdout.write('  ' + i + '...\r');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  const primaryId = String(d.id);
  const src = sources.find((s) => s.display_id === primaryId)
    || sources.find((s) => s.id.startsWith('screen')) || sources[0];
  if (!src) { console.log('no screen source'); return app.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, LABEL + '.png');
  fs.writeFileSync(file, src.thumbnail.toPNG());
  const s = src.thumbnail.getSize();
  console.log('\nsaved ' + s.width + 'x' + s.height + ' -> ' + file);
  app.exit(0);
});
