import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias')
}

const electronStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (window.electronAPI?.sessionStorage) {
      return window.electronAPI.sessionStorage.get(key)
    }
    return localStorage.getItem(key)
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (window.electronAPI?.sessionStorage) {
      await window.electronAPI.sessionStorage.set(key, value)
      return
    }
    localStorage.setItem(key, value)
  },
  removeItem: async (key: string): Promise<void> => {
    if (window.electronAPI?.sessionStorage) {
      await window.electronAPI.sessionStorage.remove(key)
      return
    }
    localStorage.removeItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: electronStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lock: (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn() as Promise<any>,
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
