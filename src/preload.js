const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('store', {
  load: () => ipcRenderer.invoke('data:load'),
  save: data => ipcRenderer.invoke('data:save', data),
  setTheme: mode => ipcRenderer.invoke('theme:set', mode),
  setOpenAtLogin: on => ipcRenderer.invoke('login:set', on),
  onFocusAdd: fn => ipcRenderer.on('focus-add', fn)
});
