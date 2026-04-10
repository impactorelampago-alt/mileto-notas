import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    newWindow: () => ipcRenderer.send('window:new'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  sessionStorage: {
    get: (key: string) => ipcRenderer.invoke('session:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('session:set', key, value),
    remove: (key: string) => ipcRenderer.invoke('session:remove', key),
  },
  onBeforeClose: (callback: () => void) => ipcRenderer.on('app:before-close', callback),
  closeApp: () => ipcRenderer.send('app:close-ready'),
})
