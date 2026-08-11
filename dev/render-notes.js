// Render the newest patch-note entry exactly as the app's "What's new" popup will show it.
// See PATCH-NOTES.md. Usage:
//   node_modules/electron/dist/electron.exe dev/render-notes.js [industry]
// Writes notes-<theme>.png at the repo root.
// Render the real "What's new" popup for the newest entry, using the app's own
// stylesheets and the exact same note-to-HTML rules as renderer.js renderNoteEntry.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..') + '/';
const SP = require('os').tmpdir();

const src = fs.readFileSync(ROOT + 'renderer/release-notes.js', 'utf8');
const rel = eval(src.replace('window.RELEASE_NOTES =', 'var _n =') + '; _n')[0];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// identical to renderer.js: ':' ends a section heading, leading space makes a sub-bullet
const lis = (rel.notes || []).map((n) => {
  const sub = /^\s+\S/.test(n);
  const text = String(n).trim();
  if (/:\s*$/.test(text)) return `<li class="notes-sec">${esc(text)}</li>`;
  return `<li${sub ? ' class="notes-sub"' : ''}>${esc(text)}</li>`;
}).join('');

const body = `<div class="notes-rel"><div class="notes-rel-head"><span class="notes-rel-ver">v${esc(rel.version)}</span>`
  + `<span class="notes-rel-date">${esc(rel.date)}</span></div>`
  + (rel.title ? `<div class="notes-rel-sub">${esc(rel.title)}</div>` : '')
  + `<ul class="notes-list">${lis}</ul></div>`;

const html = `<link rel="stylesheet" href="${ROOT}renderer/tokens.css">
<link rel="stylesheet" href="${ROOT}renderer/styles.css">
<link rel="stylesheet" href="${ROOT}renderer/themes.css">
<style>html,body{margin:0;background:var(--s-root);height:100%}#notes-modal{position:static!important;display:flex;align-items:center;justify-content:center;height:100%}</style>
<div id="notes-modal">
  <div class="notes-card">
    <div class="notes-head">
      <div>
        <div id="notes-title" class="notes-title">What's new</div>
        <div id="notes-sub" class="notes-sub"></div>
      </div>
      <button id="notes-close" class="icon-btn" title="Close">&#x2715;</button>
    </div>
    <div class="notes-main">
      <div id="notes-body" class="notes-body">${body}</div>
    </div>
    <div class="notes-actions"><button id="notes-dismiss" class="mini-btn">Got it</button></div>
  </div>
</div>`;

const theme = process.argv[process.argv.length - 1];
const f = path.join(SP, '_notes.html');
fs.writeFileSync(f, html);

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 720, height: 900, show: false, webPreferences: { offscreen: true } });
  await w.loadFile(f);
  if (theme === 'industry') await w.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme','industry')");
  await new Promise((r) => setTimeout(r, 900));
  fs.writeFileSync(path.join(SP, 'notes-' + theme + '.png'), (await w.webContents.capturePage()).toPNG());
  console.log('saved notes-' + theme + '.png');
  app.quit();
});
