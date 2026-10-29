import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_SUPABASE_URL, resolveSupabaseUrl } from '../src/lib/supabase-endpoint.ts'

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

test('both legacy endpoints resolve to the canonical Ops proxy', () => {
  assert.equal(CANONICAL_SUPABASE_URL, 'https://apoloops.com/_supabase')
  for (const legacy of ['https://supabase.miletoops.com', 'https://miletoops.com/_supabase']) {
    assert.equal(resolveSupabaseUrl(legacy), CANONICAL_SUPABASE_URL)
    assert.equal(resolveSupabaseUrl(`  ${legacy}///  `), CANONICAL_SUPABASE_URL)
  }
  assert.ok(configSource.includes('resolveSupabaseUrl(configuredSupabaseUrl)'))
  assert.ok(clientSource.includes('createClient(SUPABASE_URL, SUPABASE_ANON_KEY'))
})

test('canonical and custom endpoints keep their configured destination', () => {
  for (const endpoint of [CANONICAL_SUPABASE_URL, 'https://project.supabase.co', 'https://custom.example']) {
    assert.equal(resolveSupabaseUrl(`  ${endpoint}/  `), endpoint)
  }
  assert.equal(resolveSupabaseUrl('https://miletoops.com/_supabase-other'), 'https://miletoops.com/_supabase-other')
  assert.equal(resolveSupabaseUrl('https://miletoops.com.evil.example/_supabase'), 'https://miletoops.com.evil.example/_supabase')
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

test('the production config validates the same endpoint as the renderer', () => {
  assert.ok(viteSource.includes('resolveSupabaseUrl(supabaseUrl)'))
  assert.ok(viteSource.includes('normalizedSupabaseUrl === CANONICAL_SUPABASE_URL'))
})

test('Electron CSP permits HTTPS and WebSocket traffic to the resolved origin', () => {
  const connectSources = indexSource.match(/connect-src ([^;]+)/)?.[1].split(/\s+/) ?? []
  const origin = new URL(CANONICAL_SUPABASE_URL).origin
  assert.ok(connectSources.includes(origin))
  assert.ok(connectSources.includes(origin.replace('https:', 'wss:')))
  assert.equal(connectSources.includes('*'), false)
  assert.equal(connectSources.includes('https:'), false)
})
