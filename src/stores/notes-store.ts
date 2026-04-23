import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import type { Note } from '../lib/types'
import { useOpsStore } from './ops-store'
import { normalizePriority } from '../lib/note-priority'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let _notesToken: string | null = null
let _deletionInProgress = false

async function notesFetch<T>(path: string): Promise<T[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  if (!_notesToken) {
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) {
        _notesToken = data.session.access_token
      }
    } catch {
      // fallback para anon key
    }
  }

  const token = _notesToken ?? SUPABASE_KEY

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    if (response.status === 401) {
      _notesToken = null
      throw new Error('Token expired')
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as T[]
  } finally {
    clearTimeout(timeoutId)
  }
}

async function notesDelete(table: string, id: string): Promise<{ count: number; error: string | null }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  if (!_notesToken) {
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) {
        _notesToken = data.session.access_token
      }
    } catch {
      // fallback
    }
  }

  const token = _notesToken ?? SUPABASE_KEY

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Prefer': 'return=representation',
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    if (response.status === 401) {
      _notesToken = null
      return { count: 0, error: 'Token expired' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { count: 0, error: `HTTP ${response.status} ${text}`.trim() }
    }

    const rows = await response.json().catch(() => [])
    return { count: Array.isArray(rows) ? rows.length : 0, error: null }
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'Unknown error' }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function notesPatch(table: string, id: string, body: Record<string, unknown>): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  if (!_notesToken) {
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) {
        _notesToken = data.session.access_token
      }
    } catch {
      // fallback para anon key
    }
  }

  const token = _notesToken ?? SUPABASE_KEY

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })

    if (response.status === 401) {
      _notesToken = null
      throw new Error('Token expired')
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  } finally {
    clearTimeout(timeoutId)
  }
}

interface NotesState {
  notes: Note[]
  openTabs: string[]
  activeTabId: string | null
  isLoading: boolean
  hasLoadedOnce: boolean
  loadNotes: () => Promise<void>
  syncNotesFromTaskDescriptions: () => void
  ensureNotesForOrphanTasks: () => Promise<void>
  createNote: (options?: { title?: string; categoryId?: string | null; sectionSuffix?: string | null }) => Promise<Note | null>
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'priority' | 'category_id' | 'is_pinned' | 'is_archived' | 'client_id' | 'task_id'>>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  openTab: (noteId: string) => void
  closeTab: (noteId: string) => void
  closeAllTabs: () => void
  setActiveTab: (noteId: string) => void
  getNotesByCategory: (categoryId: string | null) => Note[]
  getActiveNote: () => Note | null
  fetchNoteById: (noteId: string) => Promise<Note | null>
  noteIdsWithCollaborators: Set<string>
  loadNotesWithCollaborators: () => Promise<void>
  realtimeChannel: RealtimeChannel | null
  subscribeToNote: (noteId: string) => void
  unsubscribeFromNote: () => void
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  openTabs: [],
  activeTabId: null,
  isLoading: false,
  hasLoadedOnce: false,

  loadNotes: async () => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return

    set({ isLoading: true })
    try {
      const loaded = await notesFetch<Note>(
        `notes?select=*&creator_id=eq.${userId}&is_archived=eq.false&order=is_pinned.desc,updated_at.desc`,
      )
      set({
        notes: loaded.map((note) => ({ ...note, priority: normalizePriority(note.priority) })),
        isLoading: false,
        hasLoadedOnce: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[notes] loadNotes:', message)
      set({ isLoading: false })
    }
  },

  /**
   * Sincroniza o conteúdo das notas vinculadas a tasks com a description da task.
   * A description da task é a fonte de verdade — se diferir, atualiza a nota.
   */
  syncNotesFromTaskDescriptions: () => {
    const notes = get().notes
    const tasks = useOpsStore.getState().tasks

    if (tasks.length === 0) return

    const taskMap = new Map(tasks.map((t) => [t.id, t]))
    let hasChanges = false
    const updated = notes.map((note) => {
      if (!note.task_id) return note
      const task = taskMap.get(note.task_id)
      if (!task) return note

      const taskDesc = task.description ?? ''
      const taskPriority = normalizePriority(task.priority)
      if (note.content !== taskDesc || note.priority !== taskPriority) {
        hasChanges = true
        return { ...note, content: taskDesc, priority: taskPriority }
      }
      return note
    })

    if (hasChanges) {
      set({ notes: updated })
      console.log('[notes] Synced note contents from task descriptions')
    }
  },

  /**
   * Cria nota vazia para cada task do usuário que ainda não tem nota vinculada.
   * Isso permite que tasks criadas direto no Mileto web apareçam no ops-notas.
   * Idempotente: protegido por UNIQUE constraint em notes.task_id.
   */
  ensureNotesForOrphanTasks: async () => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return

    // Espera loadNotes rodar pelo menos 1 vez — evita race em que notes local
    // está vazio e o upsert tenta criar nota pra todas as tasks (bloqueadas por UNIQUE)
    if (!get().hasLoadedOnce) {
      console.log('[notes] ensureNotesForOrphanTasks: aguardando loadNotes inicial')
      return
    }

    // Pausa durante deleção pra não recriar nota pra task que está sendo deletada
    if (_deletionInProgress) {
      console.log('[notes] ensureNotesForOrphanTasks: pausado (deleção em curso)')
      return
    }

    const notes = get().notes
    const tasks = useOpsStore.getState().tasks
    if (tasks.length === 0) return

    const notedTaskIds = new Set(
      notes.map((n) => n.task_id).filter((id): id is string => id !== null),
    )
    const orphans = tasks.filter((t) => !notedTaskIds.has(t.id))
    if (orphans.length === 0) return

    console.log(`[notes] Creating notes for ${orphans.length} orphan task(s)`, orphans.map((t) => ({ id: t.id, title: t.title })))
    const payload = orphans.map((t) => ({
      title: t.title,
      content: t.description ?? '',
      priority: normalizePriority(t.priority),
      creator_id: userId,
      task_id: t.id,
      is_pinned: false,
      is_archived: false,
    }))

    const { data, error } = await supabase
      .from('notes')
      .upsert(payload, { onConflict: 'task_id', ignoreDuplicates: true })
      .select()

    if (error) {
      console.error('[notes] ensureNotesForOrphanTasks erro:', error.message, error)
      return
    }

    console.log(`[notes] ensureNotesForOrphanTasks upsert retornou ${data?.length ?? 0} notas criadas`, data)
    if ((data?.length ?? 0) > 0) {
      await get().loadNotes()
    }
  },

  createNote: async (options = {}) => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return null

    const { title = 'Nova nota', categoryId = null, sectionSuffix } = options
    const targetSection = sectionSuffix !== undefined ? sectionSuffix : useOpsStore.getState().activeSectionId

    const prevActiveTabId = get().activeTabId
    const now = new Date().toISOString()

    // 1. Criar task no Mileto Ops (scoped ao usuário)
    const taskId = await useOpsStore.getState().createTaskInOps(title, targetSection)
    if (!taskId) {
      console.error('[notes] createNote abortado: falha ao criar task no Mileto')
      return null
    }

    const optimistic: Note = {
      id: crypto.randomUUID(),
      title,
      content: '',
      priority: 'LOW',
      category_id: categoryId ?? null,
      client_id: null,
      task_id: taskId,
      creator_id: userId,
      is_pinned: false,
      is_archived: false,
      created_at: now,
      updated_at: now,
    }

    set((s) => ({ notes: [optimistic, ...s.notes] }))
    get().openTab(optimistic.id)

    // 2. Criar nota vinculada à task
    const { data, error } = await supabase
      .from('notes')
      .insert({
        title: optimistic.title,
        content: optimistic.content,
        category_id: optimistic.category_id,
        priority: optimistic.priority,
        creator_id: userId,
        task_id: taskId,
        is_pinned: false,
        is_archived: false,
      })
      .select()
      .single()

    if (error) {
      console.error('[notes] createNote:', error.message)
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== optimistic.id),
        openTabs: s.openTabs.filter((id) => id !== optimistic.id),
        activeTabId: s.activeTabId === optimistic.id ? prevActiveTabId : s.activeTabId,
      }))
      return null
    }

    const created = data as Note
    set((s) => ({
      notes: s.notes.map((n) => (n.id === optimistic.id ? created : n)),
      openTabs: s.openTabs.map((id) => (id === optimistic.id ? created.id : id)),
      activeTabId: s.activeTabId === optimistic.id ? created.id : s.activeTabId,
    }))
    return created
  },

  updateNote: async (id, updates) => {
    const prev = get().notes
    const note = prev.find((n) => n.id === id)

    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, ...updates, updated_at: new Date().toISOString() } : n,
      ),
    }))
    try {
      await notesPatch('notes', id, updates)

      // Sync bidirecional: se a nota tem task_id, sincronizar com a task no Mileto
      const taskId = updates.task_id !== undefined ? updates.task_id : note?.task_id
      if (taskId) {
        const taskUpdates: Record<string, unknown> = {}
        if (updates.content !== undefined) taskUpdates.description = updates.content
        if (updates.title !== undefined) taskUpdates.title = updates.title
        if (updates.priority !== undefined) taskUpdates.priority = updates.priority
        if (Object.keys(taskUpdates).length > 0) {
          await notesPatch('tasks', taskId, taskUpdates)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[notes] updateNote:', message)
      set({ notes: prev })
    }
  },

  deleteNote: async (id) => {
    console.log('[notes] deleteNote: iniciado', id)
    const noteToDelete = get().notes.find((n) => n.id === id)
    if (!noteToDelete) {
      console.warn('[notes] deleteNote: nota não encontrada no state')
      return
    }
    const taskId = noteToDelete.task_id

    _deletionInProgress = true
    try {
      // 1. Deleta a task primeiro (se existir). Timeout 5s via fetch direto.
      if (taskId) {
        console.log('[notes] deleteNote: deletando task', taskId)
        const { count, error } = await notesDelete('tasks', taskId)
        if (error) {
          console.error('[notes] deleteNote: erro ao deletar task:', error)
          return
        }
        if (count === 0) {
          console.error('[notes] deleteNote: task não foi deletada (0 rows) — RLS/permissão')
          return
        }
        console.log(`[notes] deleteNote: task deletada (${count} rows)`)
      }

      // 2. Deleta a nota.
      console.log('[notes] deleteNote: deletando nota', id)
      const { count: noteCount, error: noteError } = await notesDelete('notes', id)
      if (noteError) {
        console.error('[notes] deleteNote: erro ao deletar nota:', noteError)
        return
      }
      if (noteCount === 0) {
        console.error('[notes] deleteNote: nota não foi deletada (0 rows)')
        return
      }
      console.log(`[notes] deleteNote: nota deletada (${noteCount} rows)`)

      // 3. Atualiza UI depois que o banco confirmou
      set((s) => {
        const newTabs = s.openTabs.filter((t) => t !== id)
        let newActive = s.activeTabId
        if (s.activeTabId === id) {
          const idx = s.openTabs.indexOf(id)
          newActive = newTabs[idx] ?? newTabs[idx - 1] ?? null
        }
        return {
          notes: s.notes.filter((n) => n.id !== id),
          openTabs: newTabs,
          activeTabId: newActive,
        }
      })
    } finally {
      _deletionInProgress = false
    }
  },

  openTab: (noteId) => {
    set((s) => {
      if (s.openTabs.includes(noteId)) return { activeTabId: noteId }
      return { openTabs: [...s.openTabs, noteId], activeTabId: noteId }
    })
  },

  closeTab: (noteId) => {
    set((s) => {
      const newTabs = s.openTabs.filter((id) => id !== noteId)
      let newActive = s.activeTabId
      if (s.activeTabId === noteId) {
        const idx = s.openTabs.indexOf(noteId)
        newActive = newTabs[idx] ?? newTabs[idx - 1] ?? null
      }
      return { openTabs: newTabs, activeTabId: newActive }
    })
  },

  closeAllTabs: () => set({ openTabs: [], activeTabId: null }),
  setActiveTab: (noteId) => set({ activeTabId: noteId }),

  getNotesByCategory: (categoryId) => {
    const { notes } = get()
    if (categoryId === null) return notes
    return notes.filter((n) => n.category_id === categoryId)
  },

  getActiveNote: () => {
    const { notes, activeTabId } = get()
    if (!activeTabId) return null
    return notes.find((n) => n.id === activeTabId) ?? null
  },

  fetchNoteById: async (noteId) => {
    const existing = get().notes.find((n) => n.id === noteId)
    if (existing) return existing

    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('id', noteId)
      .single()

    if (error || !data) return null

    const note = { ...(data as Note), priority: normalizePriority((data as Note).priority) }
    set((state) => ({ notes: [note, ...state.notes] }))
    return note
  },

  noteIdsWithCollaborators: new Set<string>(),

  loadNotesWithCollaborators: async () => {
    const { data } = await supabase
      .from('note_collaborators')
      .select('note_id')
    if (data) {
      const ids = new Set(data.map((c) => c.note_id as string))
      set({ noteIdsWithCollaborators: ids })
    }
  },

  realtimeChannel: null,

  subscribeToNote: (noteId) => {
    const existing = get().realtimeChannel
    if (existing) {
      void supabase.removeChannel(existing)
    }

    const channel = supabase
      .channel(`note:${noteId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notes',
          filter: `id=eq.${noteId}`,
        },
        (payload) => {
          const updated = payload.new as Note

          set((state) => {
            const localNote = state.notes.find((n) => n.id === updated.id)
            if (!localNote) return state

            // Só atualizar se o conteúdo remoto é mais recente
            if (updated.updated_at <= localNote.updated_at) return state

            return {
              notes: state.notes.map((n) =>
                n.id === updated.id
                  ? { ...n, title: updated.title, content: updated.content, updated_at: updated.updated_at }
                  : n,
              ),
            }
          })
        },
      )
      .subscribe()

    set({ realtimeChannel: channel })
  },

  unsubscribeFromNote: () => {
    const channel = get().realtimeChannel
    if (channel) {
      void supabase.removeChannel(channel)
      set({ realtimeChannel: null })
    }
  },

}))
