/**
 * Persistência local invisível — rede de segurança estilo Bloco de Notas do
 * Windows 11.
 *
 * Os dados ficam em `%AppData%\ops-notas` (via electron-store, exposto pelo
 * preload como `electronAPI.sessionStorage`). O usuário nunca vê arquivos
 * soltos: ao fechar, o texto não-sincronizado fica salvo localmente e é
 * restaurado sozinho ao reabrir. A nuvem (Supabase) segue como fonte da
 * verdade; o local é apenas o espelho rápido e à prova de perda.
 *
 * Modelo de consistência (sem depender de relógio):
 * - Ao editar, grava um rascunho local.
 * - Quando a nuvem confirma o save, o rascunho é removido.
 * - Logo, um rascunho que sobrevive até o próximo boot = conteúdo que pode não
 *   ter chegado à nuvem → restaurado silenciosamente.
 */

export interface NoteDraft {
  content: string
  title: string
  savedAt: string
}

export interface SessionState {
  openTabs: string[]
  activeTabId: string | null
  activeSectionId?: string | null
}

const DRAFTS_KEY = 'note-drafts'
const SESSION_KEY = 'session-tabs'

function storage() {
  return window.electronAPI?.sessionStorage ?? null
}

export async function loadDrafts(): Promise<Record<string, NoteDraft>> {
  try {
    const raw = await storage()?.get(DRAFTS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, NoteDraft>
    }
    return {}
  } catch {
    return {}
  }
}

export async function saveDraft(noteId: string, draft: NoteDraft): Promise<void> {
  try {
    const store = storage()
    if (!store) return
    const drafts = await loadDrafts()
    drafts[noteId] = draft
    await store.set(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // O backup local nunca pode quebrar o app — falha em silêncio.
  }
}

export async function removeDraft(noteId: string): Promise<void> {
  try {
    const store = storage()
    if (!store) return
    const drafts = await loadDrafts()
    if (noteId in drafts) {
      delete drafts[noteId]
      await store.set(DRAFTS_KEY, JSON.stringify(drafts))
    }
  } catch {
    // ignore
  }
}

export async function saveSession(session: SessionState): Promise<void> {
  try {
    await storage()?.set(SESSION_KEY, JSON.stringify(session))
  } catch {
    // ignore
  }
}

export async function loadSession(): Promise<SessionState | null> {
  try {
    const raw = await storage()?.get(SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as SessionState).openTabs)
    ) {
      return parsed as SessionState
    }
    return null
  } catch {
    return null
  }
}
