import { createClient } from '@supabase/supabase-js'
import {
  SUPABASE_ANON_KEY,
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_URL,
} from './supabase-config'

// O electron-store é a fonte durável principal. O localStorage funciona como
// espelho de recuperação quando o IPC fica indisponível durante uma atualização
// ou reinicialização do renderer.
const readLocalSession = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeLocalSession = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // O electron-store continua sendo a fonte durável principal.
  }
}

const removeLocalSession = (key: string): void => {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // O logout também remove a cópia principal via IPC.
  }
}

const electronStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (window.electronAPI?.sessionStorage) {
        const persisted = await window.electronAPI.sessionStorage.get(key)
        if (persisted !== null) {
          writeLocalSession(key, persisted)
          return persisted
        }
      }
    } catch {
      console.warn('[auth-storage] Armazenamento principal indisponível; usando recuperação local.')
    }

    const recovered = readLocalSession(key)
    if (recovered !== null && window.electronAPI?.sessionStorage) {
      void window.electronAPI.sessionStorage.set(key, recovered).catch(() => undefined)
    }
    return recovered
  },
  setItem: async (key: string, value: string): Promise<void> => {
    writeLocalSession(key, value)
    try {
      if (window.electronAPI?.sessionStorage) {
        await window.electronAPI.sessionStorage.set(key, value)
      }
    } catch {
      // A sessão permanece recuperável pelo espelho local.
      console.warn('[auth-storage] Sessão salva somente na recuperação local.')
    }
  },
  removeItem: async (key: string): Promise<void> => {
    removeLocalSession(key)
    try {
      if (window.electronAPI?.sessionStorage) {
        await window.electronAPI.sessionStorage.remove(key)
      }
    } catch {
      console.warn('[auth-storage] Não foi possível remover a sessão principal.')
    }
  },
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: electronStorage,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // Sem override de lock: o Supabase usa navigator.locks no Electron 30.
    // Assim login e refresh são serializados entre todas as janelas do app.
  },
  realtime: {
    // Heartbeat num Web Worker → IMUNE ao throttle de timer do renderer quando a janela
    // está minimizada / em background. É o que detecta o "WebSocket morre calado" (sem
    // disparar CLOSED) após sleep/queda de rede e força a reconexão — a raiz do tempo
    // real que sumia. O worker é um Blob INLINE do próprio supabase-js (sem `workerUrl`
    // → SEM dependência de rede externa); exige `worker-src 'self' blob:` no CSP.
    worker: true,
    // Ping a cada ~25s (≈75% do timeout comum de 30s de proxies): "limpa" o caminho e
    // detecta socket zumbi antes do proxy cortar a conexão.
    heartbeatIntervalMs: 25_000,
    // Margem no join/push numa VPS carregada / rede lenta (o default de 10s dava
    // TIMED_OUT espúrio → churn de canal).
    timeout: 20_000,
    // Reconexão com backoff + JITTER (anti-thundering-herd: N clientes não reconectam
    // no mesmo instante e não somam pico na VPS).
    reconnectAfterMs: (tries: number) => {
      const base = [1_000, 2_000, 5_000, 10_000][tries - 1] ?? 10_000
      return base + Math.floor(Math.random() * 1_000)
    },
    // Sinal de diagnóstico: loga quando o heartbeat detecta problema (o que faltava pra
    // enxergar a queda silenciosa em campo). 'sent'/'ok' são silenciosos.
    heartbeatCallback: (status) => {
      if (status === 'timeout' || status === 'error' || status === 'disconnected') {
        console.warn('[realtime] heartbeat:', status)
      }
    },
  },
})
