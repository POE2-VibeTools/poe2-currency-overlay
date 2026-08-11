'use strict';
// Drag a box around the price number. Sends the rectangle back as SCREEN FRACTIONS, not
// pixels, so a calibration survives a resolution change the same way the Net Worth
// reader's does.
(function () {
  const box = document.getElementById('box');
  const size = document.getElementById('size');
  const hint = document.getElementById('hint');

  let sx = 0, sy = 0, drawing = false;

  const rectOf = (x1, y1, x2, y2) => ({
    left: Math.min(x1, x2), top: Math.min(y1, y2),
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
  });

  function paint(r) {
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    size.style.display = 'block';
    size.textContent = Math.round(r.width) + ' x ' + Math.round(r.height);
    // keep the readout on screen when the box is dragged to an edge
    size.style.left = Math.min(window.innerWidth - 70, r.left) + 'px';
    size.style.top = Math.max(0, r.top - 22) + 'px';
  }

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    drawing = true; sx = e.clientX; sy = e.clientY;
    paint(rectOf(sx, sy, sx, sy));
  });

  window.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    paint(rectOf(sx, sy, e.clientX, e.clientY));
  });

  window.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false;
    const r = rectOf(sx, sy, e.clientX, e.clientY);
    // a stray click is not a calibration
    if (r.width < 8 || r.height < 8) {
      box.style.display = 'none'; size.style.display = 'none';
      hint.querySelector('#hint-text').textContent = document.title && '' || hint.querySelector('#hint-text').textContent;
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
