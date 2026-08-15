'use strict';
// Run the Net Worth reader on stored full-screen captures and print every slot's read +
// confidence, side by side. Built for the windowed-vs-fullscreen rasterization question:
// the same stash tab captured both ways should read identically, and does not.
//
//   npx electron dev/compare-networth-reads.js <a.png> [b.png ...]
const { app, nativeImage } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads');

const files = process.argv.slice(2).filter((a) => a.endsWith('.png'));

function readerRun(bitmap, W, H) {
  return new Promise((resolve) => {
    const w = new Worker(path.join(__dirname, '..', 'renderer', 'stash', 'reader-worker.js'));
    const finish = (r) => { try { w.terminate(); } catch { } resolve(r); };
    w.on('message', (msg) => {
      if (msg && msg.phase === 'detected') return;
      finish(msg);
    });
    w.on('error', (e) => finish({ ok: false, error: String((e && e.message) || e) }));
    const ab = bitmap.buffer.slice(bitmap.byteOffset, bitmap.byteOffset + bitmap.byteLength);
    w.postMessage({ bitmap: ab, W, H, calBox: (()=>{ try { return process.env.CALBOX ? JSON.parse(process.env.CALBOX) : null; } catch { return null; } })() }, [ab]);
  });
}

app.whenReady().then(async () => {
  for (const f of files) {
    const src = f.includes('/') || f.includes('\\') ? f : path.join(__dirname, 'dialog-captures', f);
    const img = nativeImage.createFromPath(src);
    const s = img.getSize();
    if (!s.width) { console.log(f + ': unreadable'); continue; }
    const r = await readerRun(img.toBitmap(), s.width, s.height);
    console.log('== ' + f + '  (' + s.width + 'x' + s.height + ')');
    if (!r || !r.ok) { console.log('  reader failed: ' + (r && r.error)); continue; }
    console.log('  tab ' + r.tab + '  score ' + (r.score != null ? r.score.toFixed(3) : '?')
      + '  read ' + r.readCount + '/' + r.slotCount + '  auto ' + r.autoFound
      + (r.panelCoverage != null ? '  coverage ' + r.panelCoverage : ''));
    for (const x of r.reads || []) {
      console.log('   ' + String(x.apiId).padEnd(28) + String(x.count).padStart(6)
        + '  conf ' + (x.conf != null ? x.conf.toFixed(2) : '?'));
    }
  }
  app.exit(0);
});
