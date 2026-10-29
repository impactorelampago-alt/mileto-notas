export const CANONICAL_SUPABASE_URL = 'https://apoloops.com/_supabase'

const LEGACY_SUPABASE_URLS = new Set([
  'https://supabase.miletoops.com',
  'https://miletoops.com/_supabase',
])

/** Mantém instalações com a configuração antiga no mesmo Supabase do Ops. */
export function resolveSupabaseUrl(configuredUrl: string): string {
  const normalizedUrl = configuredUrl.trim().replace(/\/+$/, '')
  return LEGACY_SUPABASE_URLS.has(normalizedUrl)
    ? CANONICAL_SUPABASE_URL
    : normalizedUrl
}
