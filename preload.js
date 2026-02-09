const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('input', {
  onKeyDown: (cb) => ipcRenderer.on('global-keydown', (_, e) => cb(e)),
  onKeyUp: (cb) => ipcRenderer.on('global-keyup', (_, e) => cb(e)),
  onMouseDown: (cb) => ipcRenderer.on('global-mousedown', (_, e) => cb(e)),
  onMouseUp: (cb) => ipcRenderer.on('global-mouseup', (_, e) => cb(e)),
});
