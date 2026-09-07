import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const configSource = read('../src/lib/supabase-config.ts')
const clientSource = read('../src/lib/supabase.ts')
const viteSource = read('../vite.config.ts')
const indexSource = read('../index.html')
const directRestSources = [
  read('../src/stores/notes-store.ts'),
  read('../src/stores/ops-store.ts'),
  read('../src/components/ui/AddAnnotationToCompanyModal.tsx'),
]

test('the failed legacy ingress is redirected to the healthy Ops contingency', () => {
  assert.ok(configSource.includes("LEGACY_SUPABASE_URL = 'https://supabase.miletoops.com'"))
  assert.ok(configSource.includes("CONTINGENCY_SUPABASE_URL = 'https://miletoops.com/_supabase'"))
  assert.ok(configSource.includes('normalizedUrl === LEGACY_SUPABASE_URL'))
  assert.ok(clientSource.includes('createClient(SUPABASE_URL, SUPABASE_ANON_KEY'))
})

test('the endpoint switch keeps the previous durable auth storage key', () => {
  assert.ok(configSource.includes("SUPABASE_AUTH_STORAGE_KEY = 'sb-supabase-auth-token'"))
  assert.ok(clientSource.includes('storageKey: SUPABASE_AUTH_STORAGE_KEY'))
})

test('manual REST calls share the same resolved endpoint and key', () => {
  for (const source of directRestSources) {
    assert.ok(source.includes("from '../lib/supabase-config'") || source.includes("from '../../lib/supabase-config'"))
    assert.equal(source.includes('import.meta.env.VITE_SUPABASE_URL'), false)
    assert.equal(source.includes('import.meta.env.VITE_SUPABASE_ANON_KEY'), false)
  }
})

test('the production config accepts the exact contingency path', () => {
  assert.ok(viteSource.includes("normalizedSupabaseUrl === 'https://miletoops.com/_supabase'"))
})

test('Electron CSP permits HTTPS and WebSocket traffic to the contingency origin', () => {
  assert.match(indexSource, /connect-src[^;]*https:\/\/miletoops\.com(?:\s|;)/)
  assert.match(indexSource, /connect-src[^;]*wss:\/\/miletoops\.com(?:\s|;)/)
})
