'use strict';
// Reprice mode: while it is on, right-clicking an item to reprice reads the price the
// game already put in the box, applies the user's rule, and leaves the result on the
// clipboard so a Ctrl+V finishes the job.
//
// Nothing here presses a key or clicks anything. It reads the screen and writes the
// clipboard; the player still pastes and still confirms. That line is deliberate.
//
// The capture path matters more than it looks. desktopCapturer.getSources() costs ~1s
// per grab on Windows regardless of thumbnail size, because it re-enumerates displays
// every call - measured, not assumed. That is twelve times the whole budget here, so
// this holds a getDisplayMedia stream open for as long as the mode is on and pulls
// single frames off it (~18-35ms). The 2s cost of opening the stream is paid once, when
// the mode is switched on.
const { clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const RepriceRules = require('./renderer/reprice-rules.js');

// Keep looking until a number appears, rather than sampling at a few fixed instants.
//
// Two delays stack here and neither is knowable in advance: the game takes a moment to
// draw the dialog, and the SCREEN CAPTURE PIPELINE ITSELF LAGS - a getDisplayMedia stream
// buffers, so the frame handed over at t+420ms can be a few hundred ms old. Fixed
// sampling at 120/260/420ms kept returning pre-dialog frames even when the dialog was
// plainly on screen, because the frames were current-but-late.
//
// So: poll. Stop the instant digits are read, which is what makes this cheap - a fast
// setup exits on the first look and never pays for the rest.
const POLL_EVERY_MS = 40;   // a frame at a time, not a paint at a time
const GIVE_UP_AFTER_MS = 1200;

function create(deps) {
  // deps: { getWin, getConfig, saveConfig, log, getHook }
  const { getWin, getConfig, saveConfig, log } = deps;

  let on = false;
  let streamReady = false;
  let busy = false;
  let hookBound = false;
  let onChange = null;

  const cfg = () => getConfig() || {};
  const say = (msg) => { try { log && log('reprice', msg); } catch { /* logging must never break a reprice */ } };

  // ---- the offscreen frame source ------------------------------------------
  // Runs in the main window's renderer: it already has a document, and a hidden helper
  // window would be one more thing to keep alive and tear down.
  async function js(code) {
    const win = getWin();
    if (!win || win.isDestroyed()) throw new Error('no window');
    return win.webContents.executeJavaScript(code, true);
  }

  // The finder is a plain UMD file, so injecting its source defines
  // window.PriceDialogFinder in the page. Shipped as source rather than duplicated here
  // so the version the app runs is the version dev/test-dialog-finder.js is tested
  // against - two copies of a pixel heuristic would drift apart silently.
  let finderSrc = null;
  function loadFinderSource() {
    if (finderSrc != null) return finderSrc;
    try { finderSrc = fs.readFileSync(path.join(__dirname, 'renderer', 'stash', 'price-dialog-finder.js'), 'utf8'); }
    catch { finderSrc = ''; }
    return finderSrc;
  }

  async function openStream() {
    if (streamReady) return true;
    try {
      const src = loadFinderSource();
      if (src) await js(src + '\n;0').catch(() => {});
      const r = await js(`(async () => {
        if (window.__rpStream && window.__rpStream.active && window.__rpVideo && __rpVideo.videoWidth > 0) return 'reused';
        window.__rpStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
        window.__rpVideo = document.createElement('video');
        __rpVideo.muted = true; __rpVideo.srcObject = __rpStream; await __rpVideo.play();
        for (let i = 0; i < 120 && !(__rpVideo.videoWidth > 0); i++) await new Promise(r => setTimeout(r, 10));
        // a stream the user stopped from the system indicator must not be reused
        __rpStream.getVideoTracks().forEach(t => t.addEventListener('ended', () => {
          window.__rpStream = null; window.__rpVideo = null;
        }));
        // Wait for a VIDEO FRAME, not a paint. requestAnimationFrame fires when this
        // window renders, and while the game is in front this window is occluded and
        // barely renders - so every grab returned the same stale frame, for a second and
        // a half at a time. requestVideoFrameCallback fires when the capture stream
        // actually delivers a new frame, which is the thing we are waiting for.
        window.__rpNextFrame = function () {
          return new Promise((resolve) => {
            let done = false;
            const go = () => { if (!done) { done = true; resolve(); } };
            if (__rpVideo.requestVideoFrameCallback) __rpVideo.requestVideoFrameCallback(() => go());
            else requestAnimationFrame(() => go());
            setTimeout(go, 250); // never hang on a stream that has stopped producing
          });
        };
        window.__rpGrab = async function (rect) {
          if (!window.__rpVideo || !__rpVideo.videoWidth) return null;
          const W = __rpVideo.videoWidth, H = __rpVideo.videoHeight;
          const x = Math.round(rect.x * W), y = Math.round(rect.y * H);
          const w = Math.max(1, Math.round(rect.w * W)), h = Math.max(1, Math.round(rect.h * H));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true });
          await window.__rpNextFrame();
          g.drawImage(__rpVideo, x, y, w, h, 0, 0, w, h);
          const px = g.getImageData(0, 0, w, h);
          // streamW/H travel with every grab so a region that reads the wrong part of the
          // screen can be told apart from a region that is simply wrong. Calibration
          // stores fractions of the DISPLAY; this reads fractions of the STREAM. If the
          // two disagree - different monitor, different aspect - the same saved numbers
          // point somewhere else, and nothing in the crop itself would show that.
          return { w, h, data: Array.from(px.data), url: c.toDataURL('image/png'), streamW: W, streamH: H };
        };

        // Locate the dialog on the frame and return only the two small crops.
        //
        // This runs HERE, next to the canvas, rather than shipping pixels to main: the
        // search region is most of the screen, and handing that over as a plain array
        // costs more than the entire read budget. What crosses the boundary is a few KB.
        window.__rpAutoGrab = async function (exclude, gameRect) {
          if (!window.__rpVideo || !__rpVideo.videoWidth) return null;
          if (!window.PriceDialogFinder) return null;
          const W = __rpVideo.videoWidth, H = __rpVideo.videoHeight;
          // Search the middle of the GAME WINDOW, not the middle of the screen.
          //
          // The dialog is centred on the window. Searching the screen's middle only found
          // it when the window happened to be centred, and widening to the whole screen to
          // cover the rest is what let scenery be mistaken for the price field. With the
          // window's own rectangle the search stays small and is right either way.
          const fx = 0.5, fy = 0.6;
          const g = gameRect && gameRect.w > 0
            ? { x: gameRect.x * W, y: gameRect.y * H, w: gameRect.w * W, h: gameRect.h * H }
            : { x: 0, y: 0, w: W, h: H };
          const sx = Math.max(0, Math.round(g.x + g.w * (1 - fx) / 2));
          const sy = Math.max(0, Math.round(g.y + g.h * (1 - fy) / 2));
          const sw = Math.min(W - sx, Math.round(g.w * fx));
          const sh = Math.min(H - sy, Math.round(g.h * fy));
          if (sw < 40 || sh < 40) return null;
          const c = document.createElement('canvas'); c.width = sw; c.height = sh;
          const g = c.getContext('2d', { willReadFrequently: true });
          await window.__rpNextFrame();
          g.drawImage(__rpVideo, sx, sy, sw, sh, 0, 0, sw, sh);
          const px = g.getImageData(0, 0, sw, sh);
          // search:1 - this frame IS the search region already; screenH keeps the block
          // size scaled against the real display rather than this crop
          // exclude arrives as screen fractions; the finder wants pixels of THIS crop
          const ex = (exclude || []).map((r) => ({
            x: Math.round(r.x * W) - sx, y: Math.round(r.y * H) - sy,
            w: Math.round(r.w * W), h: Math.round(r.h * H),
          }));
          const hit = window.PriceDialogFinder.find(px.data, sw, sh, { search: 1, screenH: H, exclude: ex });
          if (!hit) return null;
          const cut = (r, pad) => {
            const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
            const w = Math.min(sw - x, r.w + pad * 2), h = Math.min(sh - y, r.h + pad * 2);
            if (w < 2 || h < 2) return null;
            const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
            const gg = cc.getContext('2d', { willReadFrequently: true });
            gg.putImageData(px, -x, -y);
            const d = gg.getImageData(0, 0, w, h);
            return { w, h, data: Array.from(d.data), url: cc.toDataURL('image/png') };
          };
          const num = cut(hit.block, 3);
          // Two candidate framings for the icon - a fitted box and one scanned out of the
          // pixels. Neither is right everywhere, so both travel and the matcher keeps
          // whichever actually matches the artwork.
          const icon = cut(hit.icon, 0);
          const iconAlt = hit.iconAlt ? cut(hit.iconAlt, 0) : null;
          if (!num) return null;
          return { num, icon, iconAlt, streamW: W, streamH: H,
            block: { x: hit.block.x + sx, y: hit.block.y + sy, w: hit.block.w, h: hit.block.h },
            candidates: hit.candidates };
        };
        return __rpVideo.videoWidth + 'x' + __rpVideo.videoHeight;
      })()`);
      streamReady = true;
      say('stream open: ' + r);
      return true;
    } catch (err) {
      say('stream failed: ' + (err && err.message || err));
      streamReady = false;
      return false;
    }
  }

  async function closeStream() {
    streamReady = false;
    try {
      await js(`(() => {
        if (window.__rpStream) { try { __rpStream.getTracks().forEach(t => t.stop()); } catch (e) {} }
        window.__rpStream = null; window.__rpVideo = null; window.__rpGrab = null; return 1;
      })()`);
    } catch { /* the window may already be gone; the stream dies with it */ }
  }

  // Returns { num, icon, block, ... } or null when no highlighted price field is on
  // screen - which is the honest answer when the dialog is not open yet.
  async function autoGrab() {
    // The badge is part of the screen the capture sees, so it has to be taken out of the
    // search or the reader finds its own last result and reads that instead.
    let ex = [];
    try { ex = (deps.excludeRects && deps.excludeRects()) || []; } catch { }
    let gr = null;
    try { gr = (deps.gameRect && deps.gameRect()) || null; } catch { }
    try {
      return await js('window.__rpAutoGrab ? window.__rpAutoGrab('
        + JSON.stringify(ex) + ',' + JSON.stringify(gr) + ') : null');
    } catch { return null; }
  }

  async function grab(rect) {
    if (!streamReady) return null;
    try { return await js(`window.__rpGrab && __rpGrab(${JSON.stringify(rect)})`); }
    catch (err) { say('grab failed: ' + (err && err.message || err)); return null; }
  }

  // ---- one reprice ---------------------------------------------------------
  async function attempt() {
    const region = cfg().repriceRegion;

    const t0 = Date.now();
    let looks = 0;
    let usedAuto = false;
    while (Date.now() - t0 < GIVE_UP_AFTER_MS) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      const wait = Date.now() - t0;
      looks++;

      // Locate the dialog on the frame. The dialog is centred and sizes to its contents,
      // so the number is somewhere different for every item - a saved box is right for
      // the item it was drawn on and wrong for the next one.
      let shot = null, iconShot = null;
      const auto = await autoGrab();
      if (auto) { shot = auto.num; iconShot = auto.icon; usedAuto = true; }
      // Calibration is the FALLBACK, not the primary. Net Worth lost its calibration to
      // auto-detection once and had to have it put back when other resolutions failed;
      // the same mistake is not worth making twice, so the boxes stay.
      else if (region && region.w > 0) {
        shot = await grab(region);
        iconShot = null;
      }
      if (!shot) continue;

      // The measured block height travels with the read so main can tell whether the
      // glyphs on screen are a size it has templates for.
      const base = deps.readPrice
        ? await deps.readPrice(shot, { at: wait, auto: usedAuto, blockH: auto && auto.block ? auto.block.h : 0 })
        : null;
      if (base == null) continue;

      const ctx = {};
      // Optional. A rule that does not branch on currency never needs it, and an
      // unidentified icon leaves ctx.currency undefined, which the rule engine treats as
      // "unknown" and sends down the else branch rather than guessing.
      if (deps.readCurrency) {
        const ic = iconShot || (cfg().repriceIconRegion ? await grab(cfg().repriceIconRegion) : null);
        if (ic) ctx.currency = await deps.readCurrency(ic, auto ? auto.iconAlt : null);
      }
      const out = RepriceRules.apply(base, RepriceRules.fromConfig(cfg()), ctx);
      if (out == null) { say(`read ${base} but the rule produced nothing`); return; }
      if (out === base) { say(`read ${base}, rule leaves it unchanged - clipboard untouched`); return; }
      clipboard.writeText(String(out));
      say(`read ${base}${ctx.currency ? ' ' + ctx.currency : ''} -> ${out} (after ${wait}ms)`);
      const info = { base, result: out, currency: ctx.currency || null };
      if (onChange) onChange(info);
      try { if (deps.onRead) deps.onRead(info); } catch { }
      return;
    }
    say(`no number found (${looks} looks over ${Date.now() - t0}ms`
      + (region && region.w > 0 ? '' : ', no calibrated fallback') + ')');
    try { if (deps.onRead) deps.onRead(null); } catch { }
  }

  function onRightClick() {
    if (!on || busy) return;
    busy = true;
    attempt().catch((err) => say('failed: ' + (err && err.message || err))).finally(() => { busy = false; });
  }

  // ---- mode ----------------------------------------------------------------
  async function setOn(next) {
    next = !!next;
    if (next === on) return on;
    if (next) {
      const ok = await openStream();
      if (!ok) return false;      // no stream, no mode - do not pretend it is armed
      bindHook();
      on = true;
    } else {
      on = false;
      await closeStream();
    }
    notify();
    try { if (deps.onModeChange) deps.onModeChange(on); } catch { }
    return on;
  }

  function bindHook() {
    if (hookBound) return;
    const hook = deps.getHook && deps.getHook();
    if (!hook || !hook.uIOhook) { say('no input hook - right-clicks cannot be seen'); return; }
    try {
      hook.uIOhook.on('mousedown', (e) => { if (e.button === 2 || e.button === 3) onRightClick(); });
      hookBound = true;
    } catch (err) { say('hook bind failed: ' + (err && err.message || err)); }
  }

  function notify() {
    const win = getWin();
    try { if (win && !win.isDestroyed()) win.webContents.send('reprice-mode', on); } catch { }
  }

  return {
    isOn: () => on,
    toggle: () => setOn(!on),
    setOn,
    grab,          // the calibration flow needs a frame too
    openStream,
    closeStream,
    setOnChange: (fn) => { onChange = fn; },
  };
}

module.exports = { create, POLL_EVERY_MS, GIVE_UP_AFTER_MS };
