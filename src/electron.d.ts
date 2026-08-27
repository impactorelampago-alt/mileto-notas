export {}

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
        newWindow: () => void
        isMaximized: () => Promise<boolean>
      }
      sessionStorage: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<void>
        remove: (key: string) => Promise<void>
      }
      files: {
        saveText: (input: { title: string; content: string }) => Promise<{
          saved: boolean
          cancelled: boolean
        }>
      }
      onBeforeClose: (callback: () => void) => void
      closeApp: () => void
      app: {
        getVersion: () => Promise<string>
        rendererReady: () => void
      }
      power: {
        onResume: (callback: () => void) => void
      }
      updates: {
        install: () => void
        check: () => void
        onAvailable: (callback: (info: { version: string }) => void) => void
        onNotAvailable: (callback: () => void) => void
        onProgress: (callback: (info: { percent: number }) => void) => void
        onDownloaded: (callback: () => void) => void
        onError: (callback: (info: { message: string }) => void) => void
      }
    }
  }
}
