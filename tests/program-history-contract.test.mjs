import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(
  new URL('../supabase/migrations/20260825120000_notas_program_history.sql', import.meta.url),
  'utf8',
)
const tabBar = readFileSync(new URL('../src/components/layout/TabBar.tsx', import.meta.url), 'utf8')
const subnoteTree = readFileSync(new URL('../src/components/editor/SubnoteTree.tsx', import.meta.url), 'utf8')
const categorySelect = readFileSync(new URL('../src/components/layout/CategorySelect.tsx', import.meta.url), 'utf8')
const historyStore = readFileSync(new URL('../src/stores/program-history-store.ts', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../src/components/editor/Editor.tsx', import.meta.url), 'utf8')

test('program history accepts only subnotes and inherits the root task responsibility', () => {
  assert.match(migration, /v_child\.parent_note_id IS NULL/)
  assert.match(migration, /aceita somente subnotas/)
  assert.match(migration, /v_reporter := coalesce\(v_task\.assignee_id, v_root\.creator_id\)/)
  assert.match(migration, /root_title_snapshot/)
})

test('program roots cannot be completed while subnotes have their own direct completion', () => {
  assert.match(migration, /trg_notas_guard_program_root_completion/)
  assert.match(tabBar, /const isProgramRoot/)
  assert.match(tabBar, /const canComplete = !isProgramRoot/)
  assert.match(subnoteTree, /completeSubnote\(note\.id\)/)
  assert.match(subnoteTree, /Concluir e enviar ao histórico/)
})

test('history access includes management roles and the Ops programmer cargo', () => {
  assert.match(migration, /v_role IN \('DONO', 'GERENTE', 'COORDENADOR'\)/)
  assert.match(migration, /notas_programmer_cargo_keys/)
  assert.match(migration, /= 'PROGRAMADOR'/)
  assert.match(migration, /RETURN CASE WHEN v_is_programmer THEN 'SELF' ELSE 'NONE' END/)
})

test('programmer metrics are restricted to the authenticated user', () => {
  assert.match(migration, /v_team boolean := public\.notas_program_access_level\(\) = 'TEAM'/)
  assert.match(migration, /WHERE v_team OR contribution\.person_id = v_uid/)
  assert.match(migration, /ELSE 'Equipe'/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.notas_program_history FROM PUBLIC, anon, authenticated/)
})

test('categories can be classified as programs and history is loaded only through RPCs', () => {
  assert.match(categorySelect, /setNewProgram/)
  assert.match(categorySelect, /setCategoryProgram\(created\.key, true\)/)
  assert.match(categorySelect, /Marcar como programa/)
  assert.match(historyStore, /notas_program_history_list/)
  assert.match(historyStore, /notas_program_history_metrics/)
  assert.match(historyStore, /notas_complete_program_subnote/)
})

test('completion snapshots the active editor before the subnote is archived', () => {
  assert.match(historyStore, /capture-active-note-snapshot/)
  assert.match(historyStore, /p_title: snapshot\.title/)
  assert.match(historyStore, /p_content: snapshot\.content/)
  assert.match(editor, /collabSession\.ytext\.toString\(\)/)
  assert.match(editor, /request\.snapshot = \{ title, content \}/)
})
