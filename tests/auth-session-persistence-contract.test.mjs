import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const supabaseSource = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
const authSource = readFileSync(new URL('../src/stores/auth-store.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('session persists in Electron with a local recovery mirror', () => {
  assert.ok(supabaseSource.includes('persistSession: true'))
  assert.ok(supabaseSource.includes('autoRefreshToken: true'))
  assert.ok(supabaseSource.includes('electronAPI.sessionStorage.get(key)'))
  assert.ok(supabaseSource.includes('window.localStorage.getItem(key)'))
  assert.ok(supabaseSource.includes('electronAPI.sessionStorage.set(key, recovered)'))
  assert.ok(supabaseSource.includes('removeLocalSession(key)'))
})

test('Supabase owns the cross-window auth lock', () => {
  const authOptionsStart = supabaseSource.indexOf('auth: {')
  const realtimeOptionsStart = supabaseSource.indexOf('realtime:', authOptionsStart)
  const authOptions = supabaseSource.slice(authOptionsStart, realtimeOptionsStart)

  assert.ok(authOptions.includes('navigator.locks'))
  assert.equal(
    authOptions.split('\n').some((line) => line.trimStart().startsWith('lock:')),
    false,
  )
})

test('temporary auth failures retry without bypassing the MFA gate', () => {
  assert.ok(authSource.includes('TRANSIENT_AUTH_RETRY_DELAYS_MS'))
  assert.ok(authSource.includes('retryTransientAuthResult'))
  assert.ok(authSource.includes('supabase.auth.mfa.getAuthenticatorAssuranceLevel()'))
  assert.ok(authSource.includes('supabase.auth.mfa.listFactors()'))
  assert.ok(authSource.includes("assurance.currentLevel === 'aal2'"))
  assert.ok(authSource.includes('Reconectando sua sessão'))
  assert.ok(appSource.includes("authError ?? 'Carregando...'"))
})

test('the explicit sign-out path remains responsible for ending the session', () => {
  const signOutStart = authSource.indexOf('signOut: async')
  const signOutEnd = authSource.indexOf('loadProfile: async', signOutStart)
  const beforeSignOut = authSource.slice(0, signOutStart)
  const signOut = authSource.slice(signOutStart, signOutEnd)

  assert.equal(beforeSignOut.includes('supabase.auth.signOut()'), false)
  assert.ok(signOut.includes('supabase.auth.signOut()'))
})
