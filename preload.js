const { contextBridge, ipcRenderer } = require('electron');

// Local global-input signals, consumed by the character renderer.
contextBridge.exposeInMainWorld('input', {
  onKeyDown: (cb) => ipcRenderer.on('global-keydown', (_, e) => cb(e)),
  onKeyUp: (cb) => ipcRenderer.on('global-keyup', (_, e) => cb(e)),
  onMouseDown: (cb) => ipcRenderer.on('global-mousedown', (_, e) => cb(e)),
  onMouseUp: (cb) => ipcRenderer.on('global-mouseup', (_, e) => cb(e)),
});

// Pairing/link API, consumed by the control panel (index.html / connect.js).
contextBridge.exposeInMainWorld('link', {
  pair: (code) => ipcRenderer.send('link:pair', code),
  requestState: () => ipcRenderer.send('link:request-state'),
  onCode: (cb) => ipcRenderer.on('link:code', (_, code) => cb(code)),
  onStatus: (cb) => ipcRenderer.on('link:status', (_, status, detail) => cb(status, detail)),
});

// The PEER's abstract input signals, consumed by the peer renderer (peer.js).
// These carry only an event type (+ optional integer mouse button) — never raw
// key values or coordinates.
contextBridge.exposeInMainWorld('peer', {
  onKeyDown: (cb) => ipcRenderer.on('peer-keydown', (_, button) => cb(button)),
  onKeyUp: (cb) => ipcRenderer.on('peer-keyup', (_, button) => cb(button)),
  onMouseDown: (cb) => ipcRenderer.on('peer-mousedown', (_, button) => cb(button)),
  onMouseUp: (cb) => ipcRenderer.on('peer-mouseup', (_, button) => cb(button)),
  onReset: (cb) => ipcRenderer.on('peer-reset', () => cb()),
});
