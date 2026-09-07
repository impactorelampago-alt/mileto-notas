const configuredSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const configuredSupabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

const LEGACY_SUPABASE_URL = 'https://supabase.miletoops.com'
const CONTINGENCY_SUPABASE_URL = 'https://miletoops.com/_supabase'

if (!configuredSupabaseUrl || !configuredSupabaseAnonKey) {
  throw new Error('Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias')
}

const normalizedUrl = configuredSupabaseUrl.replace(/\/+$/, '')

/**
 * O ingress direto está atrás de um Cloudflare com erro 523. Enquanto isso,
 * todo o renderer usa a contingência do próprio Ops, que encaminha Auth, REST,
 * Storage e Realtime ao mesmo Supabase sem alterar JWT, MFA ou RLS.
 */
export const SUPABASE_URL = normalizedUrl === LEGACY_SUPABASE_URL
  ? CONTINGENCY_SUPABASE_URL
  : normalizedUrl

export const SUPABASE_ANON_KEY = configuredSupabaseAnonKey

// A chave padrão era derivada do host antigo. Fixá-la preserva a sessão já salva
// quando o endpoint muda para miletoops.com/_supabase.
export const SUPABASE_AUTH_STORAGE_KEY = 'sb-supabase-auth-token'
