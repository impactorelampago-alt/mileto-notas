import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import type { NoteCategory } from '../lib/types'

interface CategoriesState {
  categories: NoteCategory[]
  isLoading: boolean
  loadCategories: () => Promise<void>
  createCategory: (name: string, color: string) => Promise<NoteCategory | null>
  updateCategory: (id: string, updates: Partial<Pick<NoteCategory, 'name' | 'color' | 'icon' | 'position'>>) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
  getCategoryById: (id: string) => NoteCategory | undefined
}

export const useCategoriesStore = create<CategoriesState>()((set, get) => ({
  categories: [],
  isLoading: false,

  loadCategories: async () => {
    set({ isLoading: true })
    const { data, error } = await supabase
      .from('note_categories')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[categories] loadCategories:', error.message)
      set({ isLoading: false })
      return
    }
    set({ categories: (data ?? []) as NoteCategory[], isLoading: false })
  },

  createCategory: async (name, color) => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return null

    const position = get().categories.length
    const optimistic: NoteCategory = {
      id: crypto.randomUUID(),
      name,
      color,
      icon: null,
      user_id: userId,
      position,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    set((s) => ({ categories: [...s.categories, optimistic] }))

    const { data, error } = await supabase
      .from('note_categories')
      .insert({ name, color, user_id: userId, position, icon: null })
      .select()
      .single()

    if (error) {
      console.error('[categories] createCategory:', error.message)
      set((s) => ({ categories: s.categories.filter((c) => c.id !== optimistic.id) }))
      return null
    }

    const created = data as NoteCategory
    set((s) => ({
      categories: s.categories.map((c) => (c.id === optimistic.id ? created : c)),
    }))
    return created
  },

  updateCategory: async (id, updates) => {
    const prev = get().categories
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
    const { error } = await supabase
      .from('note_categories')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      console.error('[categories] updateCategory:', error.message)
      set({ categories: prev })
    }
  },

  deleteCategory: async (id) => {
    const prev = get().categories
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }))
    const { error } = await supabase.from('note_categories').delete().eq('id', id)
    if (error) {
      console.error('[categories] deleteCategory:', error.message)
      set({ categories: prev })
    }
  },

  getCategoryById: (id) => get().categories.find((c) => c.id === id),
}))
