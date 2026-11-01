const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  bounds: () => ipcRenderer.invoke('bounds'),
  setPos: (x, y) => ipcRenderer.send('pos', x, y),
  ignore: (on) => ipcRenderer.send('ignore', on),
  focus: () => ipcRenderer.send('focus'),
  drag: (on) => ipcRenderer.send('drag', on),
  report: (patch) => ipcRenderer.send('report', patch),
  scale: (s) => ipcRenderer.invoke('scale', s),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, ...a) => fn(...a)),
});
