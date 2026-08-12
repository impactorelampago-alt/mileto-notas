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
  /**
   * Edição que encontrou um conflito sobreposto com o documento Yjs canônico.
   *
   * Enquanto este marcador existir, o flush REST comum NÃO pode consumir o
   * rascunho: gravar apenas `notes.content` sem alinhar `note_yjs` faria o CRDT
   * antigo reaparecer na abertura seguinte. `base` é necessária para reaplicar a
   * alteração local por merge de três vias mesmo depois de reiniciar o app.
   */
  crdtConflict?: { base: string }
}

export interface SessionState {
  openTabs: string[]
  activeTabId: string | null
  activeSectionId?: string | null
}

const DRAFTS_KEY = 'note-drafts'
const SESSION_KEY = 'session-tabs'
let draftOperationQueue: Promise<unknown> = Promise.resolve()

function storage() {
  return window.electronAPI?.sessionStorage ?? null
}

function enqueueDraftOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = draftOperationQueue.then(operation, operation)
  draftOperationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function readDraftsDirect(): Promise<Record<string, NoteDraft>> {
  const raw = await storage()?.get(DRAFTS_KEY)
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, NoteDraft>
  }
  return {}
}

export async function loadDrafts(): Promise<Record<string, NoteDraft>> {
  try {
    return await enqueueDraftOperation(readDraftsDirect)
  } catch {
    return {}
  }
}

export async function saveDraft(noteId: string, draft: NoteDraft): Promise<void> {
  try {
    await enqueueDraftOperation(async () => {
      const store = storage()
      if (!store) return
      const drafts = await readDraftsDirect()
      const existingConflict = drafts[noteId]?.crdtConflict
      // Um save REST comum não tem autoridade para desproteger um conflito CRDT.
      // O marcador só sai quando o collab-store confirma o estado em `note_yjs` e
      // remove explicitamente o rascunho correspondente.
      drafts[noteId] = existingConflict && !draft.crdtConflict
        ? { ...draft, crdtConflict: existingConflict }
        : draft
      await store.set(DRAFTS_KEY, JSON.stringify(drafts))
    })
  } catch {
    // O backup local nunca pode quebrar o app — falha em silêncio.
  }
}

/**
 * Protege um texto conflitante sem apagar um título local que já estivesse salvo.
 * A operação é atômica na mesma fila de read-modify-write dos demais rascunhos.
 */
export async function protectDraftAsCrdtConflict(
  noteId: string,
  content: string,
  base: string,
): Promise<boolean> {
  try {
    return await enqueueDraftOperation(async () => {
      const store = storage()
      if (!store) return false
      const drafts = await readDraftsDirect()
      const existing = drafts[noteId]
      drafts[noteId] = {
        content,
        title: existing?.title ?? '',
        savedAt: new Date().toISOString(),
        crdtConflict: { base },
      }
      await store.set(DRAFTS_KEY, JSON.stringify(drafts))
      return true
    })
  } catch {
    // O backup local nunca pode quebrar o editor.
    return false
  }
}

export async function removeDraft(noteId: string): Promise<void> {
  try {
    await enqueueDraftOperation(async () => {
      const store = storage()
      if (!store) return
      const drafts = await readDraftsDirect()
      if (noteId in drafts) {
        delete drafts[noteId]
        await store.set(DRAFTS_KEY, JSON.stringify(drafts))
      }
    })
  } catch {
    // ignore
  }
}

/**
 * Remoção usada pelo fluxo REST comum. Retorna `false` e preserva o arquivo
 * quando o texto ainda depende de alinhamento CRDT.
 */
export async function removeDraftUnlessCrdtConflict(noteId: string): Promise<boolean> {
  try {
    return await enqueueDraftOperation(async () => {
      const store = storage()
      if (!store) return false
      const drafts = await readDraftsDirect()
      const draft = drafts[noteId]
      if (!draft) return true
      if (draft.crdtConflict) return false
      delete drafts[noteId]
      await store.set(DRAFTS_KEY, JSON.stringify(drafts))
      return true
    })
  } catch {
    return false
  }
}

/**
 * O collab-store usa esta variante depois de persistir `note_yjs`. A comparação
 * evita que um flush antigo apague um rascunho mais novo criado enquanto a rede
 * estava em voo.
 */
export async function removeDraftIfContent(
  noteId: string,
  expectedContent: string,
): Promise<boolean> {
  try {
    return await enqueueDraftOperation(async () => {
      const store = storage()
      if (!store) return false
      const drafts = await readDraftsDirect()
      const draft = drafts[noteId]
      if (!draft) return true
      if (draft.content !== expectedContent) return false
      delete drafts[noteId]
      await store.set(DRAFTS_KEY, JSON.stringify(drafts))
      return true
    })
  } catch {
    return false
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
