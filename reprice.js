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

// How long after the right-click to look. The modal is not up instantly, and its draw
// time varies, so a single fixed delay is either always slow or sometimes wrong. Read
// early, and if nothing parses, read again - the retry costs nothing when the first
// read works and covers the tail when the game is slow.
const READ_AT_MS = [120, 260, 420];

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
        window.__rpGrab = async function (rect) {
          if (!window.__rpVideo || !__rpVideo.videoWidth) return null;
          const W = __rpVideo.videoWidth, H = __rpVideo.videoHeight;
          const x = Math.round(rect.x * W), y = Math.round(rect.y * H);
          const w = Math.max(1, Math.round(rect.w * W)), h = Math.max(1, Math.round(rect.h * H));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true });
          await new Promise(r => requestAnimationFrame(r));
          g.drawImage(__rpVideo, x, y, w, h, 0, 0, w, h);
          const px = g.getImageData(0, 0, w, h);
          return { w, h, data: Array.from(px.data), url: c.toDataURL('image/png') };
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

    // READ_AT_MS are offsets FROM THE CLICK, so each sleep is the gap since the last one
    for (let i = 0; i < READ_AT_MS.length; i++) {
      const wait = READ_AT_MS[i];
      await new Promise((r) => setTimeout(r, i === 0 ? wait : wait - READ_AT_MS[i - 1]));
      const shot = await grab(region);
      if (!shot) continue;
      const base = deps.readPrice ? await deps.readPrice(shot) : null;
      if (base == null) continue;

      const ctx = {};
      if (deps.readCurrency && cfg().repriceCurrencyRegion) {
        const icon = await grab(cfg().repriceCurrencyRegion);
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
    say('no number found in the price box');
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

module.exports = { create, READ_AT_MS };
