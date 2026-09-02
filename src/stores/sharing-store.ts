import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'

/**
 * Compartilhamento de categorias/notas.
 *
 * Fonte primária: tabelas `note_shares` / `category_shares` no Supabase (back).
 * Fallback: cache local (electron-store) — assim a feature continua funcionando
 * mesmo se o pacote SQL ainda NÃO tiver sido aplicado no banco (degrada sem erro).
 *
 * categoryShares: { [category_key COMPLETA: USR_<id>_<SUFIXO>]: userId[] }
 * noteShares:     { [noteId]: userId[] }
 */

const CATEGORY_KEY = 'category-shares'
const NOTE_KEY = 'note-shares'

function storage() {
  return window.electronAPI?.sessionStorage ?? null
}

async function loadLocal(key: string): Promise<Record<string, string[]>> {
  try {
    const raw = await storage()?.get(key)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string[]>
    }
    return {}
  } catch {
    return {}
  }
}

async function saveLocal(key: string, map: Record<string, string[]>): Promise<void> {
  try {
    await storage()?.set(key, JSON.stringify(map))
  } catch {
    // cache local nunca quebra o app
  }
}

function group(rows: { k: string; u: string }[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const r of rows) {
    if (!map[r.k]) map[r.k] = []
    map[r.k].push(r.u)
  }
  return map
}

type SharePermission = 'VIEW' | 'EDIT'

interface SharingState {
  categoryShares: Record<string, string[]>
  noteShares: Record<string, string[]>
  /** Notas que OUTROS compartilharam comigo. { [noteId]: permissão }. */
  sharedWithMeNotes: Record<string, SharePermission>
  /** Categorias (key COMPLETA) que OUTROS compartilharam comigo. */
  sharedWithMeCategories: Record<string, SharePermission>
  loadShares: () => Promise<void>
  /** Retorna { error } — se o banco recusar (RLS/sem permissão), o chamador avisa. */
  setCategoryShare: (categoryKey: string, userIds: string[]) => Promise<{ error: string | null }>
  setNoteShare: (noteId: string, userIds: string[], permission?: SharePermission) => Promise<{ error: string | null }>
}

export const useSharingStore = create<SharingState>()((set, get) => ({
  categoryShares: {},
  noteShares: {},
  sharedWithMeNotes: {},
  sharedWithMeCategories: {},

  loadShares: async () => {
    const uid = useAuthStore.getState().user?.id
    const sharedWithMeNotes: Record<string, SharePermission> = {}
    const sharedWithMeCategories: Record<string, SharePermission> = {}

    // "Compartilhado comigo" vale no contexto da conta EFETIVA: fora de impersonação
    // é o próprio usuário; impersonando, é a conta visualizada (viewingAs). Assim o
    // dono vê as categorias/notas compartilhadas COM o usuário que está visualizando.
    const effectiveUid = useAuthStore.getState().getEffectiveUserId()

    // As quatro consultas são independentes. Antes eram aguardadas em série e
    // adicionavam até quatro latências de rede antes de qualquer nota aparecer.
    // O cache local também é lido em paralelo para o fallback não alongar o boot.
    const [ownedNotes, ownedCategories, incomingNotes, incomingCategories, localNotes, localCategories] = await Promise.all([
      (async (): Promise<{ note_id: string; shared_with: string }[] | null> => {
        if (!uid) return null
        try {
          const { data, error } = await supabase
            .from('note_shares')
            .select('note_id, shared_with')
            .eq('shared_by', uid)
          return !error && data ? data as { note_id: string; shared_with: string }[] : null
        } catch {
          return null
        }
      })(),
      (async (): Promise<{ category_key: string; shared_with: string }[] | null> => {
        if (!uid) return null
        try {
          const { data, error } = await supabase
            .from('category_shares')
            .select('category_key, shared_with')
            .eq('shared_by', uid)
          return !error && data ? data as { category_key: string; shared_with: string }[] : null
        } catch {
          return null
        }
      })(),
      (async (): Promise<{ note_id: string; permission: SharePermission | null }[] | null> => {
        if (!effectiveUid) return null
        try {
          const { data, error } = await supabase
            .from('note_shares')
            .select('note_id, permission')
            .eq('shared_with', effectiveUid)
          return !error && data
            ? data as { note_id: string; permission: SharePermission | null }[]
            : null
        } catch {
          return null
        }
      })(),
      (async (): Promise<{ category_key: string }[] | null> => {
        if (!effectiveUid) return null
        try {
          const { data, error } = await supabase
            .from('category_shares')
            .select('category_key')
            .eq('shared_with', effectiveUid)
          return !error && data ? data as { category_key: string }[] : null
        } catch {
          return null
        }
      })(),
      loadLocal(NOTE_KEY),
      loadLocal(CATEGORY_KEY),
    ])

    // Se a identidade mudou enquanto as consultas estavam em voo, esta fotografia
    // não pode sobrescrever os compartilhamentos da conta nova.
    const currentAuth = useAuthStore.getState()
    if (currentAuth.user?.id !== uid || currentAuth.getEffectiveUserId() !== effectiveUid) return

    const noteShares = ownedNotes
      ? group(ownedNotes.map((row) => ({ k: row.note_id, u: row.shared_with })))
      : localNotes
    const categoryShares = ownedCategories
      ? group(ownedCategories.map((row) => ({ k: row.category_key, u: row.shared_with })))
      : localCategories
    for (const row of incomingNotes ?? []) {
      sharedWithMeNotes[row.note_id] = row.permission === 'VIEW' ? 'VIEW' : 'EDIT'
    }
    for (const row of incomingCategories ?? []) {
      sharedWithMeCategories[row.category_key] = 'EDIT'
    }

    set({
      noteShares,
      categoryShares,
      sharedWithMeNotes,
      sharedWithMeCategories,
    })
  },

  setNoteShare: async (noteId, userIds, permission = 'EDIT') => {
    const next = { ...get().noteShares }
    if (userIds.length === 0) {
      delete next[noteId]
    } else {
      next[noteId] = userIds
    }
    set({ noteShares: next })
    void saveLocal(NOTE_KEY, next)

    const uid = useAuthStore.getState().user?.id
    if (!uid) return { error: null }
    // Erros do banco NÃO são engolidos — sem isto o front fingia sucesso quando a
    // RLS recusava (compartilhar com quem não pode), deixando um "fantasma" só local.
    const del = await supabase.from('note_shares').delete().eq('note_id', noteId).eq('shared_by', uid)
    if (del.error) { console.error('[sharing] setNoteShare delete:', del.error.message); return { error: del.error.message } }
    if (userIds.length > 0) {
      const ins = await supabase.from('note_shares').insert(
        userIds.map((u) => ({ note_id: noteId, shared_with: u, shared_by: uid, permission })),
      )
      if (ins.error) { console.error('[sharing] setNoteShare insert:', ins.error.message); return { error: ins.error.message } }
    }
    return { error: null }
  },

  setCategoryShare: async (categoryKey, userIds) => {
    const next = { ...get().categoryShares }
    if (userIds.length === 0) {
      delete next[categoryKey]
    } else {
      next[categoryKey] = userIds
    }
    set({ categoryShares: next })
    void saveLocal(CATEGORY_KEY, next)

    const uid = useAuthStore.getState().user?.id
    if (!uid) return { error: null }
    const del = await supabase.from('category_shares').delete().eq('category_key', categoryKey).eq('shared_by', uid)
    if (del.error) { console.error('[sharing] setCategoryShare delete:', del.error.message); return { error: del.error.message } }
    if (userIds.length > 0) {
      const ins = await supabase.from('category_shares').insert(
        userIds.map((u) => ({ category_key: categoryKey, shared_with: u, shared_by: uid })),
      )
      if (ins.error) { console.error('[sharing] setCategoryShare insert:', ins.error.message); return { error: ins.error.message } }
    }
    return { error: null }
  },
}))
