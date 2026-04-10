import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useCollaboratorsStore } from './collaborators-store'
import type { Profile } from '../lib/types'

interface AuthState {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  isAuthenticated: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  loadProfile: (userId: string) => Promise<void>
}

function translateAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'Email ou senha incorretos.'
  if (message.includes('Email not confirmed')) return 'Email não confirmado. Verifique sua caixa de entrada.'
  if (message.includes('Too many requests')) return 'Muitas tentativas. Aguarde um momento e tente novamente.'
  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('Failed to fetch')
  )
    return 'Erro de conexão. Verifique sua internet.'
  return 'Erro ao entrar. Tente novamente.'
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  profile: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.user) {
        set({ user: session.user, isAuthenticated: true })
        await get().loadProfile(session.user.id)
      }
    } catch {
      // Sessão inválida ou erro de rede — usuário não autenticado
    } finally {
      set({ isLoading: false })
    }

    // Escutar mudanças de sessão (token expirado, logout em outra aba, etc)
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        set({ user: null, profile: null, isAuthenticated: false })
      } else if (session.user) {
        set({ user: session.user, isAuthenticated: true })
        await get().loadProfile(session.user.id)
      }
    })
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return { error: translateAuthError(error.message) }
    }

    if (data.user) {
      set({ user: data.user, isAuthenticated: true })
      await get().loadProfile(data.user.id)
    }

    return { error: null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null, isAuthenticated: false })
    useCollaboratorsStore.getState().resetStore()
  },

  loadProfile: async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()

    if (data) {
      set({ profile: data as Profile })
    }
  },
}))
