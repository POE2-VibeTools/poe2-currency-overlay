'use strict';
// Run the vendored EE2 parser on one pasted item text, offline - the same bundle and
// the same init the item tab uses - so "the paste no-ops" can be split into "the text
// does not parse" versus "the paste never reaches the parser".
//
//   npx electron dev/parse-ru-item.js <file.txt>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const a = process.argv.slice(2).filter((v) => !v.endsWith('.exe') && !v.endsWith('parse-ru-item.js'));
const text = fs.readFileSync(a[0], 'utf8');

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true, nodeIntegration: false } });
  // load the real index.html so the bundle sees the same document it always does
  await w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const out = await w.webContents.executeJavaScript(`(async () => {
    try {
      if (!window.EE2) return { fail: 'no EE2 on window' };
      await window.EE2.init('ru');
      const r = window.EE2.parse(${JSON.stringify(text)});
      return { ok: r.ok, error: r.error || null,
        category: r.ok && r.item ? (r.item.category || r.item.class || null) : null,
        name: r.ok && r.item ? (r.item.name || null) : null,
        mods: r.ok && r.item && r.item.mods ? r.item.mods.length
          : (r.ok && r.item && r.item.stats ? r.item.stats.length : null) };
    } catch (e) { return { fail: String((e && e.message) || e) }; }
  })()`, true);
  console.log(JSON.stringify(out, null, 1));
  app.exit(0);
});
