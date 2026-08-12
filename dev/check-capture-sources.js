'use strict';
// Does the capture stream cover the same area calibration measures?
//
//   npx electron dev/check-capture-sources.js
//
// Calibration stores a region as a fraction of the PRIMARY DISPLAY. The reprice reader
// applies that fraction to whatever the getDisplayMedia stream hands it. Those are only
// the same rectangle if the stream is that display - if it is another monitor, or the
// whole virtual desktop, the same saved numbers point somewhere else entirely.
const { app, BrowserWindow, screen, session, desktopCapturer } = require('electron');

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  console.log('displays: ' + displays.length);
  for (const d of displays) {
    console.log('  id=' + d.id + (d.id === primary.id ? ' PRIMARY' : '')
      + '  ' + d.size.width + 'x' + d.size.height + ' @' + d.scaleFactor
      + '  bounds=' + JSON.stringify(d.bounds));
  }
  const capW = Math.round(primary.size.width * primary.scaleFactor);
  const capH = Math.round(primary.size.height * primary.scaleFactor);
  console.log('\ncalibration measures against: ' + capW + 'x' + capH);

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  console.log('\ndesktopCapturer screen sources, in the order returned:');
  sources.forEach((s, i) => console.log('  [' + i + '] display_id=' + s.display_id + '  id=' + s.id + '  name=' + s.name));
  const primaryId = String(primary.id);
  const firstScreen = sources.find((x) => x.id.startsWith('screen')) || sources[0];
  const byId = sources.find((x) => x.display_id === primaryId);
  console.log('\n  "first screen" would pick : ' + (firstScreen ? firstScreen.display_id : 'none'));
  console.log('  pinning to primary picks : ' + (byId ? byId.display_id : 'NONE - no source matches the primary display'));
  if (firstScreen && byId && firstScreen.display_id !== byId.display_id) {
    console.log('  >>> THESE DISAGREE - ordering alone would capture the wrong monitor');
  }

  session.defaultSession.setDisplayMediaRequestHandler(async (_r, cb) => {
    const src = sources.find((x) => x.display_id === primaryId) || firstScreen;
    cb(src ? { video: src, audio: false } : {});
  }, { useSystemPicker: false });

  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,<html><body></body></html>');
  const got = await w.webContents.executeJavaScript(`
    (async () => {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const v = document.createElement('video');
        v.srcObject = s; v.muted = true;
        await v.play().catch(() => {});
        await new Promise((r) => (v.videoWidth ? r() : v.addEventListener('loadedmetadata', r, { once: true })));
        const out = { w: v.videoWidth, h: v.videoHeight };
        s.getTracks().forEach((t) => t.stop());
        return out;
      } catch (e) { return { error: String(e && e.message || e) }; }
    })()
  `, true);

  console.log('\nstream delivers: ' + (got.error ? 'ERROR ' + got.error : got.w + 'x' + got.h));
  if (!got.error) {
    const sameAspect = Math.abs((got.w / got.h) - (capW / capH)) < 0.01;
    console.log('  aspect matches the primary display: ' + (sameAspect ? 'yes' : 'NO'));
    console.log(sameAspect
      ? '  -> fractions of the display map correctly onto this stream'
      : '  -> FRACTIONS DO NOT MAP. Every calibrated region reads the wrong place.');
  }
  app.exit(0);
});
