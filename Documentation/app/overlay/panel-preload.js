const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  state: () => ipcRenderer.invoke('panel-state'),
  cmd: (name, arg) => ipcRenderer.send('panel-cmd', name, arg),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
});
