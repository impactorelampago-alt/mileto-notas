import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import type { Note } from '../lib/types'

interface NotesState {
  notes: Note[]
  openTabs: string[]
  activeTabId: string | null
  isLoading: boolean
  loadNotes: () => Promise<void>
  createNote: (categoryId?: string | null) => Promise<Note | null>
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'category_id' | 'is_pinned' | 'is_archived'>>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  openTab: (noteId: string) => void
  closeTab: (noteId: string) => void
  closeAllTabs: () => void
  setActiveTab: (noteId: string) => void
  getNotesByCategory: (categoryId: string | null) => Note[]
  getActiveNote: () => Note | null
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  openTabs: [],
  activeTabId: null,
  isLoading: false,

  loadNotes: async () => {
    set({ isLoading: true })
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('is_archived', false)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[notes] loadNotes:', error.message)
      set({ isLoading: false })
      return
    }
    set({ notes: (data ?? []) as Note[], isLoading: false })
  },

  createNote: async (categoryId = null) => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return null

    const prevActiveTabId = get().activeTabId
    const now = new Date().toISOString()
    const optimistic: Note = {
      id: crypto.randomUUID(),
      title: 'Nova nota',
      content: '',
      category_id: categoryId ?? null,
      client_id: null,
      task_id: null,
      creator_id: userId,
      is_pinned: false,
      is_archived: false,
      created_at: now,
      updated_at: now,
    }

    set((s) => ({ notes: [optimistic, ...s.notes] }))
    get().openTab(optimistic.id)

    const { data, error } = await supabase
      .from('notes')
      .insert({
        title: optimistic.title,
        content: optimistic.content,
        category_id: optimistic.category_id,
        creator_id: userId,
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
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, ...updates, updated_at: new Date().toISOString() } : n,
      ),
    }))
    const { error } = await supabase.from('notes').update(updates).eq('id', id)
    if (error) {
      console.error('[notes] updateNote:', error.message)
      set({ notes: prev })
    }
  },

  deleteNote: async (id) => {
    const prev = get().notes
    const prevTabs = get().openTabs
    const prevActive = get().activeTabId

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

    const { error } = await supabase.from('notes').delete().eq('id', id)
    if (error) {
      console.error('[notes] deleteNote:', error.message)
      set({ notes: prev, openTabs: prevTabs, activeTabId: prevActive })
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
}))
