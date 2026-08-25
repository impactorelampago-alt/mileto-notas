import { app, BrowserWindow, shell, ipcMain, powerMonitor, dialog } from 'electron'
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
let availableUpdateVersion = ''
let rendererNeedsRecovery = false
let recoveryDialogOpen = false
let recoveryDownloadRequested = false
const rendererReadyWindowIds = new Set<number>()
const rendererWatchdogs = new Map<number, ReturnType<typeof setTimeout>>()
const RENDERER_READY_TIMEOUT_MS = 10_000

function clearRendererWatchdog(webContentsId: number): void {
  const timer = rendererWatchdogs.get(webContentsId)
  if (timer) clearTimeout(timer)
  rendererWatchdogs.delete(webContentsId)
}

function markRendererReady(webContentsId: number): void {
  rendererReadyWindowIds.add(webContentsId)
  clearRendererWatchdog(webContentsId)

  if (mainWindow?.webContents.id === webContentsId) {
    rendererNeedsRecovery = false
  }
}

function markRendererForRecovery(window: BrowserWindow): void {
  if (window.isDestroyed() || mainWindow !== window) return
  rendererNeedsRecovery = true
  void offerNativeRecoveryUpdate()
}

function armRendererWatchdog(window: BrowserWindow): void {
  const webContentsId = window.webContents.id
  clearRendererWatchdog(webContentsId)
  rendererWatchdogs.set(webContentsId, setTimeout(() => {
    rendererWatchdogs.delete(webContentsId)
    if (!rendererReadyWindowIds.has(webContentsId)) {
      markRendererForRecovery(window)
    }
  }, RENDERER_READY_TIMEOUT_MS))
}

async function showNativeMessage(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return dialog.showMessageBox(mainWindow, options)
  }
  return dialog.showMessageBox(options)
}

async function offerNativeRecoveryUpdate(): Promise<void> {
  if (
    !rendererNeedsRecovery ||
    !availableUpdateVersion ||
    recoveryDialogOpen ||
    recoveryDownloadRequested ||
    installing
  ) return

  recoveryDialogOpen = true
  try {
    const { response } = await showNativeMessage({
      type: 'warning',
      title: 'Recuperar o Mileto Notas',
      message: 'O Mileto Notas não conseguiu abrir a interface.',
      detail: `A versão ${availableUpdateVersion} está disponível. Atualize agora para corrigir a inicialização sem baixar o instalador manualmente.`,
      buttons: ['Atualizar agora', 'Tentar abrir novamente', 'Agora não'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })

    if (response === 0) {
      recoveryDownloadRequested = true
      userRequestedInstall = true
      mainWindow?.setProgressBar(0)
      autoUpdater.downloadUpdate().catch((error) => {
        recoveryDownloadRequested = false
        mainWindow?.setProgressBar(-1)
        void showNativeMessage({
          type: 'error',
          title: 'Falha ao atualizar o Mileto Notas',
          message: 'Não foi possível baixar a atualização.',
          detail: error instanceof Error ? error.message : String(error),
          buttons: ['OK'],
          noLink: true,
        })
      })
      return
    }

    if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
      rendererNeedsRecovery = false
      rendererReadyWindowIds.delete(mainWindow.webContents.id)
      armRendererWatchdog(mainWindow)
      mainWindow.reload()
    }
  } finally {
    recoveryDialogOpen = false
  }
}

function createWindow(): void {
  const createdWindow = new BrowserWindow({
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
      // Não congela timers/WebSocket quando a janela está minimizada/em background —
      // sem isso o Chromium throttla o heartbeat do realtime e o tempo real "esfria".
      backgroundThrottling: false,
    },
  })
  const webContentsId = createdWindow.webContents.id
  mainWindow = createdWindow
  armRendererWatchdog(createdWindow)

  createdWindow.once('ready-to-show', () => {
    createdWindow.show()
  })

  createdWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  createdWindow.webContents.on('did-fail-load', () => {
    markRendererForRecovery(createdWindow)
  })

  createdWindow.webContents.on('render-process-gone', () => {
    markRendererForRecovery(createdWindow)
  })

  createdWindow.on('unresponsive', () => {
    markRendererForRecovery(createdWindow)
  })

  createdWindow.on('closed', () => {
    clearRendererWatchdog(webContentsId)
    rendererReadyWindowIds.delete(webContentsId)
  })

  createdWindow.on('close', (event) => {
    if (!isForceClose) {
      event.preventDefault()
      createdWindow.webContents.send('app:before-close')
      // Rede de segurança: se o renderer não confirmar em 7s (travado, sem
      // listener registrado, ou save pendurado), fecha mesmo assim.
      if (closeFallbackTimer) clearTimeout(closeFallbackTimer)
      closeFallbackTimer = setTimeout(() => {
        isForceClose = true
        createdWindow.close()
      }, 7000)
    }
  })

  if (VITE_DEV_SERVER_URL) {
    createdWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    createdWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
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

// ── Reconexão do tempo real ao ACORDAR do sleep / destravar a tela ──────────
// Durante o sleep o WebSocket morre (o SO suspende tudo); ao voltar, o socket
// costuma ficar "zumbi" sem disparar CLOSED. Avisamos o renderer pra forçar a
// reconexão total (ops + nota + co-edição + presença). Debounce anti-double-fire:
// o 'resume' pode disparar 2x (ex.: macOS) e 'unlock-screen' logo em seguida.
let lastPowerSignal = 0
function signalPowerResume(): void {
  const now = Date.now()
  if (now - lastPowerSignal < 3000) return
  lastPowerSignal = now
  sendToRenderer('power:resume')
}
app.whenReady().then(() => {
  powerMonitor.on('resume', signalPowerResume)
  powerMonitor.on('unlock-screen', signalPowerResume)
})

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
  availableUpdateVersion = info?.version ?? ''
  sendToRenderer('update:available', { version: availableUpdateVersion })
  void offerNativeRecoveryUpdate()
})
autoUpdater.on('update-not-available', () => {
  availableUpdateVersion = ''
  sendToRenderer('update:not-available')
})
autoUpdater.on('download-progress', (p) => {
  if (recoveryDownloadRequested) {
    mainWindow?.setProgressBar(Math.max(0, Math.min(1, (p?.percent ?? 0) / 100)))
  }
  sendToRenderer('update:progress', { percent: Math.round(p?.percent ?? 0) })
})
autoUpdater.on('update-downloaded', () => {
  if (recoveryDownloadRequested) {
    mainWindow?.setProgressBar(-1)
    doInstall()
    return
  }
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
ipcMain.on('app:renderer-ready', (event) => markRendererReady(event.sender.id))

// Verifica atualização no início (silencioso; só avisa se houver).
app.whenReady().then(() => {
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* em dev / sem release: ignora */
    })
  }, 3000)
})
