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
    let noteShares: Record<string, string[]> | null = null
    let categoryShares: Record<string, string[]> | null = null
    const sharedWithMeNotes: Record<string, SharePermission> = {}
    const sharedWithMeCategories: Record<string, SharePermission> = {}

    // Compartilhado-comigo só vale no contexto da própria conta. Em impersonação
    // (viewingAs), o contexto é da conta visualizada — não mesclar meus shares.
    const isImpersonating = useAuthStore.getState().viewingAs != null

    if (uid) {
      // note_shares (best-effort: se a tabela não existir, error vem preenchido → fallback)
      try {
        const { data, error } = await supabase
          .from('note_shares')
          .select('note_id, shared_with')
          .eq('shared_by', uid)
        if (!error && data) {
          const rows = data as { note_id: string; shared_with: string }[]
          noteShares = group(rows.map((r) => ({ k: r.note_id, u: r.shared_with })))
        }
      } catch {
        // back ainda não aplicado → fallback local
      }
      // category_shares
      try {
        const { data, error } = await supabase
          .from('category_shares')
          .select('category_key, shared_with')
          .eq('shared_by', uid)
        if (!error && data) {
          const rows = data as { category_key: string; shared_with: string }[]
          categoryShares = group(rows.map((r) => ({ k: r.category_key, u: r.shared_with })))
        }
      } catch {
        // fallback local
      }

      // ── Compartilhado COMIGO ────────────────────────────────────────────
      if (!isImpersonating) {
        // notas que outros compartilharam comigo
        try {
          const { data, error } = await supabase
            .from('note_shares')
            .select('note_id, permission')
            .eq('shared_with', uid)
          if (!error && data) {
            const rows = data as { note_id: string; permission: SharePermission | null }[]
            for (const r of rows) {
              sharedWithMeNotes[r.note_id] = r.permission === 'VIEW' ? 'VIEW' : 'EDIT'
            }
          }
        } catch {
          // back ainda não aplicado
        }
        // categorias que outros compartilharam comigo (sem coluna permission ainda → EDIT)
        try {
          const { data, error } = await supabase
            .from('category_shares')
            .select('category_key')
            .eq('shared_with', uid)
          if (!error && data) {
            const rows = data as { category_key: string }[]
            for (const r of rows) {
              sharedWithMeCategories[r.category_key] = 'EDIT'
            }
          }
        } catch {
          // back ainda não aplicado
        }
      }
    }

    const nShares = noteShares ?? (await loadLocal(NOTE_KEY))
    const cShares = categoryShares ?? (await loadLocal(CATEGORY_KEY))
    set({
      noteShares: nShares,
      categoryShares: cShares,
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
