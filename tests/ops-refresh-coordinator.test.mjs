import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  OpsRefreshCoordinator,
  preferRefreshReason,
} from '../src/lib/ops-refresh-coordinator.ts'

test('polling is skipped while a refresh is running and never creates a deferred cycle', async () => {
  const coordinator = new OpsRefreshCoordinator()
  assert.equal(coordinator.admit('initial-load').kind, 'run')

  const poll = coordinator.admit('polling-visible-60s')
  assert.deepEqual(poll, { kind: 'skipped', outcome: 'skipped' })

  let deferredRuns = 0
  coordinator.finish(async () => {
    deferredRuns += 1
    return 'complete'
  })
  await Promise.resolve()
  assert.equal(deferredRuns, 0)
})

test('manual retry queued behind another refresh waits for the real prioritized cycle', async () => {
  const coordinator = new OpsRefreshCoordinator()
  assert.equal(coordinator.admit('initial-load').kind, 'run')

  const realtime = coordinator.admit('realtime:tasks')
  const manual = coordinator.admit('manual-sync')
  assert.equal(realtime.kind, 'queued')
  assert.equal(manual.kind, 'queued')
  assert.equal(realtime.promise, manual.promise, 'all queued callers await the same real cycle')

  let executedReason = ''
  coordinator.finish(async (reason) => {
    executedReason = reason
    return 'complete'
  })

  assert.equal(await manual.promise, 'complete')
  assert.equal(await realtime.promise, 'complete')
  assert.equal(executedReason, 'manual-sync')
})

test('account/view refresh reason is not overwritten by lower-priority realtime noise', async () => {
  const coordinator = new OpsRefreshCoordinator()
  assert.equal(coordinator.admit('initial-load').kind, 'run')
  const viewSwitch = coordinator.admit('view-switch')
  coordinator.admit('realtime:tasks')

  let executedReason = ''
  coordinator.finish(async (reason) => {
    executedReason = reason
    return 'partial'
  })

  assert.equal(viewSwitch.kind, 'queued')
  assert.equal(await viewSwitch.promise, 'partial')
  assert.equal(executedReason, 'view-switch')
})

test('refresh priorities preserve manual and new-view intent', () => {
  assert.equal(preferRefreshReason('realtime:tasks', 'view-all-toggle'), 'view-all-toggle')
  assert.equal(preferRefreshReason('view-switch', 'realtime:shares'), 'view-switch')
  assert.equal(preferRefreshReason('view-switch', 'manual-sync'), 'manual-sync')
})
