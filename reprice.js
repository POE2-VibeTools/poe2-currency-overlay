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

  async function openStream() {
    if (streamReady) return true;
    try {
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

  async function grab(rect) {
    if (!streamReady) return null;
    try { return await js(`window.__rpGrab && __rpGrab(${JSON.stringify(rect)})`); }
    catch (err) { say('grab failed: ' + (err && err.message || err)); return null; }
  }

  // ---- one reprice ---------------------------------------------------------
  async function attempt() {
    const region = cfg().repriceRegion;
    if (!region || !(region.w > 0)) { say('no calibrated region'); return; }

    const t0 = Date.now();
    let looks = 0;
    while (Date.now() - t0 < GIVE_UP_AFTER_MS) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      const wait = Date.now() - t0;
      looks++;
      const shot = await grab(region);
      if (!shot) continue;
      const base = deps.readPrice ? await deps.readPrice(shot, { at: wait }) : null;
      if (base == null) continue;

      const ctx = {};
      // Optional. A rule that does not branch on currency never needs this box, and an
      // unidentified icon leaves ctx.currency undefined, which the rule engine treats as
      // "unknown" and sends down the else branch rather than guessing.
      if (deps.readCurrency && cfg().repriceIconRegion) {
        const icon = await grab(cfg().repriceIconRegion);
        if (icon) ctx.currency = await deps.readCurrency(icon);
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
    say(`no number found in the price box (${looks} looks over ${Date.now() - t0}ms)`);
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
