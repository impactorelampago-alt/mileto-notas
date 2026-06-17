import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Store from 'electron-store'

const store = new Store({
  projectName: 'ops-notas',
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(__dirname, '../dist')

let mainWindow: BrowserWindow | null = null
let isForceClose = false
let closeFallbackTimer: ReturnType<typeof setTimeout> | null = null
// Estado do auto-update (notificação in-app + instalar com 1 clique)
let userRequestedInstall = false
let pendingInstall = false
let installing = false

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
      // Rede de segurança: se o renderer não confirmar em 7s (travado, sem
      // listener registrado, ou save pendurado), fecha mesmo assim.
      if (closeFallbackTimer) clearTimeout(closeFallbackTimer)
      closeFallbackTimer = setTimeout(() => {
        isForceClose = true
        mainWindow?.close()
      }, 7000)
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
  if (closeFallbackTimer) {
    clearTimeout(closeFallbackTimer)
    closeFallbackTimer = null
  }
  // Se o fechamento foi disparado pra instalar uma atualização, instala
  // (em vez de só fechar) — já com a sessão/notas salvas pelo renderer.
  if (pendingInstall) {
    doInstall()
    return
  }
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

// ── Auto-update: avisa o usuário DENTRO do app e instala com 1 clique ───────
// Não baixa sozinho: mostra a notificação in-app; ao clicar "Instalar
// atualização", baixa (com progresso) e instala/reinicia.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true // rede de segurança

function sendToRenderer(channel: string, payload?: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

function doInstall(): void {
  if (installing) return
  installing = true
  isForceClose = true // libera o guard de close (senão o quit fica preso)
  if (closeFallbackTimer) {
    clearTimeout(closeFallbackTimer)
    closeFallbackTimer = null
  }
  autoUpdater.quitAndInstall(true, true) // silencioso + reabre após instalar
}

autoUpdater.on('update-available', (info) => {
  sendToRenderer('update:available', { version: info?.version ?? '' })
})
autoUpdater.on('update-not-available', () => {
  sendToRenderer('update:not-available')
})
autoUpdater.on('download-progress', (p) => {
  sendToRenderer('update:progress', { percent: Math.round(p?.percent ?? 0) })
})
autoUpdater.on('update-downloaded', () => {
  sendToRenderer('update:downloaded')
  if (userRequestedInstall) {
    // Salva antes de instalar reutilizando o fluxo de fechar (App.tsx salva
    // sessão/notas e chama closeApp → cai em pendingInstall → doInstall()).
    pendingInstall = true
    mainWindow?.webContents.send('app:before-close')
    setTimeout(() => doInstall(), 7000) // fallback se o renderer não responder
  }
})
autoUpdater.on('error', (err) => {
  sendToRenderer('update:error', { message: err?.message ?? String(err) })
})

// Renderer clicou "Instalar atualização": baixa (dispara progresso) e, ao
// terminar (update-downloaded), instala.
ipcMain.on('update:install', () => {
  userRequestedInstall = true
  autoUpdater.downloadUpdate().catch((err) => {
    sendToRenderer('update:error', { message: err instanceof Error ? err.message : String(err) })
  })
})

// Verificação manual (botão na titlebar): emite update:available OU
// update:not-available; o renderer reflete o resultado.
ipcMain.on('update:check', () => {
  autoUpdater.checkForUpdates().catch((err) => {
    sendToRenderer('update:error', { message: err instanceof Error ? err.message : String(err) })
  })
})

// Versão instalada (pro tooltip / estado "atualizado" na UI).
ipcMain.handle('app:getVersion', () => app.getVersion())

// Verifica atualização no início (silencioso; só avisa se houver).
app.whenReady().then(() => {
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* em dev / sem release: ignora */
    })
  }, 3000)
})
