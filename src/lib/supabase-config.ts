import { resolveSupabaseUrl } from './supabase-endpoint'

const configuredSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const configuredSupabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

if (!configuredSupabaseUrl || !configuredSupabaseAnonKey) {
  throw new Error('Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias')
}

/**
 * Auth, REST, Storage e Realtime acompanham o domínio canônico do Ops.
 * Os dois endpoints legados usam o mesmo banco, JWT, MFA e RLS.
 */
export const SUPABASE_URL = resolveSupabaseUrl(configuredSupabaseUrl)

export const SUPABASE_ANON_KEY = configuredSupabaseAnonKey

// A chave padrão era derivada do host antigo. Fixá-la preserva a sessão já salva
// durante a migração para apoloops.com/_supabase.
export const SUPABASE_AUTH_STORAGE_KEY = 'sb-supabase-auth-token'
