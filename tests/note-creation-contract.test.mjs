import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const mainAppSource = readFileSync(new URL('../src/pages/MainApp.tsx', import.meta.url), 'utf8')
const tabBarSource = readFileSync(new URL('../src/components/layout/TabBar.tsx', import.meta.url), 'utf8')

test('opening the app or an empty category never creates a blank note automatically', () => {
  assert.doesNotMatch(mainAppSource, /\bcreateNote\b/)

  const createCalls = tabBarSource.match(/\bcreateNote\(\{/g) ?? []
  assert.equal(createCalls.length, 1, 'only the explicit New note action may create a note')

  const manualCreateStart = tabBarSource.indexOf('const handleCreateNote')
  const manualCreateEnd = tabBarSource.indexOf('\n  return (', manualCreateStart)
  const manualCreateFlow = tabBarSource.slice(manualCreateStart, manualCreateEnd)

  assert.ok(manualCreateStart >= 0, 'expected the explicit New note handler')
  assert.match(manualCreateFlow, /await createNote\(\{/)
})
