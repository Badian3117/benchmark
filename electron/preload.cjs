const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('benchmark', {
  version: ipcRenderer.sendSync('app:version'),
  loadDb: () => ipcRenderer.invoke('db:load'),
  saveDb: (bytes) => ipcRenderer.invoke('db:save', bytes),
  openFile: (filters) => ipcRenderer.invoke('file:open', filters),
  saveFile: (name, bytes, filters) => ipcRenderer.invoke('file:save', name, bytes, filters),
  dataLocation: () => ipcRenderer.invoke('db:location'),
  showDataFolder: () => ipcRenderer.invoke('db:showFolder'),
});
