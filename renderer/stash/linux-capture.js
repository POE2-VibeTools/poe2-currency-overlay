'use strict';
// Screen frames for the Net Worth reader on platforms where the main process can't
// get one. Windows never loads this path (grabScreen in main.js uses desktopCapturer
// there and this file returns immediately).
//
// Why it exists: on a GNOME Wayland session Chromium always builds the PipeWire
// portal capturer - the choice comes from XDG_SESSION_TYPE/WAYLAND_DISPLAY, not from
// the Ozone backend - and desktopCapturer then waits forever on a consent dialog
// nobody can reach behind a fullscreen game. Forcing the legacy X11 capturer instead
// returns a black frame, because an X11 grab on a Wayland session can't see
// composited content. Both were confirmed in the field.
//
// getDisplayMedia goes through the portal properly: the user picks a screen ONCE per
// app run, and the resulting MediaStream stays live, so later captures just take the
// current frame off it with no further prompts.
(function () {
  if (!window.api || !window.api.onStashNeedFrame) return;
  if (window.api.platform === 'win32') return;

  let stream = null;
  let video = null;

  async function ensureStream() {
    if (stream && stream.active && video && video.videoWidth > 0) return;
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 2 }, // a stash panel doesn't move; 2fps keeps it cheap
      audio: false,
    });
    video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // the first frame isn't necessarily decoded when play() resolves
    for (let i = 0; i < 40 && !(video.videoWidth > 0); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // a stream the user stopped from the system indicator must not be reused
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => { stream = null; video = null; }));
  }

  window.api.onStashNeedFrame(async (opts) => {
    try {
      await ensureStream();
      if (!video || !(video.videoWidth > 0)) throw new Error('no video frame');
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      // canvas is RGBA; nativeImage.toBitmap() (what the reader worker expects on
      // Windows) is BGRA. Swap in place so the worker sees one format everywhere.
      const b = img.data;
      for (let i = 0; i < b.length; i += 4) { const t = b[i]; b[i] = b[i + 2]; b[i + 2] = t; }
      window.api.sendStashFrame({
        data: b.buffer,
        w: c.width,
        h: c.height,
        dataUrl: opts && opts.withDataUrl ? c.toDataURL('image/png') : null,
      });
    } catch (err) {
      // denied, dismissed, or no frame: main falls back to its "capture unavailable"
      // path rather than hanging
      window.api.sendStashFrame(null);
    }
  });
})();
