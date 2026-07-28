'use strict';
// linux-focus.js - the Linux half of focus-native.js: "is the game the active window"
// and "make the game active". Win32 does this with in-process user32 calls (see
// focus-native.js); there is no equivalent that works everywhere on Linux, so this
// shells out to xdotool when it is installed and reports "can't tell" when it isn't.
//
// EVERYTHING HERE IS ASYNC AND FIRE-AND-FORGET. The first version used execFileSync,
// which blocked the main process for the length of an xdotool search plus a
// `windowactivate --sync` - about three seconds - on every hide. Field report: "the X
// button now takes 3 seconds". Nothing the user waits on may block on a subprocess.
//
// Why xdotool rather than an X11 FFI: the app already needs XWayland (Electron 43
// cannot register global shortcuts under native Wayland at all), and under XWayland
// xdotool's window queries are the same calls a native binding would make - without
// shipping and packaging a native module we can't test on this machine. Absent
// xdotool the app degrades to exactly today's behavior, it doesn't break.
//
// Matching is by WM_CLASS and _NET_WM_NAME. Steam's Proton window reports
// WM_CLASS "steam_app_2694490" and _NET_WM_NAME "Path of Exile 2"; both are matched,
// and config.gameWindowMatch overrides the name for non-English clients.

const { execFile } = require('child_process');

const DEFAULT_NAME = 'Path of Exile 2';
const CLASS_RE = /steam_app_2694490|pathofexile/i;
const CACHE_MS = 400; // a hotkey burst asks repeatedly; one answer covers the burst

let toolOk = null; // null = not probed yet
let lastFg = { at: 0, value: null };

function probe() {
  if (toolOk !== null || process.platform !== 'linux') return;
  toolOk = false; // assume missing until the probe says otherwise
  try {
    execFile('xdotool', ['--version'], { timeout: 1500 }, (err) => { toolOk = !err; });
  } catch { /* toolOk stays false */ }
}
if (process.platform === 'linux') probe();

function run(args, cb) {
  try {
    execFile('xdotool', args, { timeout: 1200, encoding: 'utf8' }, (err, out) => {
      cb(err ? '' : String(out || '').trim());
    });
  } catch { cb(''); }
}

// Cached, non-blocking: returns true / false / null (nothing here can tell). The
// refresh runs in the background so the CALLER never waits on a subprocess.
function foregroundIsGame(nameMatch) {
  if (process.platform !== 'linux' || !toolOk) return null;
  const now = Date.now();
  if (now - lastFg.at < CACHE_MS) return lastFg.value;
  lastFg.at = now; // claim the slot before the async work, so bursts don't stack
  run(['getactivewindow'], (id) => {
    if (!id) { lastFg = { at: Date.now(), value: null }; return; }
    run(['getwindowclassname', id], (cls) => {
      if (cls && CLASS_RE.test(cls)) { lastFg = { at: Date.now(), value: true }; return; }
      run(['getwindowname', id], (title) => {
        const want = String(nameMatch || DEFAULT_NAME).toLowerCase();
        const hit = !!(title && title.toLowerCase().includes(want));
        lastFg = { at: Date.now(), value: hit ? true : (cls || title ? false : null) };
      });
    });
  });
  return lastFg.value; // previous answer while the refresh lands; null on the first call
}

// Best-effort raise. Returns immediately; the activation happens in the background.
function focusGame(nameMatch) {
  if (process.platform !== 'linux' || !toolOk) return false;
  run(['search', '--class', 'steam_app_2694490'], (byClass) => {
    const first = byClass.split('\n').filter(Boolean)[0];
    if (first) return run(['windowactivate', first.trim()], () => {});
    run(['search', '--name', String(nameMatch || DEFAULT_NAME)], (byName) => {
      const id = byName.split('\n').filter(Boolean)[0];
      if (id) run(['windowactivate', id.trim()], () => {});
    });
  });
  return true;
}

// Press Ctrl+C wherever the keyboard focus already is - i.e. the game, since the
// overlay is shown inactive and never steals focus. This is the copy uiohook cannot
// perform here: libuiohook can't read the keyboard under XWayland (XkbGetKeyboard
// fails), falls back to xfree86 scancode tables on an evdev system, and posts
// mistranslated keycodes. xdotool goes through XTEST with the right mapping, and the
// tester confirmed it copies a real item ("sleep 5; xdotool key --clearmodifiers
// ctrl+c" while hovering an item put the item text on the clipboard).
// --clearmodifiers matters: the user is physically holding Ctrl+F when this fires.
function sendCopy() {
  if (process.platform !== 'linux' || !toolOk) return false;
  run(['key', '--clearmodifiers', 'ctrl+c'], () => {});
  return true;
}

module.exports = { available: () => !!toolOk, foregroundIsGame, focusGame, sendCopy, DEFAULT_NAME };
