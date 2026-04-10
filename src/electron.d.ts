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
      onBeforeClose: (callback: () => void) => void
      closeApp: () => void
    }
  }
}
