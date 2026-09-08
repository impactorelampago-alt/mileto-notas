import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(
  new URL('../supabase/migrations/20260908183000_notas_subnote_auxiliary_visibility.sql', import.meta.url),
  'utf8',
)
const collabStore = readFileSync(new URL('../src/stores/collab-store.ts', import.meta.url), 'utf8')

test('auxiliary note data inherits the canonical subnote-aware visibility', () => {
  assert.match(migration, /create or replace function public\.user_can_view_note/)
  assert.match(migration, /public\.notas_note_visible_to\(target_note_id, auth\.uid\(\)\)/)
  assert.match(migration, /security definer/)
  assert.match(migration, /grant execute on function public\.user_can_view_note\(uuid\) to authenticated/)
})

test('collab seed fails closed when an existing CRDT row is hidden by RLS', () => {
  const seedState = collabStore.slice(
    collabStore.indexOf('async function seedState'),
    collabStore.indexOf('function takePendingSimpleEdit'),
  )

  assert.match(seedState, /\.from\('note_yjs'\)\.insert\(/)
  assert.match(seedState, /error\.code !== '23505'/)
  assert.match(seedState, /const stored = await loadState\(noteId\)/)
  assert.match(seedState, /if \(!stored\)/)
  assert.match(seedState, /estado existente não está legível/)
  assert.doesNotMatch(seedState, /\.upsert\(/)
  assert.doesNotMatch(seedState, /return stored \? stored\.update : update/)
})
