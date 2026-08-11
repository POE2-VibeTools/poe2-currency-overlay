'use strict';
// Bridge for the calibration sheet. One way out: the rectangle, or null for cancel.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  repriceCalibrateDone: (rect) => ipcRenderer.send('reprice-calibrate-done', rect),
});
