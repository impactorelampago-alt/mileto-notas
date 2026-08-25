import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('renderer confirms a healthy bootstrap through preload', () => {
  assert.match(preloadSource, /rendererReady: \(\) => ipcRenderer\.send\('app:renderer-ready'\)/)
  assert.match(appSource, /window\.electronAPI\.app\.rendererReady\(\)/)
  assert.match(mainSource, /ipcMain\.on\('app:renderer-ready'/)
})

test('main process offers an updater when React does not start', () => {
  assert.match(mainSource, /RENDERER_READY_TIMEOUT_MS/)
  assert.match(mainSource, /markRendererForRecovery/)
  assert.match(mainSource, /did-fail-load/)
  assert.match(mainSource, /render-process-gone/)
  assert.match(mainSource, /Atualizar agora/)
  assert.match(mainSource, /autoUpdater\.downloadUpdate\(\)/)
})

test('native recovery installs immediately after its download', () => {
  assert.match(mainSource, /if \(recoveryDownloadRequested\) \{[\s\S]*?doInstall\(\)[\s\S]*?return/)
  assert.match(mainSource, /setProgressBar/)
})
