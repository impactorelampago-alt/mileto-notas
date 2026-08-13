import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const storeSource = readFileSync(new URL('../src/stores/ops-store.ts', import.meta.url), 'utf8')
const syncStatusSource = readFileSync(
  new URL('../src/components/layout/SyncStatus.tsx', import.meta.url),
  'utf8',
)

test('categories are published before the tasks request is awaited', () => {
  const publishIndex = storeSource.indexOf('sections: newSections')
  const taskAwaitIndex = storeSource.indexOf('const taskResult = await taskRequest')

  assert.ok(publishIndex >= 0, 'expected categories publication')
  assert.ok(taskAwaitIndex > publishIndex, 'tasks must not block categories publication')
})

test('a failed tasks request preserves tasks and skips task-dependent reconciliation', () => {
  const failureStart = storeSource.indexOf('if (!taskResult.ok)')
  const successfulTasksPublish = storeSource.indexOf('tasks: newTasks', failureStart)
  const failureBranch = storeSource.slice(failureStart, successfulTasksPublish)

  assert.match(failureBranch, /taskRefreshScopeIsCurrent\(taskRefreshScope\)/)
  assert.match(failureBranch, /set\(\{ syncError, isSyncing: false \}\)/)
  assert.match(failureBranch, /return/)
  assert.doesNotMatch(failureBranch, /tasks:/)
  assert.ok(
    storeSource.indexOf('ensureNotesForOrphanTasks()', successfulTasksPublish) > successfulTasksPublish,
    'task-dependent reconciliation must only run after a valid tasks publication',
  )
})

test('sync error is visible and manual retry bypasses automatic backoff', () => {
  assert.match(storeSource, /reason === 'manual-sync' \|\| Date\.now\(\) >= _nextTaskRefreshAt/)
  assert.match(syncStatusSource, /Notas desatualizadas · tentar/)
  assert.match(syncStatusSource, /const outcome = await useOpsStore\.getState\(\)\.refreshOpsSnapshot\('manual-sync'\)/)
  assert.match(syncStatusSource, /if \(outcome === 'complete'\)/)
  assert.doesNotMatch(syncStatusSource, /if \(!useOpsStore\.getState\(\)\.syncError\)/)
})

test('stale account failures cannot publish error or backoff into the next account', () => {
  const taskFailure = storeSource.slice(
    storeSource.indexOf('if (!taskResult.ok)'),
    storeSource.indexOf('const taskData = taskResult.data'),
  )
  const identityGuard = taskFailure.indexOf('if (!taskRefreshScopeIsCurrent(taskRefreshScope))')
  const registerFailure = taskFailure.indexOf('registerTaskRefreshFailure(taskRefreshScope)')
  const publishError = taskFailure.indexOf('set({ syncError, isSyncing: false })')

  assert.ok(identityGuard >= 0, 'task failure must revalidate the complete account scope')
  assert.ok(registerFailure > identityGuard, 'stale scope must be rejected before mutating backoff')
  assert.ok(publishError > identityGuard, 'stale scope must be rejected before publishing UI error')
})

test('pending refresh is always handed to the coordinator, even after an older failure', () => {
  const finallyStart = storeSource.indexOf('} finally {', storeSource.indexOf('refreshOpsSnapshot: async'))
  const finallyEnd = storeSource.indexOf('  scheduleOpsRefresh:', finallyStart)
  const finallyBranch = storeSource.slice(finallyStart, finallyEnd)

  assert.match(finallyBranch, /_refreshCoordinator\.finish/)
  assert.doesNotMatch(finallyBranch, /syncError/)
  assert.doesNotMatch(finallyBranch, /failed/)
})
