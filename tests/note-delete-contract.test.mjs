import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const tabBarSource = readFileSync(new URL('../src/components/layout/TabBar.tsx', import.meta.url), 'utf8')
const subnoteTreeSource = readFileSync(new URL('../src/components/editor/SubnoteTree.tsx', import.meta.url), 'utf8')

test('root notes are deleted immediately from both tab actions without opening a confirmation', () => {
  const deleteStart = tabBarSource.indexOf('const deleteImmediately')
  const deleteEnd = tabBarSource.indexOf('const handleCreateNote', deleteStart)
  const deleteFlow = tabBarSource.slice(deleteStart, deleteEnd)

  assert.ok(deleteStart >= 0, 'expected a direct root-note delete handler')
  assert.match(deleteFlow, /deletingNoteIdsRef\.current\.has\(noteId\)/)
  assert.match(deleteFlow, /deleteNote\(noteId\)/)
  assert.doesNotMatch(deleteFlow, /openConfirm/)
  assert.doesNotMatch(tabBarSource, /const askDelete/)

  const directDeleteReferences = tabBarSource.match(/deleteImmediately\(/g) ?? []
  assert.equal(directDeleteReferences.length, 2, 'expected tab and context-menu calls')
})

test('subnote deletion keeps its destructive-action confirmation', () => {
  assert.match(subnoteTreeSource, /title: 'Excluir subnota'/)
  assert.match(subnoteTreeSource, /openConfirm\(\{/)
})
