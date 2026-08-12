'use strict';
// State is pushed from main. The one thing the badge sends back is how wide its own
// content is, because only it can measure that and only main can resize the window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onRepriceState: (fn) => ipcRenderer.on('reprice-state', (_e, s) => fn(s)),
  reportWidth: (px) => ipcRenderer.send('reprice-badge-width', px),
});
