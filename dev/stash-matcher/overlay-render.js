// Minimal, fast numbered-overlay: read frame + a positions JSON, stamp red number
// badges, capture via a visible window (reliable), save PNG. No icon downloads.
//   POS=<json with [{n,cx,cy}]> npx electron dev/stash-matcher/overlay-render.js
const { app, nativeImage, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const IMG = process.env.IMG || path.join(os.tmpdir(), 'poe2-screen-capture.png');
const POS = process.env.POS || path.join(os.tmpdir(), 'draft-overlay.json');
const CROP = { x: 20, y: 180, width: 600, height: 880 };
const CW = CROP.width, CH = CROP.height;

app.whenReady().then(async () => {
  const img = nativeImage.createFromPath(IMG);
  const pts = JSON.parse(fs.readFileSync(POS, 'utf8'));
  const cropPath = path.join(os.tmpdir(), '_crop.png');
  const htmlPath = path.join(os.tmpdir(), '_overlay.html');
  fs.writeFileSync(cropPath, img.crop(CROP).toPNG());
  const badges = pts.map((d) => `<div class="b" style="left:${d.cx - CROP.x + 14}px;top:${d.cy - CROP.y + 12}px">${d.n}</div>`).join('');
  const html = `<html><head><meta charset="utf-8"><style>*{margin:0;padding:0}
    body{width:${CW}px;height:${CH}px;position:relative;overflow:hidden}
    img{position:absolute;left:0;top:0}
    .b{position:absolute;background:#ff2d2d;color:#fff;font:bold 12px monospace;padding:0 2px;border-radius:2px}</style></head>
    <body><img src="file:///${cropPath.replace(/\\/g, '/')}">${badges}</body></html>`;
  fs.writeFileSync(htmlPath, html);
  const out = path.join(os.tmpdir(), 'overlay.png');
  const win = new BrowserWindow({ width: CW, height: CH, show: true, frame: false, webPreferences: { webSecurity: false } });
  const done = (c) => { try { win.destroy(); } catch (e) {} app.exit(c); };
  setTimeout(() => done(1), 15000);
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 700));
    try { const shot = await win.webContents.capturePage(); fs.writeFileSync(out, shot.toPNG()); console.log('overlay -> ' + out + '  (' + pts.length + ' badges)'); }
    catch (e) { console.log('capture err ' + e.message); }
    done(0);
  });
  await win.loadFile(htmlPath);
});
