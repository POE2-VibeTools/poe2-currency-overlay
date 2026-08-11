'use strict';
// Draw a box around the price number, on a STILL of the screen, with a magnifier - the
// same interaction the Net Worth calibration uses, because the target here is a handful
// of pixels and eyeballing it does not work.
//
// The rectangle goes back as SCREEN FRACTIONS so it survives a resolution change.
(function () {
  const shot = document.getElementById('shot');
  const boxEl = document.getElementById('box');
  const loupe = document.getElementById('loupe');
  const lcanvas = loupe.querySelector('canvas');
  const lctx = lcanvas.getContext('2d');
  const coordsEl = document.getElementById('coords');
  const dim = document.getElementById('dim');

  const Z = 9, D = 168;   // magnification (odd, so a source pixel maps to an odd block) and diameter
  const img = new Image();
  let imgReady = false;
  let sx = 0, sy = 0, drawing = false, cur = null;

  window.api.onRepriceCalibrateShot((dataUrl) => {
    if (!dataUrl) return;
    img.onload = () => { imgReady = true; shot.src = dataUrl; };
    img.src = dataUrl;
  });

  const rectOf = (x1, y1, x2, y2) => ({
    left: Math.min(x1, x2), top: Math.min(y1, y2),
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
  });

  // css px -> source px. The still is drawn to fill the window, so one scale per axis.
  const scaleX = () => (imgReady ? img.width / window.innerWidth : 1);
  const scaleY = () => (imgReady ? img.height / window.innerHeight : 1);

  function showLoupe(cssX, cssY) {
    if (!imgReady) return;
    const srcCx = cssX * scaleX(), srcCy = cssY * scaleY();
    const srcSize = D / Z;                       // source px shown across the loupe
    lctx.imageSmoothingEnabled = false;          // show real pixels, not a blur
    lctx.clearRect(0, 0, D, D);
    lctx.drawImage(img, srcCx - srcSize / 2, srcCy - srcSize / 2, srcSize, srcSize, 0, 0, D, D);
    // crosshair on the exact source pixel under the cursor, one source-pixel thick
    lctx.fillStyle = 'rgba(155,209,255,0.85)';
    lctx.fillRect(0, (D - Z) / 2, D, Z);
    lctx.fillRect((D - Z) / 2, 0, Z, D);
    lctx.fillStyle = 'rgba(0,0,0,0.55)';
    lctx.fillRect(0, (D - Z) / 2 + Z / 3, D, Z / 3);
    lctx.fillRect((D - Z) / 2 + Z / 3, 0, Z / 3, D);
    // keep the loupe away from the corner being placed, and on screen
    const off = 26;
    let lx = cssX + off, ly = cssY + off;
    if (lx + D > window.innerWidth) lx = cssX - off - D;
    if (ly + D > window.innerHeight) ly = cssY - off - D;
    loupe.style.left = Math.max(0, lx) + 'px';
    loupe.style.top = Math.max(0, ly) + 'px';
    loupe.style.display = 'block';
  }

  function paint(r) {
    boxEl.style.display = 'block';
    boxEl.style.left = r.left + 'px'; boxEl.style.top = r.top + 'px';
    boxEl.style.width = r.width + 'px'; boxEl.style.height = r.height + 'px';
    dim.style.display = 'none';   // the box's own shadow does the dimming while drawing
    const w = Math.round(r.width * scaleX()), h = Math.round(r.height * scaleY());
    coordsEl.textContent = w + ' x ' + h + ' px';
    coordsEl.style.display = 'block';
    coordsEl.style.left = Math.min(window.innerWidth - 80, r.left) + 'px';
    coordsEl.style.top = Math.max(0, r.top - 22) + 'px';
  }

  window.addEventListener('mousemove', (e) => {
    showLoupe(e.clientX, e.clientY);
    if (drawing) { cur = rectOf(sx, sy, e.clientX, e.clientY); paint(cur); }
  });

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    drawing = true; sx = e.clientX; sy = e.clientY;
    cur = rectOf(sx, sy, sx, sy);
    paint(cur);
  });

  window.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false;
    const r = rectOf(sx, sy, e.clientX, e.clientY);
    if (r.width < 6 || r.height < 6) {   // a stray click is not a calibration
      boxEl.style.display = 'none'; coordsEl.style.display = 'none'; dim.style.display = 'block';
      return;
    }
    const W = window.innerWidth, H = window.innerHeight;
    window.api.repriceCalibrateDone({
      x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H,
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.api.repriceCalibrateDone(null);
  });
})();
