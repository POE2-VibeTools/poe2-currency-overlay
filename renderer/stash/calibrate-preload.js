const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calibrateApi', {
  onInit: (cb) => ipcRenderer.on('calib-init', (_e, data) => cb(data)),
  confirm: (frame) => ipcRenderer.send('stash-calibrate-confirm', frame),
  cancel: () => ipcRenderer.send('stash-calibrate-cancel'),
  snap: (frame) => ipcRenderer.send('stash-calibrate-snap', frame),
  onSnapped: (cb) => ipcRenderer.on('calib-snapped', (_e, frame) => cb(frame)),
});
