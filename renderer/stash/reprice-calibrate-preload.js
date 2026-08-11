'use strict';
// Bridge for the calibration sheet: the still comes in, the rectangle goes out.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onRepriceCalibrateShot: (fn) => ipcRenderer.on('reprice-calibrate-shot', (_e, dataUrl) => fn(dataUrl)),
  repriceCalibrateDone: (rect) => ipcRenderer.send('reprice-calibrate-done', rect),
});
