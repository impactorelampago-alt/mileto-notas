import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(
  new URL('../supabase/migrations/20260825120000_notas_program_history.sql', import.meta.url),
  'utf8',
)
const sharedCategoryMigration = readFileSync(
  new URL('../supabase/migrations/20260825123000_notas_shared_category_programs.sql', import.meta.url),
  'utf8',
)
const reporterHistoryMigration = readFileSync(
  new URL('../supabase/migrations/20260827120000_notas_program_reporter_history.sql', import.meta.url),
  'utf8',
)
const responsibilityMigration = readFileSync(
  new URL('../supabase/migrations/20260902120000_notas_program_responsibility.sql', import.meta.url),
  'utf8',
)
const tabBar = readFileSync(new URL('../src/components/layout/TabBar.tsx', import.meta.url), 'utf8')
const subnoteTree = readFileSync(new URL('../src/components/editor/SubnoteTree.tsx', import.meta.url), 'utf8')
const categorySelect = readFileSync(new URL('../src/components/layout/CategorySelect.tsx', import.meta.url), 'utf8')
const historyStore = readFileSync(new URL('../src/stores/program-history-store.ts', import.meta.url), 'utf8')
const historyPage = readFileSync(new URL('../src/pages/ProgramHistory.tsx', import.meta.url), 'utf8')
const responsibilitySelect = readFileSync(
  new URL('../src/components/programs/ProgramResponsibilitySelect.tsx', import.meta.url),
  'utf8',
)
const notesStore = readFileSync(new URL('../src/stores/notes-store.ts', import.meta.url), 'utf8')
const collabStore = readFileSync(new URL('../src/stores/collab-store.ts', import.meta.url), 'utf8')
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

test('history audit rows remain private and programmer data is restricted to own work', () => {
  assert.match(reporterHistoryMigration, /v_access = 'SELF' AND \(\s*history\.reporter_id = v_uid\s*OR history\.completed_by = v_uid/)
  assert.match(reporterHistoryMigration, /v_access = 'SELF' AND contribution\.person_id = v_uid/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.notas_program_history FROM PUBLIC, anon, authenticated/)
})

test('every internal employee gets a personal reporter view with the real completer', () => {
  assert.match(reporterHistoryMigration, /IF v_account IS NULL THEN\s*RETURN 'NONE'/)
  assert.match(reporterHistoryMigration, /RETURN 'REPORTER'/)
  assert.match(reporterHistoryMigration, /v_access = 'REPORTER' AND history\.reporter_id = v_uid/)
  assert.match(reporterHistoryMigration, /history\.completed_by_name_snapshot/)
  assert.doesNotMatch(reporterHistoryMigration, /ELSE 'Equipe'/)
  assert.match(historyStore, /'NONE' \| 'REPORTER' \| 'SELF' \| 'TEAM'/)
  assert.match(historyStore, /access === 'REPORTER'/)
  assert.match(historyPage, /accessLevel === 'REPORTER'/)
  assert.match(historyPage, /quem realizou cada correção/)
})

test('reporter metrics contain only own submissions and all program writes stay blocked', () => {
  assert.match(reporterHistoryMigration, /v_access = 'REPORTER'[\s\S]*?contribution\.person_id = v_uid[\s\S]*?contribution\.contribution_kind = 'REPORT'/)
  assert.equal(
    [...reporterHistoryMigration.matchAll(/notas_program_access_level\(\) NOT IN \('TEAM', 'SELF'\)/g)].length,
    3,
  )
  assert.match(reporterHistoryMigration, /v_access IN \('TEAM', 'SELF'\)[\s\S]*?AS can_reopen/)
  assert.match(historyStore, /function canManageProgramWorkflow/)
  assert.match(categorySelect, /canConfigurePrograms = canManageProgramWorkflow\(programAccess\)/)
  assert.match(subnoteTree, /canDeleteSubnotes = canEditRoot && \(!isProgramRoot \|\| canManageProgramTasks\)/)
  assert.match(historyPage, /!isReporterView && \(/)
})

test('categories can be classified as programs and history is loaded only through RPCs', () => {
  assert.match(categorySelect, /setNewProgram/)
  assert.match(categorySelect, /setCategoryProgram\(created\.key, true\)/)
  assert.match(categorySelect, /Marcar como programa/)
  assert.match(historyStore, /notas_program_history_list/)
  assert.match(historyStore, /notas_program_history_metrics/)
  assert.match(historyStore, /notas_complete_program_subnote/)
})

test('shared categories can be classified without exposing owner-only actions', () => {
  assert.match(categorySelect, /const canConfigureThisProgram =/)
  assert.match(categorySelect, /canConfigurePrograms && \(isOwner \|\| isSharedWithMe\)/)
  assert.match(categorySelect, /isHovered && \(canManage \|\| canConfigureThisProgram\)/)
  assert.match(categorySelect, /\{canManage && \(/)
  assert.match(sharedCategoryMigration, /FROM public\.category_shares AS share/)
  assert.match(sharedCategoryMigration, /share\.shared_with = v_uid/)
  assert.match(sharedCategoryMigration, /public\.notas_owns_category_key\(p_category_key\)/)
})

test('completion snapshots the active editor before the subnote is archived', () => {
  assert.match(historyStore, /capture-active-note-snapshot/)
  assert.match(historyStore, /p_title: snapshot\.title/)
  assert.match(historyStore, /p_content: snapshot\.content/)
  assert.match(editor, /collabSession\.ytext\.toString\(\)/)
  assert.match(editor, /request\.snapshot = \{ title, content \}/)
})

test('completed or deleted subnotes disappear for every session even when realtime is missed', () => {
  assert.match(historyStore, /removeInactiveNoteLocally\(noteId, note\.parent_note_id\)/)
  assert.match(historyStore, /removeIfInactiveOnServer/)
  assert.match(notesStore, /fetchInactiveNoteIds\(missingCachedNotes\)/)
  assert.match(notesStore, /notes\?select=id,is_archived&id=in/)
  assert.match(notesStore, /visibleRootIds\.has\(candidate\.parentNoteId\)/)
  assert.match(notesStore, /payload\.eventType === 'DELETE'[\s\S]*?removeInactiveNoteLocally\(rowId, rootId\)/)
  assert.match(notesStore, /openTabs: state\.openTabs\.filter\(\(id\) => id !== noteId\)/)
  assert.match(notesStore, /removeDraft\(noteId\)/)
  assert.match(notesStore, /discardNote\(noteId\)/)
  assert.match(collabStore, /_discardedNoteIds\.add\(noteId\)/)
  assert.match(editor, /if \(!current\) return/)
})

test('program responsibility uses configured active programmer cargos', () => {
  assert.match(responsibilityMigration, /notas_programmer_membership/)
  assert.match(responsibilityMigration, /PROGRAMADORLIDER/)
  assert.match(responsibilityMigration, /employment_status/)
  assert.match(responsibilityMigration, /terminated_at IS NULL/)
  assert.match(responsibilityMigration, /only configured programmers can assign programs/)
  assert.match(responsibilityMigration, /programmer can only assume an unassigned program/)
  assert.match(responsibilityMigration, /program already belongs to another programmer/)
})

test('responsibility transfers preserve an immutable audit and completion snapshot', () => {
  assert.match(responsibilityMigration, /CREATE TABLE IF NOT EXISTS public\.notas_program_assignments/)
  assert.match(responsibilityMigration, /REVOKE ALL ON TABLE public\.notas_program_assignments FROM PUBLIC, anon, authenticated/)
  assert.match(responsibilityMigration, /responsible_programmer_id_snapshot/)
  assert.match(responsibilityMigration, /BEFORE INSERT ON public\.notas_program_history/)
})

test('agent report sources isolate pending and completed work by responsible programmer', () => {
  assert.match(responsibilityMigration, /notas_program_pending_report/)
  assert.match(responsibilityMigration, /program\.responsible_programmer_id = v_target/)
  assert.match(responsibilityMigration, /child\.is_archived = false/)
  assert.match(responsibilityMigration, /notas_program_completed_report/)
  assert.match(responsibilityMigration, /h\.responsible_programmer_id_snapshot = v_target/)
  assert.match(responsibilityMigration, /h\.reopened_at IS NULL/)
  assert.match(responsibilityMigration, /programmers can only read their own report/)
})

test('program responsibility is visible and editable only by the permitted programmer', () => {
  assert.match(historyStore, /notas_program_assignment_access/)
  assert.match(historyStore, /notas_programmer_options/)
  assert.match(historyStore, /notas_assign_program_responsible/)
  assert.match(responsibilitySelect, /assignmentAccess === 'LEAD'/)
  assert.match(responsibilitySelect, /Assumir/)
  assert.match(categorySelect, /ProgramResponsibilitySelect program=\{program\} compact/)
  assert.match(historyPage, /ProgramResponsibilitySelect program=\{selectedProgram\}/)
})
