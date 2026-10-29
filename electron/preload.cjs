const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('benchmark', {
  version: ipcRenderer.sendSync('app:version'),
  loadDb: (name) => ipcRenderer.invoke('db:load', name),
  saveDb: (name, bytes) => ipcRenderer.invoke('db:save', name, bytes),
  openFile: (filters) => ipcRenderer.invoke('file:open', filters),
  saveFile: (name, bytes, filters) => ipcRenderer.invoke('file:save', name, bytes, filters),
  dataLocation: () => ipcRenderer.invoke('db:location'),
  showDataFolder: () => ipcRenderer.invoke('db:showFolder'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  printToPdf: (name) => ipcRenderer.invoke('app:printToPdf', name),
  notify: (title, body, payload) => ipcRenderer.invoke('app:notify', title, body, payload),
  onNotifyClick: (fn) => ipcRenderer.on('notify:click', (_e, payload) => fn(payload)),
  onAuthCallback: (fn) => {
    ipcRenderer.on('auth:callback', (_e, url) => fn(url));
    ipcRenderer.send('auth:ready');
  },
});
