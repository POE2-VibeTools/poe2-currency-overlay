'use strict';
// focus-native.js - hand keyboard focus to the game via in-process Win32 calls.
//
// The old path spawned PowerShell + WScript.Shell.AppActivate('Path of Exile 2').
// That fails structurally: Windows' foreground-permission check applies to the
// PROCESS making the call, and a freshly spawned powershell.exe is a background
// process, so the request is refused (or honored seconds late). It also matched
// by window TITLE. This module instead does what EE2's
// OverlayController.focusTarget() does: track the game's HWND and call
// SetForegroundWindow from THIS process - which holds foreground rights whenever
// the overlay is focused or the user pressed one of our RegisterHotKey hotkeys -
// wrapped in the AttachThreadInput combo so it also works from the edge states
// (focus stranded on the desktop after a blur).
//
// Matching: primary = process exe basename /^pathofexile.*\.exe$/i (covers
// standalone / Steam / _x64 variants; titles are what browsers and wikis shadow),
// fallback = exact window title "Path of Exile" / "Path of Exile 2". Never our
// own pid. The HWND is cached and re-found when stale (game restarted).

const SW_RESTORE = 9;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

let api = null; // bound Win32 fns; false = koffi failed to load
let loadError = '';
let cached = null; // { hwnd, title, exe, pid } of the game window

function bind() {
  if (api !== null) return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    koffi.proto('int __stdcall EnumWindowsProc(void *hwnd, intptr_t lparam)');
    api = {
      koffi,
      EnumWindows: user32.func('int __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lparam)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buf, int max)'),
      IsWindowVisible: user32.func('int __stdcall IsWindowVisible(void *hwnd)'),
      IsWindow: user32.func('int __stdcall IsWindow(void *hwnd)'),
      IsIconic: user32.func('int __stdcall IsIconic(void *hwnd)'),
      ShowWindow: user32.func('int __stdcall ShowWindow(void *hwnd, int cmd)'),
      BringWindowToTop: user32.func('int __stdcall BringWindowToTop(void *hwnd)'),
      SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(void *hwnd)'),
      SetFocus: user32.func('void * __stdcall SetFocus(void *hwnd)'),
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)'),
      AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int attach)'),
      GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
      OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
      QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(void *h)'),
      GetWindowRect: user32.func('int __stdcall GetWindowRect(void *hwnd, _Out_ int *rect)'),
      ReleaseCapture: user32.func('int __stdcall ReleaseCapture()'),
      // hwnd declared as intptr_t, not void*: the caller holds the handle VALUE (read
      // out of Electron's getNativeWindowHandle Buffer), and passing the Buffer itself
      // would pass a pointer to the buffer's contents instead of the handle.
      // PostMessageW, not SendMessageW: WM_NCLBUTTONDOWN starts a MODAL resize loop,
      // and Send would run that whole loop inside the IPC handler - blocking main (and
      // the ipc reply) until the mouse is released. Post queues it and returns.
      PostMessageW: user32.func('int __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t wparam, intptr_t lparam)'),
    };
  } catch (err) {
    api = false;
    loadError = String((err && err.message) || err);
  }
  return api;
}

// Load koffi off the hotkey path (same reason uiohook is warmed at startup:
// a native addon's first require can cost hundreds of ms).
function warm() {
  if (process.platform !== 'win32') return; // Win32-only (user32 FFI); no-op elsewhere
  const a = bind();
  if (a && !cached) {
    try { cached = findGame(); } catch {}
  }
}

function exeOf(a, pid) {
  if (!pid) return '';
  const h = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!h) return '';
  try {
    const buf = Buffer.alloc(1040);
    const size = [519];
    if (!a.QueryFullProcessImageNameW(h, 0, buf, size)) return '';
    const full = buf.toString('utf16le', 0, size[0] * 2);
    return full.split(/[\\/]/).pop() || '';
  } catch {
    return '';
  } finally {
    try { a.CloseHandle(h); } catch {}
  }
}

function listWindows() {
  const a = bind();
  if (!a) return [];
  const out = [];
  const tbuf = Buffer.alloc(1024);
  a.EnumWindows((hwnd) => {
    try {
      if (!a.IsWindowVisible(hwnd)) return 1;
      const n = a.GetWindowTextW(hwnd, tbuf, 512);
      if (n <= 0) return 1;
      const pidOut = [0];
      a.GetWindowThreadProcessId(hwnd, pidOut);
      out.push({
        hwnd,
        title: tbuf.toString('utf16le', 0, n * 2),
        pid: pidOut[0],
        exe: exeOf(a, pidOut[0]),
      });
    } catch {}
    return 1; // continue enumeration
  }, 0);
  return out;
}

function findGame() {
  let byTitle = null;
  for (const w of listWindows()) {
    if (w.pid === process.pid) continue;
    if (/^pathofexile.*\.exe$/i.test(w.exe)) return w;
    if (!byTitle && /^Path of Exile( 2)?$/i.test(w.title)) byTitle = w;
  }
  return byTitle;
}

// Force the game window to the foreground. Returns { ok, detail } - ok means
// GetForegroundWindow actually reports the game afterwards, not just that the
// calls didn't throw.
function focus() {
  if (process.platform !== 'win32') return { ok: false, detail: 'focus-native is Win32-only' };
  const a = bind();
  if (!a) return { ok: false, detail: 'koffi unavailable: ' + loadError };
  if (!cached || !a.IsWindow(cached.hwnd)) cached = findGame();
  if (!cached) return { ok: false, detail: 'game window not found' };
  const hwnd = cached.hwnd;
  try {
    if (a.IsIconic(hwnd)) a.ShowWindow(hwnd, SW_RESTORE);
    const ourTid = a.GetCurrentThreadId();
    const targetTid = a.GetWindowThreadProcessId(hwnd, null);
    const fg = a.GetForegroundWindow();
    const fgTid = fg ? a.GetWindowThreadProcessId(fg, null) : 0;
    // Attach our input queue to both the current-foreground thread and the
    // game's - the documented escape hatch from the foreground lock (same combo
    // node-window-manager's bringToTop uses).
    const attached = [];
    for (const tid of [fgTid, targetTid]) {
      if (tid && tid !== ourTid && attached.indexOf(tid) < 0) {
        try { if (a.AttachThreadInput(ourTid, tid, 1)) attached.push(tid); } catch {}
      }
    }
    let landed = false;
    try {
      a.BringWindowToTop(hwnd);
      a.SetForegroundWindow(hwnd);
      a.SetFocus(hwnd);
      const now = a.GetForegroundWindow();
      landed = !!now && a.koffi.address(now) === a.koffi.address(hwnd);
    } finally {
      for (const tid of attached) {
        try { a.AttachThreadInput(ourTid, tid, 0); } catch {}
      }
    }
    return {
      ok: landed,
      detail: (landed ? 'focused ' : 'refused ') + (cached.exe || cached.title),
    };
  } catch (err) {
    cached = null; // stale/odd handle state - re-find next time
    return { ok: false, detail: 'ERROR ' + ((err && err.message) || err) };
  }
}

// Is the game the CURRENT foreground window? Cheap gate for synthesized
// keystrokes: never type into whatever else (Discord, a browser) happens to
// hold focus when a global hotkey fires.
//
// true = the game has focus, false = something else does, null = THIS PLATFORM
// CANNOT TELL (no window detection outside Win32 yet). A hard false on Linux meant
// command hotkeys could never fire there at all; callers treat null as "can't tell"
// and go ahead, since the user pressed a hotkey they bound themselves.
function foregroundIsGame() {
  if (process.platform !== 'win32') return null;
  const a = bind();
  if (!a) return false;
  try {
    const fg = a.GetForegroundWindow();
    if (!fg) return false;
    const pidOut = [0];
    a.GetWindowThreadProcessId(fg, pidOut);
    if (!pidOut[0]) return false;
    if (pidOut[0] === process.pid) return false; // our own overlay
    return /^pathofexile.*\.exe$/i.test(exeOf(a, pidOut[0]));
  } catch {
    return false;
  }
}

// Where the game window is on screen, in desktop pixels.
//
// Reprice needs it because the price dialog is centred on the GAME WINDOW, not on the
// display. Searching the middle of the SCREEN finds it only when the window happens to be
// centred, and widening the search to the whole screen to cover the rest is what let a
// patch of brown scenery be mistaken for the price field. Knowing the window means the
// search can be small AND correct at the same time.
function gameRect() {
  const a = bind();
  if (!a) return null;
  const g = findGame();
  if (!g || !g.hwnd) return null;
  try {
    const r = [0, 0, 0, 0];
    if (!a.GetWindowRect(g.hwnd, r)) return null;
    const [left, top, right, bottom] = r;
    const w = right - left, h = bottom - top;
    if (!(w > 200 && h > 200)) return null;   // minimised or nonsense
    return { x: left, y: top, w, h };
  } catch { return null; }
}

// Start Windows' OWN resize loop on a window, as if the user had grabbed its
// bottom-right corner. This is the classic Win32 custom-grip pattern:
// ReleaseCapture, then WM_NCLBUTTONDOWN with HTBOTTOMRIGHT, and the OS runs the
// whole drag natively - the same code path as the frameless window's other corners,
// which is exactly the resize that provably works. The renderer's own
// pointer-capture reimplementation of this was dead on Windows: the grip saw
// pointerdown and then never a single move.
//
// hwndBuf is Electron's win.getNativeWindowHandle() Buffer.
function beginNativeResize(hwndBuf) {
  if (process.platform !== 'win32') return false;
  const a = bind();
  if (!a || !hwndBuf || hwndBuf.length < 8) return false;
  try {
    const WM_NCLBUTTONDOWN = 0x00A1;
    const HTBOTTOMRIGHT = 17;
    const hwnd = hwndBuf.length >= 8 ? hwndBuf.readBigInt64LE(0) : BigInt(hwndBuf.readInt32LE(0));
    a.ReleaseCapture();
    a.PostMessageW(hwnd, WM_NCLBUTTONDOWN, HTBOTTOMRIGHT, 0);
    return true;
  } catch { return false; }
}

module.exports = { warm, focus, findGame, listWindows, foregroundIsGame, gameRect, beginNativeResize };
