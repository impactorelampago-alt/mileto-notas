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
})
