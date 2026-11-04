const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('store', {
  load: () => ipcRenderer.invoke('data:load'),
  save: data => ipcRenderer.invoke('data:save', data),
  setTheme: mode => ipcRenderer.invoke('theme:set', mode),
  setOpenAtLogin: on => ipcRenderer.invoke('login:set', on),
  onFocusAdd: fn => ipcRenderer.on('focus-add', fn),
  fetchCalendar: (start, end) => ipcRenderer.invoke('calendar:fetch', start, end),
  onCalendarChanged: fn => ipcRenderer.on('calendar-changed', fn),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  onSyncStatus: fn => ipcRenderer.on('sync-status', (_e, access) => fn(access)),
  onRemoteTasks: fn => ipcRenderer.on('tasks-remote', (_e, changes) => fn(changes))
});
