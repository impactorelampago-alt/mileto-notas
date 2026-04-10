import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import type { NoteCollaborator, Profile } from '../lib/types'

interface CollaboratorsState {
  collaborators: NoteCollaborator[]
  isLoading: boolean
  allProfiles: Profile[]
  profilesLoaded: boolean
  loadCollaborators: (noteId: string) => Promise<void>
  loadAllProfiles: () => Promise<void>
  addCollaborator: (noteId: string, userId: string, permission: 'VIEW' | 'EDIT') => Promise<void>
  updatePermission: (collaboratorId: string, permission: 'VIEW' | 'EDIT') => Promise<void>
  removeCollaborator: (collaboratorId: string) => Promise<void>
  resetStore: () => void
}

export const useCollaboratorsStore = create<CollaboratorsState>()((set, get) => ({
  collaborators: [],
  isLoading: false,
  allProfiles: [],
  profilesLoaded: false,

  loadCollaborators: async (noteId) => {
    set({ isLoading: true })

    const { data: collabData, error: collabError } = await supabase
      .from('note_collaborators')
      .select('id, note_id, user_id, permission, added_by, created_at')
      .eq('note_id', noteId)

    console.log('[COLLAB] loadCollaborators result:', collabData, collabError)

    if (collabError) {
      console.error('[collaborators] loadCollaborators:', collabError.message)
      set({ isLoading: false })
      return
    }

    if (!collabData || collabData.length === 0) {
      set({ collaborators: [], isLoading: false })
      return
    }

    const userIds = collabData.map((c) => c.user_id)
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, email, name, avatar_url, role')
      .in('id', userIds)

    const collaborators = collabData.map((c) => ({
      ...c,
      profile: profilesData?.find((p) => p.id === c.user_id) ?? undefined,
    }))

    set({ collaborators: collaborators as NoteCollaborator[], isLoading: false })
  },

  loadAllProfiles: async () => {
    console.log('[PROFILES] profilesLoaded antes do guard:', get().profilesLoaded)
    if (get().profilesLoaded) return
    const currentUserId = useAuthStore.getState().user?.id
    console.log('[PROFILES] currentUserId:', currentUserId)

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, avatar_url, role')
      .order('name', { ascending: true })

    console.log('[COLLAB] loadAllProfiles result:', data, error)

    if (error) {
      console.error('[collaborators] loadAllProfiles:', error.message)
      return
    }

    const profiles = ((data ?? []) as Profile[]).filter((p) => p.id !== currentUserId)
    set({ allProfiles: profiles, profilesLoaded: true })
  },

  addCollaborator: async (noteId, userId, permission) => {
    const currentUserId = useAuthStore.getState().user?.id
    console.log('[ADD] currentUserId:', currentUserId)
    if (!currentUserId) {
      console.error('[ADD] currentUserId é null, abortando')
      return
    }
    console.log('[ADD] executando insert:', { noteId, userId, permission, added_by: currentUserId })
    const { data, error } = await supabase
      .from('note_collaborators')
      .insert({ note_id: noteId, user_id: userId, permission, added_by: currentUserId })
      .select()
    console.log('[ADD] resultado insert:', data, error)
    if (error) {
      console.error('[collaborators] addCollaborator:', error.message)
      return
    }
    await get().loadCollaborators(noteId)
  },

  updatePermission: async (collaboratorId, permission) => {
    set((s) => ({
      collaborators: s.collaborators.map((c) =>
        c.id === collaboratorId ? { ...c, permission } : c,
      ),
    }))
    const { error } = await supabase
      .from('note_collaborators')
      .update({ permission })
      .eq('id', collaboratorId)
    if (error) {
      console.error('[collaborators] updatePermission:', error.message)
    }
  },

  removeCollaborator: async (collaboratorId) => {
    const prev = get().collaborators
    set((s) => ({
      collaborators: s.collaborators.filter((c) => c.id !== collaboratorId),
    }))
    const { error } = await supabase
      .from('note_collaborators')
      .delete()
      .eq('id', collaboratorId)
    if (error) {
      console.error('[collaborators] removeCollaborator:', error.message)
      set({ collaborators: prev })
    }
  },

  resetStore: () => {
    set({ allProfiles: [], profilesLoaded: false, collaborators: [], isLoading: false })
  },
}))
