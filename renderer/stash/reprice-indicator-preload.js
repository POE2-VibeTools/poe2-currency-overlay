'use strict';
// One way in: state pushed from main. The badge never talks back.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onRepriceState: (fn) => ipcRenderer.on('reprice-state', (_e, s) => fn(s)),
});
