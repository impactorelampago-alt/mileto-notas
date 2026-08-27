import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useNotesStore } from './notes-store'
import { useAuthStore } from './auth-store'

export type ProgramAccessLevel = 'NONE' | 'REPORTER' | 'SELF' | 'TEAM'
export type ProgramHistoryPeriod = '30d' | '90d' | 'all'

export function canManageProgramWorkflow(accessLevel: ProgramAccessLevel): boolean {
  return accessLevel === 'TEAM' || accessLevel === 'SELF'
}

export interface NotasProgram {
  id: string
  account_id: string
  category_key: string
  name: string
  color: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface ProgramHistoryItem {
  id: string
  program_id: string
  note_id: string | null
  root_note_id: string | null
  title: string
  content: string
  priority: string | null
  root_title: string
  reporter_id: string | null
  reporter_name: string
  completed_by: string | null
  completed_by_name: string
  source_created_at: string | null
  completed_at: string
  can_reopen: boolean
}

export interface ProgramHistoryMetric {
  user_id: string
  user_name: string
  reported_count: number
  completed_count: number
}

export interface ActiveNoteSnapshot {
  title: string
  content: string
}

export interface ActiveNoteSnapshotRequest {
  noteId: string
  snapshot: ActiveNoteSnapshot | null
}

interface ProgramHistoryState {
  programs: NotasProgram[]
  accessLevel: ProgramAccessLevel
  isLoaded: boolean
  isLoadingPrograms: boolean
  isHistoryOpen: boolean
  selectedProgramId: string | null
  period: ProgramHistoryPeriod
  items: ProgramHistoryItem[]
  metrics: ProgramHistoryMetric[]
  isLoadingHistory: boolean
  completingNoteIds: Set<string>
  error: string | null
  loadPrograms: () => Promise<void>
  clear: () => void
  setCategoryProgram: (categoryKey: string, isProgram: boolean) => Promise<boolean>
  openHistory: () => Promise<void>
  closeHistory: () => void
  selectProgram: (programId: string) => Promise<void>
  setPeriod: (period: ProgramHistoryPeriod) => Promise<void>
  loadHistory: (programId?: string | null) => Promise<void>
  completeSubnote: (noteId: string) => Promise<boolean>
  reopenItem: (historyId: string) => Promise<boolean>
}

function periodStart(period: ProgramHistoryPeriod): string | null {
  if (period === 'all') return null
  const days = period === '30d' ? 30 : 90
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export const useProgramHistoryStore = create<ProgramHistoryState>()((set, get) => ({
  programs: [],
  accessLevel: 'NONE',
  isLoaded: false,
  isLoadingPrograms: false,
  isHistoryOpen: false,
  selectedProgramId: null,
  period: '30d',
  items: [],
  metrics: [],
  isLoadingHistory: false,
  completingNoteIds: new Set<string>(),
  error: null,

  loadPrograms: async () => {
    const userId = useAuthStore.getState().user?.id ?? null
    if (!userId) {
      get().clear()
      return
    }

    set({ isLoadingPrograms: true, error: null })
    const [accessResult, programsResult] = await Promise.all([
      supabase.rpc('notas_program_access_level'),
      supabase
        .from('notas_programs')
        .select('id,account_id,category_key,name,color,active,created_at,updated_at')
        .order('active', { ascending: false })
        .order('name', { ascending: true }),
    ])

    if (useAuthStore.getState().user?.id !== userId) return

    if (accessResult.error || programsResult.error) {
      const message = errorMessage(
        accessResult.error ?? programsResult.error,
        'Não foi possível carregar as categorias de programa.',
      )
      console.error('[program-history] loadPrograms:', message)
      set({
        accessLevel: 'NONE',
        programs: [],
        isLoaded: true,
        isLoadingPrograms: false,
        isHistoryOpen: false,
        error: message,
      })
      return
    }

    const access = accessResult.data
    const accessLevel: ProgramAccessLevel =
      access === 'TEAM' || access === 'SELF' || access === 'REPORTER' ? access : 'NONE'
    const programs = (programsResult.data ?? []) as NotasProgram[]
    const selectedStillExists = programs.some((program) => program.id === get().selectedProgramId)
    const selectedProgramId = selectedStillExists
      ? get().selectedProgramId
      : (programs.find((program) => program.active)?.id ?? programs[0]?.id ?? null)

    set({
      accessLevel,
      programs,
      selectedProgramId,
      isLoaded: true,
      isLoadingPrograms: false,
      isHistoryOpen: accessLevel === 'NONE' ? false : get().isHistoryOpen,
    })
  },

  clear: () => set({
    programs: [],
    accessLevel: 'NONE',
    isLoaded: false,
    isLoadingPrograms: false,
    isHistoryOpen: false,
    selectedProgramId: null,
    items: [],
    metrics: [],
    isLoadingHistory: false,
    completingNoteIds: new Set<string>(),
    error: null,
  }),

  setCategoryProgram: async (categoryKey, isProgram) => {
    if (!canManageProgramWorkflow(get().accessLevel)) {
      set({ error: 'Seu acesso ao Histórico é somente para acompanhar suas solicitações.' })
      return false
    }
    set({ error: null })
    const { error } = await supabase.rpc('notas_set_category_program', {
      p_category_key: categoryKey,
      p_is_program: isProgram,
    })
    if (error) {
      const message = errorMessage(error, 'Não foi possível alterar o tipo da categoria.')
      console.error('[program-history] setCategoryProgram:', message)
      set({ error: message })
      return false
    }
    await get().loadPrograms()
    return true
  },

  openHistory: async () => {
    if (get().accessLevel === 'NONE') return
    set({ isHistoryOpen: true, error: null })
    await get().loadHistory()
  },

  closeHistory: () => set({ isHistoryOpen: false, error: null }),

  selectProgram: async (programId) => {
    if (!get().programs.some((program) => program.id === programId)) return
    set({ selectedProgramId: programId, error: null })
    await get().loadHistory(programId)
  },

  setPeriod: async (period) => {
    set({ period, error: null })
    await get().loadHistory()
  },

  loadHistory: async (programId) => {
    const targetProgramId = programId ?? get().selectedProgramId
    if (!targetProgramId || get().accessLevel === 'NONE') {
      set({ items: [], metrics: [], isLoadingHistory: false })
      return
    }

    const userId = useAuthStore.getState().user?.id ?? null
    const from = periodStart(get().period)
    set({ isLoadingHistory: true, error: null })

    const args = {
      p_program_id: targetProgramId,
      p_from: from,
      p_to: null,
    }
    const [itemsResult, metricsResult] = await Promise.all([
      supabase.rpc('notas_program_history_list', args),
      supabase.rpc('notas_program_history_metrics', args),
    ])

    if (
      useAuthStore.getState().user?.id !== userId
      || get().selectedProgramId !== targetProgramId
    ) return

    if (itemsResult.error || metricsResult.error) {
      const message = errorMessage(
        itemsResult.error ?? metricsResult.error,
        'Não foi possível carregar o histórico do programa.',
      )
      console.error('[program-history] loadHistory:', message)
      set({ items: [], metrics: [], isLoadingHistory: false, error: message })
      return
    }

    const items = (itemsResult.data ?? []) as ProgramHistoryItem[]
    const metrics = ((metricsResult.data ?? []) as Array<Omit<ProgramHistoryMetric, 'reported_count' | 'completed_count'> & {
      reported_count: number | string
      completed_count: number | string
    }>).map((metric) => ({
      ...metric,
      reported_count: Number(metric.reported_count) || 0,
      completed_count: Number(metric.completed_count) || 0,
    }))

    set({ items, metrics, isLoadingHistory: false })
  },

  completeSubnote: async (noteId) => {
    if (!canManageProgramWorkflow(get().accessLevel) || get().completingNoteIds.has(noteId)) {
      return false
    }

    const note = useNotesStore.getState().notes.find((item) => item.id === noteId)
    if (!note?.parent_note_id) return false

    const completingNoteIds = new Set(get().completingNoteIds)
    completingNoteIds.add(noteId)
    set({ completingNoteIds, error: null })

    const snapshotRequest: ActiveNoteSnapshotRequest = { noteId, snapshot: null }
    if (useNotesStore.getState().activeTabId === noteId) {
      window.dispatchEvent(new CustomEvent<ActiveNoteSnapshotRequest>(
        'capture-active-note-snapshot',
        { detail: snapshotRequest },
      ))
    }
    const snapshot = snapshotRequest.snapshot ?? { title: note.title, content: note.content }

    try {
      const { error } = await supabase.rpc('notas_complete_program_subnote', {
        p_note_id: noteId,
        p_title: snapshot.title,
        p_content: snapshot.content,
      })
      if (error) {
        // Outra sessão/versão pode já ter arquivado ou excluído a subnota. Se a
        // raiz continua visível e a filha deixou de ser pendência no servidor,
        // limpa o fantasma local e trata a intenção do usuário como satisfeita.
        const removed = await useNotesStore.getState().removeIfInactiveOnServer(
          noteId,
          note.parent_note_id,
        )
        if (removed) {
          set({ error: null })
          if (get().isHistoryOpen && get().selectedProgramId) await get().loadHistory()
          return true
        }
        const message = errorMessage(error, 'Não foi possível concluir a subnota.')
        console.error('[program-history] completeSubnote:', message)
        set({ error: message })
        return false
      }

      useNotesStore.getState().removeInactiveNoteLocally(noteId, note.parent_note_id)

      if (get().isHistoryOpen && get().selectedProgramId) {
        await get().loadHistory()
      }
      return true
    } finally {
      const next = new Set(get().completingNoteIds)
      next.delete(noteId)
      set({ completingNoteIds: next })
    }
  },

  reopenItem: async (historyId) => {
    if (!canManageProgramWorkflow(get().accessLevel)) {
      set({ error: 'Seu acesso ao Histórico é somente para acompanhar suas solicitações.' })
      return false
    }
    set({ error: null })
    const { error } = await supabase.rpc('notas_reopen_program_subnote', {
      p_history_id: historyId,
    })
    if (error) {
      const message = errorMessage(error, 'Não foi possível reabrir a subnota.')
      console.error('[program-history] reopenItem:', message)
      set({ error: message })
      return false
    }

    await Promise.all([
      useNotesStore.getState().loadNotes(),
      get().loadHistory(),
    ])
    return true
  },
}))
