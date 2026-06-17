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
  onBeforeClose: (callback: () => void) => {
    // Garante listener único — evita acúmulo em hot-reload / re-registro
    ipcRenderer.removeAllListeners('app:before-close')
    ipcRenderer.on('app:before-close', () => callback())
  },
  closeApp: () => ipcRenderer.send('app:close-ready'),
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
  updates: {
    install: () => ipcRenderer.send('update:install'),
    check: () => ipcRenderer.send('update:check'),
    onAvailable: (callback: (info: { version: string }) => void) => {
      ipcRenderer.removeAllListeners('update:available')
      ipcRenderer.on('update:available', (_e, info) => callback(info))
    },
    onNotAvailable: (callback: () => void) => {
      ipcRenderer.removeAllListeners('update:not-available')
      ipcRenderer.on('update:not-available', () => callback())
    },
    onProgress: (callback: (info: { percent: number }) => void) => {
      ipcRenderer.removeAllListeners('update:progress')
      ipcRenderer.on('update:progress', (_e, info) => callback(info))
    },
    onDownloaded: (callback: () => void) => {
      ipcRenderer.removeAllListeners('update:downloaded')
      ipcRenderer.on('update:downloaded', () => callback())
    },
    onError: (callback: (info: { message: string }) => void) => {
      ipcRenderer.removeAllListeners('update:error')
      ipcRenderer.on('update:error', (_e, info) => callback(info))
    },
  },
})
