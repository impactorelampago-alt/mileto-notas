import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Store from 'electron-store'

const store = new Store()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(__dirname, '../dist')

let mainWindow: BrowserWindow | null = null
let isForceClose = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', (event) => {
    if (!isForceClose) {
      event.preventDefault()
      mainWindow?.webContents.send('app:before-close')
    }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Window controls via IPC
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.on('app:close-ready', () => {
  isForceClose = true
  mainWindow?.close()
})
ipcMain.on('window:new', () => {
  createWindow()
})

ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

// Session persistence via electron-store
ipcMain.handle('session:get', (_event, key: string) => {
  return store.get(key) ?? null
})
ipcMain.handle('session:set', (_event, key: string, value: string) => {
  store.set(key, value)
})
ipcMain.handle('session:remove', (_event, key: string) => {
  store.delete(key)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)

autoUpdater.checkForUpdatesAndNotify()
autoUpdater.on('update-available', () => {
  mainWindow?.webContents.send('update:available')
})
autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents.send('update:downloaded')
})
