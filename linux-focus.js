'use strict';
// linux-focus.js - the Linux half of focus-native.js: "is the game the active window"
// and "make the game active". Win32 does this with in-process user32 calls (see
// focus-native.js); there is no equivalent that works everywhere on Linux, so this
// shells out to xdotool when it is installed and reports "can't tell" when it isn't.
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

const { execFileSync } = require('child_process');

const DEFAULT_NAME = 'Path of Exile 2';
const CLASS_RE = /steam_app_2694490|pathofexile/i;

let toolChecked = false;
let toolOk = false;

function have() {
  if (toolChecked) return toolOk;
  toolChecked = true;
  if (process.platform !== 'linux') return (toolOk = false);
  try {
    execFileSync('xdotool', ['--version'], { timeout: 1500, stdio: 'ignore' });
    toolOk = true;
  } catch {
    toolOk = false;
  }
  return toolOk;
}

function run(args) {
  try {
    return String(execFileSync('xdotool', args, { timeout: 1500, encoding: 'utf8' }) || '').trim();
  } catch {
    return '';
  }
}

// true / false / null (no way to tell: not linux, or xdotool missing)
function foregroundIsGame(nameMatch) {
  if (process.platform !== 'linux' || !have()) return null;
  const id = run(['getactivewindow']);
  if (!id) return null;
  const cls = run(['getwindowclassname', id]);
  if (cls && CLASS_RE.test(cls)) return true;
  const title = run(['getwindowname', id]);
  const want = String(nameMatch || DEFAULT_NAME).toLowerCase();
  if (title && title.toLowerCase().includes(want)) return true;
  // an answer we trust: something else is active
  return !!(id && (cls || title)) ? false : null;
}

// best-effort activate; returns true when we believe the game was raised
function focusGame(nameMatch) {
  if (process.platform !== 'linux' || !have()) return false;
  const byClass = run(['search', '--class', 'steam_app_2694490']).split('\n').filter(Boolean);
  const byName = byClass.length ? [] : run(['search', '--name', String(nameMatch || DEFAULT_NAME)]).split('\n').filter(Boolean);
  const id = (byClass[0] || byName[0] || '').trim();
  if (!id) return false;
  run(['windowactivate', '--sync', id]);
  return true;
}

module.exports = { available: have, foregroundIsGame, focusGame, DEFAULT_NAME };
