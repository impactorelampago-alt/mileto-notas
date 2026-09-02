import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const mainAppSource = readFileSync(new URL('../src/pages/MainApp.tsx', import.meta.url), 'utf8')
const tabBarSource = readFileSync(
  new URL('../src/components/layout/TabBar.tsx', import.meta.url),
  'utf8',
)
const notesStoreSource = readFileSync(
  new URL('../src/stores/notes-store.ts', import.meta.url),
  'utf8',
)
const sharingStoreSource = readFileSync(
  new URL('../src/stores/sharing-store.ts', import.meta.url),
  'utf8',
)

test('startup waits for sharing once and loads notes and Ops in parallel', () => {
  assert.match(mainAppSource, /await loadShares\(\)/)
  assert.match(mainAppSource, /await Promise\.all\(\[loadNotes\(\), loadOpsData\(\)\]\)/)
  assert.doesNotMatch(mainAppSource, /scheduleOpsRefresh\('shares-loaded'\)/)
})

test('heavy editor is split from the initial renderer bundle', () => {
  assert.match(mainAppSource, /const Editor = lazy\(\(\) => import\('\.\.\/components\/editor\/Editor'\)\)/)
  assert.match(mainAppSource, /<Suspense fallback=/)
})

test('typing note content does not invalidate the app shell or tab metadata', () => {
  assert.doesNotMatch(mainAppSource, /useNotesStore\(\(s\) => s\.notes\)/)
  assert.match(mainAppSource, /const activeNoteContext = useNotesStore\(useShallow/)

  const metadataStart = tabBarSource.indexOf('useNotesStore(useShallow')
  const metadataEnd = tabBarSource.indexOf('const notes = useNotesStore.getState()', metadataStart)
  assert.ok(metadataStart >= 0 && metadataEnd > metadataStart)
  assert.doesNotMatch(tabBarSource.slice(metadataStart, metadataEnd), /note\.content/)
})

test('sharing bootstrap issues independent reads concurrently', () => {
  assert.match(sharingStoreSource, /await Promise\.all\(\[/)
  assert.match(sharingStoreSource, /ownedNotes, ownedCategories, incomingNotes, incomingCategories/)
  assert.match(sharingStoreSource, /currentAuth\.user\?\.id !== uid/)
})

test('subnote refresh coalesces identical reads and parallelizes batches', () => {
  assert.match(notesStoreSource, /const _subnoteLoadAttempts = new Map/)
  assert.match(notesStoreSource, /_subnoteLoadAttempts\.get\(loadKey\)/)
  assert.match(notesStoreSource, /Promise\.all\(batches\.map/)
  assert.match(notesStoreSource, /_subnoteLoadAttempts\.delete\(loadKey\)/)
})
