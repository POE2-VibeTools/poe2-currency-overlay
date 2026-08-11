// Capture the CALIBRATED price-box region, once a second, for building the digit
// templates. Reads the region the user drew in Settings > Reprice > Calibrate, so this
// script never guesses a coordinate.
//
//   node_modules/electron/dist/electron.exe dev/capture-reprice-box.js [seconds]
//
// Then, in game: open Set Item Price, type 12345, Ctrl+A, wait ~2s. Type 67890, Ctrl+A,
// wait ~2s. Ctrl+A matters - the reader only ever sees the SELECTED state, because the
// game selects the value the moment the dialog opens.
//
// Frames land in dev/reprice-captures/. Feed the two you want to
// dev/build-reprice-digits.js.
const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUT = path.join(__dirname, 'reprice-captures');
const SECONDS = Number(process.argv[process.argv.length - 1]) || 60;

function readConfig() {
  const p = path.join(os.homedir(), 'AppData', 'Roaming', 'poe2-price-overlay', 'overlay-config.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

app.whenReady().then(async () => {
  const cfg = readConfig();
  const region = cfg.repriceRegion;
  if (!region || !(region.w > 0)) {
    console.log('No calibrated region. Open Settings > Reprice > Calibrate and drag a box');
    console.log('around the price number first - this script deliberately does not guess.');
    app.exit(1); return;
  }
  console.log('using calibrated region ' + JSON.stringify(region));
  fs.mkdirSync(OUT, { recursive: true });

  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }))
      .find((s) => s.id.startsWith('screen'));
    cb({ video: src, audio: false });
  }, { useSystemPicker: false });

  const w = new BrowserWindow({ width: 300, height: 120, show: false,
    webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  // getDisplayMedia needs a secure context, and a data: URL is not one - load a real file
  const blank = path.join(OUT, '_blank.html');
  fs.writeFileSync(blank, '<html><body></body></html>');
  await w.loadFile(blank);

  await w.webContents.executeJavaScript(`(async () => {
    window.__s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    window.__v = document.createElement('video');
    __v.muted = true; __v.srcObject = __s; await __v.play();
    for (let i = 0; i < 100 && !(__v.videoWidth > 0); i++) await new Promise(r => setTimeout(r, 10));
    window.__shot = async function (r) {
      const W = __v.videoWidth, H = __v.videoHeight;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(r.w * W)); c.height = Math.max(1, Math.round(r.h * H));
      await new Promise(k => requestAnimationFrame(k));
      c.getContext('2d').drawImage(__v, Math.round(r.x * W), Math.round(r.y * H), c.width, c.height, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    };
    return __v.videoWidth + 'x' + __v.videoHeight;
  })()`, true);

  console.log('capturing for ' + SECONDS + 's -> ' + path.relative(path.join(__dirname, '..'), OUT));
  console.log('in game: type 12345, Ctrl+A, wait. then 67890, Ctrl+A, wait.\n');

  let prev = '', kept = 0;
  for (let i = 0; i < SECONDS; i++) {
    const url = await w.webContents.executeJavaScript('__shot(' + JSON.stringify(region) + ')', true);
    if (url && url !== prev) {   // only frames that changed
      fs.writeFileSync(path.join(OUT, 'f' + String(i).padStart(3, '0') + '.png'),
        Buffer.from(url.split(',')[1], 'base64'));
      prev = url; kept++;
      process.stdout.write('.');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  try { fs.unlinkSync(blank); } catch { }
  console.log('\n' + kept + ' frames kept');
  app.quit();
});
