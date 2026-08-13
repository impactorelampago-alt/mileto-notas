import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const authSource = readFileSync(new URL('../src/stores/auth-store.ts', import.meta.url), 'utf8')
const loginSource = readFileSync(new URL('../src/pages/Login.tsx', import.meta.url), 'utf8')

test('only signed server app_metadata classifies an internal principal', () => {
  assert.match(authSource, /session\.user\.app_metadata\?\.principal_type/)
  assert.match(authSource, /principal === 'staff' \|\| principal === 'platform'/)
  assert.doesNotMatch(authSource, /user_metadata\?\.principal_type/)
  assert.match(authSource, /principal === 'client'/)
  assert.match(authSource, /Portal Mileto Ops/)
})

test('staff and platform never publish an AAL1 session', () => {
  const gateStart = authSource.indexOf('const evaluateSession = async')
  const gateEnd = authSource.indexOf('const registerAuthListener', gateStart)
  const gate = authSource.slice(gateStart, gateEnd)

  const aal2Branch = gate.indexOf("assurance.currentLevel === 'aal2'")
  const publish = gate.indexOf('publishAuthenticatedSession', aal2Branch)
  const listFactors = gate.indexOf('supabase.auth.mfa.listFactors()', aal2Branch)
  const setup = gate.indexOf('mfaSetupRequired: true', listFactors)

  assert.ok(aal2Branch >= 0, 'expected an explicit AAL2 branch')
  assert.ok(publish > aal2Branch, 'profile/app publication must occur only in the AAL2 branch')
  assert.ok(listFactors > publish, 'AAL1 must continue to challenge/setup instead of publishing')
  assert.ok(setup > listFactors, 'AAL1 without a verified factor must enter setup')
  assert.doesNotMatch(gate.slice(listFactors), /publishAuthenticatedSession/)
})

test('profile lookup is fail-closed before authenticated state is published', () => {
  const publishStart = authSource.indexOf('const publishAuthenticatedSession')
  const publishEnd = authSource.indexOf('/**', publishStart)
  const publish = authSource.slice(publishStart, publishEnd)

  const guard = publish.indexOf('if (loaded.error || !loaded.profile)')
  const authenticated = publish.indexOf('isAuthenticated: true')
  assert.ok(guard >= 0)
  assert.ok(authenticated > guard)
  assert.match(publish.slice(guard, authenticated), /return false/)
})

test('first-factor enrollment never removes another device factor and keeps QR secret ephemeral', () => {
  const start = authSource.indexOf('startMfaEnrollment: async')
  const end = authSource.indexOf('verifyMfa: async', start)
  const enrollment = authSource.slice(start, end)

  const enroll = enrollment.indexOf('supabase.auth.mfa.enroll')
  assert.ok(enroll >= 0)
  assert.doesNotMatch(enrollment, /supabase\.auth\.mfa\.unenroll/)
  assert.match(enrollment, /window\.crypto\.randomUUID/)
  assert.match(enrollment, /qrCode: enrolled\.totp\.qr_code/)
  assert.match(enrollment, /secret: enrolled\.totp\.secret/)
  assert.doesNotMatch(enrollment, /localStorage|sessionStorage|console\.(?:log|warn|error)/)
})

test('verification confirms the refreshed session before opening the app', () => {
  const verifyStart = authSource.indexOf('verifyMfa: async')
  const verifyEnd = authSource.indexOf('cancelMfa: async', verifyStart)
  const verify = authSource.slice(verifyStart, verifyEnd)

  const challenge = verify.indexOf('challengeAndVerify({ factorId, code })')
  const session = verify.indexOf('supabase.auth.getSession()', challenge)
  const identity = verify.indexOf('data.session.user.id !== userId', session)
  const evaluate = verify.indexOf('evaluateSession(data.session)', identity)
  assert.ok(challenge >= 0)
  assert.ok(session > challenge)
  assert.ok(identity > session)
  assert.ok(evaluate > identity)
  assert.match(verify, /mfaVerificationGeneration/)
  assert.match(verify, /isCurrentIdentity\(\)/)
  assert.match(verify, /get\(\)\.pendingMfaFactorId === factorId/)
})

test('enrollment and cancellation preserve account-generation boundaries', () => {
  const start = authSource.indexOf('startMfaEnrollment: async')
  const signOut = authSource.indexOf('signOut: async')
  const enrollment = authSource.slice(start, authSource.indexOf('verifyMfa: async', start))
  const cancellation = authSource.slice(signOut, authSource.indexOf('loadProfile: async', signOut))

  assert.match(enrollment, /generation === authEvaluationGeneration/)
  assert.match(enrollment, /get\(\)\.user\?\.id === userId/)
  assert.match(cancellation, /get\(\)\.mfaEnrollment \? get\(\)\.pendingMfaFactorId : null/)
  assert.match(cancellation, /supabase\.auth\.mfa\.unenroll/)
})

test('login exposes green themed QR setup and a safe cancel path', () => {
  assert.match(loginSource, /Gerar QR Code/)
  assert.match(loginSource, /src=\{mfaEnrollment\.qrCode\}/)
  assert.match(loginSource, /mfaEnrollment\.secret/)
  assert.match(loginSource, /Ativar e continuar/)
  assert.match(loginSource, /cancelMfa\(\)/)
  assert.match(loginSource, /rgba\(16,185,129/)
})
