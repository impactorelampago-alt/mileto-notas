import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../src/stores/ops-store.ts', import.meta.url), 'utf8')

test('task polling is a visible-only, low-frequency realtime backstop', () => {
  assert.match(source, /if \(document\.visibilityState !== 'visible'\) return/)
  assert.match(source, /refreshOpsSnapshot\('polling-visible-60s'\)/)
  assert.match(source, /}, 60_000\)/)
  assert.doesNotMatch(source, /refreshOpsSnapshot\('polling-10s'\)/)
})

test('polling never queues an overlapping refresh', () => {
  assert.match(source, /const admission = _refreshCoordinator\.admit\(reason\)/)
  assert.match(source, /if \(admission\.kind === 'skipped'\)/)
  assert.doesNotMatch(source, /_pendingRefresh/)
})

test('realtime and focus reconciliation remain active', () => {
  assert.match(source, /subscribeToOpsChanges/)
  assert.match(source, /document\.addEventListener\('visibilitychange', handleVisibility\)/)
  assert.match(source, /refreshOpsSnapshot\('window-focus'\)/)
})
