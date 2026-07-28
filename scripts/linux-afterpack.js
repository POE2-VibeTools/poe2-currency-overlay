'use strict';
// LINUX ONLY. Puts --ozone-platform=x11 on the app's real command line.
//
// Why this exists: the overlay must run on the X11/XWayland Ozone backend. Native
// Wayland can't keep an always-on-top overlay over a fullscreen game, uiohook's input
// hook is X11-based, and Electron 43's globalShortcut cannot register under Wayland at
// all (Chromium's portal handshake bug, fixed upstream after this Electron). Neither of
// the two obvious ways to force it actually works:
//
//   - app.commandLine.appendSwitch('ozone-platform','x11') in main.js applies to the
//     BROWSER process only. The GPU process spawns from the zygote without it
//     (electron#50455), initializes against the real Wayland session, and segfaults -
//     field logs showed exit_code=139 plus every globalShortcut.register() returning
//     false with a bogus "hotkey taken by another app".
//   - build.linux.executableArgs in electron-builder 26.15.3 only writes the bundled
//     .desktop file's Exec= line. It never reaches AppRun, so it does nothing for a
//     double-click, a `./App.AppImage`, or a Steam shortcut. (electron-builder PR #9922
//     fixes this by baking args into AppRun itself, but it isn't in a published release
//     yet - once it is, this hook can go and executableArgs alone will do.)
//
// AppRun, in every version, ends with `exec "$BIN" ...` where $BIN is the file named
// after executableName. So swapping that file for a shell wrapper that re-execs the
// real binary with the flag covers every launch path and doesn't depend on
// electron-builder internals.
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return; // Windows build: untouched
  const exe = context.packager.executableName;
  const real = path.join(context.appOutDir, exe);
  const renamed = `${real}.bin`;
  if (!fs.existsSync(real) || fs.existsSync(renamed)) return; // already wrapped
  fs.renameSync(real, renamed);
  fs.writeFileSync(
    real,
    '#!/bin/sh\n'
    + '# Wrapper injected by scripts/linux-afterpack.js - see that file for why.\n'
    + '# NOTE: a previous build also unset WAYLAND_DISPLAY and forced XDG_SESSION_TYPE=x11\n'
    + '# to push Chromium onto its legacy X11 screen capturer. It worked - and the capture\n'
    + '# came back BLACK, because an X11 grab on a Wayland session cannot see composited\n'
    + '# content. Reverted: screen capture has to go through the desktop portal, and\n'
    + '# lying about the session type would only break that too.\n'
    + `exec "$(dirname "$(readlink -f "$0")")/${exe}.bin" --ozone-platform=x11 "$@"\n`,
    { mode: 0o755 }
  );
  console.log(`  • linux afterPack   wrapped "${exe}" with --ozone-platform=x11`);
};
