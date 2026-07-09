import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'

// Histórico "quem editou, quando" por nota (tabela note_edits). Grava só edições
// feitas NO NOTAS (o sync task->nota do Ops não passa por aqui). Coalescido por
// 10 min (igual ao RPC): edições rápidas do mesmo autor viram uma linha.
export interface NoteEditRow {
  editor_id: string | null
  edited_at: string
}

const COALESCE_MS = 10 * 60 * 1000

interface EditsState {
  editsByNote: Record<string, NoteEditRow[]> // ordenado por edited_at desc
  loadNoteEdits: (noteId: string) => Promise<void>
  recordNoteEdit: (noteId: string) => Promise<void>
}

export const useEditsStore = create<EditsState>()((set) => ({
  editsByNote: {},

  loadNoteEdits: async (noteId) => {
    const { data, error } = await supabase
      .from('note_edits')
      .select('editor_id,edited_at')
      .eq('note_id', noteId)
      .order('edited_at', { ascending: false })
      .limit(40)
    if (error) {
      console.warn('[edits] loadNoteEdits:', error.message)
      return
    }
    set((s) => ({ editsByNote: { ...s.editsByNote, [noteId]: (data ?? []) as NoteEditRow[] } }))
  },

  recordNoteEdit: async (noteId) => {
    const auth = useAuthStore.getState()
    const me = auth.user?.id
    if (!me) return
    // Só registra edição REAL do usuário (não em "Todos"/impersonação).
    if (auth.viewAll || auth.viewingAs) return

    // Otimista: reflete localmente o mesmo coalesce do servidor (atualiza a minha
    // linha recente ou cria uma nova no topo) — pra "última edição" já aparecer.
    const now = new Date().toISOString()
    set((s) => {
      const list = [...(s.editsByNote[noteId] ?? [])]
      const cutoff = Date.now() - COALESCE_MS
      const idx = list.findIndex((e) => e.editor_id === me && new Date(e.edited_at).getTime() > cutoff)
      if (idx >= 0) list[idx] = { ...list[idx], edited_at: now }
      else list.unshift({ editor_id: me, edited_at: now })
      list.sort((a, b) => (a.edited_at < b.edited_at ? 1 : -1))
      return { editsByNote: { ...s.editsByNote, [noteId]: list } }
    })

    try {
      await supabase.rpc('notas_record_note_edit', { p_note_id: noteId })
    } catch (e) {
      console.warn('[edits] recordNoteEdit:', e)
    }
  },
}))
