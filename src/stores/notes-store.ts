import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import { useSharingStore } from './sharing-store'
import type { Note, NotePermission } from '../lib/types'
import { useOpsStore } from './ops-store'
import { normalizePriority } from '../lib/note-priority'
import { findMentions } from '../lib/mentions-core'
import { doneKeyForStatus } from '../lib/sections'
import { isDoneStatus, buildStatusKey } from '../lib/status-keys'
import { saveDraft, removeDraft, loadDrafts } from '../lib/local-drafts'
import { loadCompletedOrigins, persistCompletedOrigins } from '../lib/completed-origins'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let _notesToken: string | null = null

// Mantém o token REST em SINCRONIA com o refresh automático do JWT (o GoTrue rotaciona
// o token ~a cada hora). Sem isto, _notesToken ficava com o token VELHO até um 401 — e
// nesse meio os saves (notesPatch) tomavam 401 e viravam rascunho pendente que NÃO subia
// pro banco (o funcionário via a edição na tela, mas ela nunca chegava no servidor).
// onAuthStateChange dispara em INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT.
supabase.auth.onAuthStateChange((_event, session) => {
  _notesToken = session?.access_token ?? null
})

// No 401: limpa o cache E força um refresh (o auto-refresh pode ter falhado após sleep /
// queda de rede); o listener acima re-popula com o token novo, e o rascunho pendente sobe
// no próximo flush.
function invalidateNotesToken(): void {
  _notesToken = null
  void supabase.auth.refreshSession().catch(() => {})
}

let _deletionInProgress = false
// Menções já notificadas nesta sessão, por nota (evita re-chamar o RPC a cada save;
// o RPC também deduplica no banco). noteId -> set de userIds.
const _notifiedMentions = new Map<string, Set<string>>()

/**
 * Normalização canônica de uma nota vinda do banco/realtime: garante prioridade
 * válida e defaults de parent_note_id/position (subnotas). O spread `...note`
 * preserva flags de front (is_shared_with_me/shared_permission) quando presentes.
 */
function normalizeNote(note: Note): Note {
  return {
    ...note,
    priority: normalizePriority(note.priority),
    parent_note_id: note.parent_note_id ?? null,
    position: note.position ?? 0,
  }
}

/**
 * Expande `rootId` para o conjunto de ids da subárvore (raiz + subnotas). Usado no
 * deleteNote/deleteSection: o banco tem ON DELETE CASCADE em parent_note_id, então
 * ao apagar a raiz o Postgres já remove as subnotas — este helper só espelha isso
 * no estado local (notes/abas). Fixpoint porque a ordem do array não é garantida.
 */
function collectNoteTreeIds(notes: Note[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const note of notes) {
      if (note.parent_note_id && ids.has(note.parent_note_id) && !ids.has(note.id)) {
        ids.add(note.id)
        changed = true
      }
    }
  }
  return ids
}

/**
 * Subnota herda as flags de compartilhamento da RAIZ: a permissão de uma subnota é a
 * da nota-raiz (espelha a RLS user_can_edit_note(parent)). Sem isto,
 * is_shared_with_me/shared_permission nunca chegam à subnota (só a raiz está em
 * sharedWithMeNotes; subnota tem task_id=null), então canEditNote(subnota) daria false
 * para o colaborador EDIT e o editor travaria em só-leitura embora o back-end permita
 * o UPDATE. Muta as notas em lugar.
 */
function inheritSubnoteSharedFlags(notes: Note[]): void {
  const byId = new Map(notes.map((n) => [n.id, n]))
  for (const n of notes) {
    if (!n.parent_note_id) continue
    const root = byId.get(n.parent_note_id)
    if (root?.is_shared_with_me) {
      n.is_shared_with_me = true
      n.shared_permission = root.shared_permission
    }
  }
}

/**
 * Geração de visão: incrementada a cada troca de conta/impersonação/logout
 * (setViewingAs/setViewAll/signOut chamam bumpViewGeneration). Cada loader captura
 * a geração no início e descarta o resultado se ela mudou antes do set — evita
 * gravar notas da conta ANTIGA por cima da nova quando a troca ocorre durante os
 * awaits (race do polling de 10s / realtime).
 */
let _viewGeneration = 0
export function bumpViewGeneration(): number {
  _viewGeneration += 1
  return _viewGeneration
}

/**
 * Compara dois timestamps com segurança. Os dois lados geram formatos ISO
 * DIFERENTES: o local é `new Date().toISOString()` (3 casas de fração, sufixo `Z`)
 * e o do PostgREST é timestamptz (6 casas, offset `+00:00`). Comparar como STRING
 * (lexicográfico) erra quando os instantes estão próximos — e disso dependia toda a
 * proteção "não sobrescrever o que o usuário digitou". Date.parse normaliza ambos
 * para epoch numérico. `null`/`undefined` viram -Infinity (mais antigo possível).
 */
function tsMs(v: string | null | undefined): number {
  if (!v) return -Infinity
  const n = Date.parse(v)
  return Number.isNaN(n) ? -Infinity : n
}
function tsNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  return tsMs(a) > tsMs(b)
}
/** Tolerância de clock-skew (ms): a task só "vence" a nota se for mais nova por esta margem. */
const SKEW_TOLERANCE_MS = 5000

/**
 * Ids de notas com rascunho local NÃO confirmado (edição que pode ainda não ter
 * subido). Enquanto o id está aqui, o sync da description da task NUNCA sobrescreve
 * a nota — há edição local a proteger. Mantido em memória (síncrono) para o
 * syncNotesFromTaskDescriptions consultar sem I/O. Reidratado por refreshPendingSync.
 */
const _pendingDraftIds = new Set<string>()

/** Zera o token de acesso em cache. Chamado no logout para forçar re-autenticação. */
export function clearNotesAuthCache(): void {
  _notesToken = null
}

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
      invalidateNotesToken()
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
      invalidateNotesToken()
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
      invalidateNotesToken()
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
  /**
   * Carrega a nota de TODA task visível (ops-store.tasks) que ainda não está na
   * tela — independente de quem CRIOU a nota. loadNotes busca por `creator_id`
   * (+ compartilhado), então não pega nota de terceiro numa task que está na MINHA
   * coluna nem nota de categoria compartilhada antes do snapshot popular as tasks.
   * A RLS de `notes` (notes_select_linked_task) só devolve o que o usuário pode ler.
   * No-op quando não há nota faltando (custo zero no polling).
   */
  loadNotesForVisibleTasks: () => Promise<void>
  /**
   * Carrega as SUBNOTAS de notas-raiz ALHEIAS já na tela (categoria compartilhada,
   * delegação, nota de terceiro). Subnota tem task_id=null e creator alheio, então
   * escapa de loadNotes (por creator) e de loadNotesForVisibleTasks (por task_id) —
   * este é o único fetch que as traz pro destinatário. A RLS já autoriza a leitura.
   */
  loadSubnotesForLoadedRoots: () => Promise<void>
  /**
   * Detecta @menções de membros do time no conteúdo da nota e notifica (RPC
   * `notas_notify_mention`) as menções NOVAS. Se o mencionado não tem acesso à
   * nota, dispara `mileto:mention-no-access` (o Editor avisa + oferece compartilhar).
   */
  notifyMentions: (noteId: string) => Promise<void>
  /** Sobe pra nuvem os rascunhos locais pendentes (edições offline) — no `online`/foco. */
  flushPendingDrafts: () => Promise<void>
  /** Nº de rascunhos locais pendentes de subir pra nuvem (indicador de sincronização). */
  pendingSync: number
  refreshPendingSync: () => Promise<void>
  syncNotesFromTaskDescriptions: () => void
  ensureNotesForOrphanTasks: () => Promise<void>
  createNote: (options?: { title?: string; categoryId?: string | null; sectionSuffix?: string | null }) => Promise<Note | null>
  createSubnote: (parentNoteId: string, options?: { title?: string }) => Promise<Note | null>
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'priority' | 'category_id' | 'is_pinned' | 'is_archived' | 'client_id' | 'task_id' | 'due_date'>>) => Promise<void>
  completeNote: (noteId: string) => Promise<void>
  /** Alterna concluída/pendente: conclui (status→DONE) ou desfaz (volta à origem). */
  toggleComplete: (noteId: string) => Promise<void>
  /** Origem (status anterior) de tarefas concluídas, p/ manter a nota na categoria. */
  completedOrigins: Record<string, string>
  deleteNote: (id: string) => Promise<void>
  openTab: (noteId: string) => void
  closeTab: (noteId: string) => void
  closeAllTabs: () => void
  setActiveTab: (noteId: string) => void
  getNotesByCategory: (categoryId: string | null) => Note[]
  getRootNotes: () => Note[]
  getSubnotes: (parentNoteId: string) => Note[]
  getRootNoteFor: (noteId: string) => Note | null
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
  completedOrigins: loadCompletedOrigins(),
  pendingSync: 0,

  loadNotes: async () => {
    const authState = useAuthStore.getState()
    const viewAll = authState.viewAll
    const userId = authState.getEffectiveUserId()
    if (!userId) return

    // Captura a geração de visão: se mudar (troca de conta) durante os awaits,
    // descartamos o resultado antes de escrever no store.
    const gen = _viewGeneration

    set({ isLoading: true })
    try {
      // Modo "Todos": carrega TODAS as notas da equipe (a RLS libera dono/gestão a
      // ler tudo). Visão geral de leitura — agrupadas por categoria via task_id.
      if (viewAll) {
        const all = await notesFetch<Note>(
          `notes?select=*&is_archived=eq.false&order=is_pinned.desc,position.asc,updated_at.desc`,
        )
        const localAll = new Map(get().notes.map((n) => [n.id, n]))
        const mergedAll = all.map((note) => {
          const base: Note = normalizeNote(note)
          const local = localAll.get(note.id)
          if (local && tsNewer(local.updated_at, note.updated_at)) {
            base.content = local.content
            base.title = local.title
            base.updated_at = local.updated_at
          }
          return base
        })
        // Identidade ainda é a mesma? (a troca de conta durante os awaits acima
        // invalida este resultado — não grava notas da conta antiga.)
        if (_viewGeneration !== gen) { set({ isLoading: false }); return }
        set({ notes: mergedAll, isLoading: false, hasLoadedOnce: true })
        return
      }

      // (1) Minhas notas (ou as da conta visualizada em impersonação)
      const own = await notesFetch<Note>(
        `notes?select=*&creator_id=eq.${userId}&is_archived=eq.false&order=is_pinned.desc,position.asc,updated_at.desc`,
      )

      // (2)/(3) Notas compartilhadas comigo — só fora de impersonação (RLS autoriza)
      const notImpersonating = useAuthStore.getState().viewingAs == null
      const shareState = useSharingStore.getState()
      const extra: Note[] = []

      if (notImpersonating) {
        // (2) notas compartilhadas comigo diretamente
        const sharedNoteIds = Object.keys(shareState.sharedWithMeNotes)
        if (sharedNoteIds.length > 0) {
          const idList = sharedNoteIds.map((id) => `"${id}"`).join(',')
          try {
            const rows = await notesFetch<Note>(`notes?select=*&id=in.(${idList})`)
            extra.push(...rows)
          } catch (e) {
            console.warn('[notes] loadNotes notas compartilhadas:', e)
          }
        }

        // (3) notas das categorias compartilhadas comigo (via task_id das tasks dessas categorias)
        const sharedCatKeys = Object.keys(shareState.sharedWithMeCategories)
        if (sharedCatKeys.length > 0) {
          const sharedTaskIds = useOpsStore
            .getState()
            .tasks.filter((t) => sharedCatKeys.includes(t.status))
            .map((t) => t.id)
          if (sharedTaskIds.length > 0) {
            const taskIdList = sharedTaskIds.map((id) => `"${id}"`).join(',')
            try {
              const rows = await notesFetch<Note>(`notes?select=*&task_id=in.(${taskIdList})`)
              extra.push(...rows)
            } catch (e) {
              console.warn('[notes] loadNotes notas de categorias compartilhadas:', e)
            }
          }
        }
      }

      // Merge dedup por id
      const byId = new Map<string, Note>()
      for (const n of own) byId.set(n.id, n)
      for (const n of extra) if (!byId.has(n.id)) byId.set(n.id, n)

      // Preserva notas JÁ carregadas de tasks visíveis que NÃO vêm por creator nem
      // por compartilhamento (ex.: task na MINHA coluna com nota criada por OUTRA
      // pessoa, trazida pelo loadNotesForVisibleTasks). Sem isto, este reload as
      // derruba e elas "somem do nada" e voltam a cada loadNotes (foco/realtime/
      // shares) — piscando contra o loadNotesForVisibleTasks.
      const visibleTaskIds = new Set(useOpsStore.getState().tasks.map((t) => t.id))
      for (const n of get().notes) {
        if (n.task_id && visibleTaskIds.has(n.task_id) && !byId.has(n.id)) {
          byId.set(n.id, n)
        }
      }

      // Preserva SUBNOTAS já carregadas sob demanda (fetchNoteById) que estas queries
      // não trazem: uma subnota estrangeira (de nota-raiz compartilhada comigo, criada
      // por outra pessoa) tem task_id=null e creator_id de outro, escapando do
      // preservador de tasks visíveis acima. Sem isto, abrir uma subnota compartilhada
      // e depois qualquer loadNotes (foco/realtime/shares) faria a subnota "sumir".
      for (const n of get().notes) {
        if (
          n.parent_note_id &&
          !byId.has(n.id) &&
          (byId.has(n.parent_note_id) || n.creator_id !== userId)
        ) {
          byId.set(n.id, n)
        }
      }

      const sharedNotePerm = shareState.sharedWithMeNotes
      const sharedCatKeys = Object.keys(shareState.sharedWithMeCategories)
      const sharedCatPerm = shareState.sharedWithMeCategories
      const tasks = useOpsStore.getState().tasks
      const taskStatusById = new Map(tasks.map((t) => [t.id, t.status]))
      // Prefixo das MINHAS categorias (sou o dono): USR_<meuId32>_. Notas alheias numa
      // categoria minha são editáveis (espaço colaborativo) — o destinatário já era.
      const myPrefix = 'USR_' + userId.replace(/-/g, '') + '_'

      const localById = new Map(get().notes.map((n) => [n.id, n]))
      const merged = Array.from(byId.values()).map((note) => {
        const base: Note = normalizeNote(note)
        // Preserva edição LOCAL ainda não sincronizada (updated_at local mais
        // novo) — senão um reload (foco/realtime/polling) sobrescreveria o que o
        // usuário acabou de digitar e que ainda está no debounce de save.
        const local = localById.get(note.id)
        if (local && tsNewer(local.updated_at, note.updated_at)) {
          base.content = local.content
          base.title = local.title
          base.updated_at = local.updated_at
        }
        if (notImpersonating && note.creator_id !== userId) {
          // Sou destinatário desta nota — anexa flags de compartilhamento.
          let perm: NotePermission | undefined = sharedNotePerm[note.id]
          if (!perm && note.task_id) {
            // Veio via categoria compartilhada
            const status = taskStatusById.get(note.task_id)
            if (status && sharedCatKeys.includes(status)) perm = sharedCatPerm[status]
            // Ou EU sou o dono da categoria → edito as notas que outros criaram nela.
            if (!perm && status && status.startsWith(myPrefix)) perm = 'EDIT'
          }
          if (perm) {
            base.is_shared_with_me = true
            base.shared_permission = perm
          }
        }
        return base
      })

      // Subnotas herdam as flags de compartilhamento da raiz (permissão = da raiz).
      inheritSubnoteSharedFlags(merged)

      // Identidade ainda é a mesma? (troca de conta durante os awaits acima)
      if (_viewGeneration !== gen) { set({ isLoading: false }); return }

      set({
        notes: merged,
        isLoading: false,
        hasLoadedOnce: true,
      })

      // Completa com as subnotas de raízes ALHEIAS (categoria compartilhada/delegação):
      // elas têm task_id=null e não vêm pelas queries por creator/task acima.
      void get().loadSubnotesForLoadedRoots()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[notes] loadNotes:', message)
      set({ isLoading: false })
    }
  },

  loadNotesForVisibleTasks: async () => {
    const authState = useAuthStore.getState()
    const userId = authState.getEffectiveUserId()
    if (!userId) return
    // No modo "Todos", loadNotes já traz TODAS as notas da equipe — nada a completar.
    if (authState.viewAll) return

    const gen = _viewGeneration
    const tasks = useOpsStore.getState().tasks
    if (tasks.length === 0) return

    // Tasks visíveis cuja nota ainda NÃO está carregada (qualquer que seja o criador).
    const loadedTaskIds = new Set(
      get().notes.map((n) => n.task_id).filter((id): id is string => id !== null),
    )
    const missing = tasks.map((t) => t.id).filter((id) => !loadedTaskIds.has(id))
    if (missing.length === 0) return

    // Busca em lotes para não estourar o tamanho da URL.
    const fetched: Note[] = []
    for (let i = 0; i < missing.length; i += 100) {
      const idList = missing
        .slice(i, i + 100)
        .map((id) => `"${id}"`)
        .join(',')
      try {
        const rows = await notesFetch<Note>(
          `notes?select=*&task_id=in.(${idList})&is_archived=eq.false`,
        )
        fetched.push(...rows)
      } catch (e) {
        console.warn('[notes] loadNotesForVisibleTasks:', e)
      }
    }
    if (fetched.length === 0) return

    // Flags de compartilhamento (categoria compartilhada → EDIT) p/ notas de terceiros.
    const notImpersonating = authState.viewingAs == null
    const shareState = useSharingStore.getState()
    const sharedCatKeys = Object.keys(shareState.sharedWithMeCategories)
    const sharedCatPerm = shareState.sharedWithMeCategories
    const sharedNotePerm = shareState.sharedWithMeNotes
    const taskStatusById = new Map(tasks.map((t) => [t.id, t.status]))
    const myPrefix = 'USR_' + userId.replace(/-/g, '') + '_' // minhas categorias (sou dono)

    // Troca de conta durante os fetches acima invalida este resultado.
    if (_viewGeneration !== gen) return

    set((s) => {
      const byId = new Map(s.notes.map((n) => [n.id, n]))
      let added = 0
      for (const note of fetched) {
        if (byId.has(note.id)) continue
        const base: Note = normalizeNote(note)
        if (notImpersonating && note.creator_id !== userId) {
          let perm: NotePermission | undefined = sharedNotePerm[note.id]
          if (!perm && note.task_id) {
            const status = taskStatusById.get(note.task_id)
            if (status && sharedCatKeys.includes(status)) perm = sharedCatPerm[status]
            if (!perm && status && status.startsWith(myPrefix)) perm = 'EDIT' // sou dono da categoria
          }
          if (perm) {
            base.is_shared_with_me = true
            base.shared_permission = perm
          }
        }
        byId.set(note.id, base)
        added++
      }
      if (added === 0) return s
      const arr = Array.from(byId.values())
      arr.sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
        return a.updated_at < b.updated_at ? 1 : -1
      })
      return { notes: arr }
    })

    // Preenche o conteúdo das notas recém-carregadas a partir da description da
    // task (essas notas de terceiro costumam vir com content vazio; a verdade está
    // na task) — sem esperar o próximo snapshot.
    get().syncNotesFromTaskDescriptions()
  },

  loadSubnotesForLoadedRoots: async () => {
    const authState = useAuthStore.getState()
    const userId = authState.getEffectiveUserId()
    if (!userId) return
    // Modo "Todos": loadNotes já traz TODAS as notas da equipe (subnotas inclusas).
    if (authState.viewAll) return

    const gen = _viewGeneration
    // Raízes ALHEIAS na tela — as MINHAS subnotas já vêm por creator_id no loadNotes.
    const foreignRootIds = get().notes
      .filter((n) => n.parent_note_id === null && n.creator_id !== userId)
      .map((n) => n.id)
    if (foreignRootIds.length === 0) return

    // Busca em lotes para não estourar o tamanho da URL. A RLS ("Users can view
    // subnotes from accessible parent notes") só retorna as subnotas cuja raiz o
    // usuário pode ver — nada de terceiro sem acesso vaza. `okRoots` = raízes cujo
    // lote respondeu OK; só reconcilio deleção nelas (erro de rede não apaga nada).
    const fetched: Note[] = []
    const okRoots = new Set<string>()
    for (let i = 0; i < foreignRootIds.length; i += 100) {
      const batch = foreignRootIds.slice(i, i + 100)
      const idList = batch.map((id) => `"${id}"`).join(',')
      try {
        const rows = await notesFetch<Note>(
          `notes?select=*&parent_note_id=in.(${idList})&is_archived=eq.false`,
        )
        fetched.push(...rows)
        for (const id of batch) okRoots.add(id)
      } catch (e) {
        console.warn('[notes] loadSubnotesForLoadedRoots:', e)
      }
    }
    if (okRoots.size === 0) return // todos os lotes falharam — não mexe em nada
    // Troca de conta durante os fetches acima invalida este resultado.
    if (_viewGeneration !== gen) return

    set((s) => {
      const fetchedIds = new Set(fetched.map((n) => n.id))
      const byId = new Map(s.notes.map((n) => [n.id, n]))
      let changed = false
      // (1) Reconcilia DELEÇÃO: subnota de uma raiz consultada (lote OK) que NÃO voltou
      // foi apagada por quem tem acesso — remove o fantasma (senão o bloco de preservação
      // do loadNotes a re-injetaria). Não remove aba aberta (evita aba órfã) nem rascunho
      // pendente (edição local ainda não sincronizada).
      for (const n of s.notes) {
        if (
          n.parent_note_id &&
          okRoots.has(n.parent_note_id) &&
          !fetchedIds.has(n.id) &&
          !s.openTabs.includes(n.id) &&
          !_pendingDraftIds.has(n.id)
        ) {
          byId.delete(n.id)
          changed = true
        }
      }
      // (2) Adiciona as subnotas alheias novas.
      for (const note of fetched) {
        if (byId.has(note.id)) continue // já carregada (própria ou via fetchNoteById)
        byId.set(note.id, normalizeNote(note))
        changed = true
      }
      if (!changed) return s
      const arr = Array.from(byId.values())
      // Subnotas herdam as flags de compartilhamento da raiz (permissão = da raiz).
      inheritSubnoteSharedFlags(arr)
      return { notes: arr }
    })
  },

  notifyMentions: async (noteId) => {
    const authState = useAuthStore.getState()
    const me = authState.user?.id
    if (!me) return
    // Só notifica na edição da PRÓPRIA conta (não em "Todos"/impersonação).
    if (authState.viewAll || authState.viewingAs) return
    const note = get().notes.find((n) => n.id === noteId)
    if (!note) return

    const team = authState.teamProfiles
      .filter((p) => p.name && p.name.trim())
      .map((p) => ({ id: p.id, name: (p.name as string).trim() }))
    if (team.length === 0) return

    const mentionedIds = Array.from(
      new Set(findMentions(note.content, team).map((h) => h.userId)),
    ).filter((id) => id !== me)
    if (mentionedIds.length === 0) return

    // Só as menções AINDA NÃO notificadas nesta sessão (o RPC também deduplica).
    const already = _notifiedMentions.get(noteId) ?? new Set<string>()
    const fresh = mentionedIds.filter((id) => !already.has(id))
    if (fresh.length === 0) return

    const noAccess: string[] = []
    for (const uid of fresh) {
      already.add(uid) // marca antes (não re-tenta em loop se falhar)
      try {
        const { data, error } = await supabase.rpc('notas_notify_mention', {
          p_note_id: noteId, p_recipient: uid, p_title: note.title ?? '',
        })
        if (error) { console.warn('[notes] notifyMentions rpc:', error.message); continue }
        if (data === 'no_access') {
          const name = team.find((t) => t.id === uid)?.name
          if (name) noAccess.push(name)
        }
      } catch (e) {
        console.warn('[notes] notifyMentions:', e)
      }
    }
    _notifiedMentions.set(noteId, already)

    // Decisão (a)+(c): quem foi mencionado mas não tem acesso NÃO é notificado —
    // avisa quem mencionou (o Editor mostra + oferece compartilhar a nota).
    if (noAccess.length > 0) {
      document.dispatchEvent(
        new CustomEvent('mileto:mention-no-access', { detail: { noteId, names: noAccess } }),
      )
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

      // GATE DE RASCUNHO PENDENTE: se há edição local não confirmada desta nota,
      // NUNCA puxa da task (vazia ou não). Inclui ESVAZIAR a nota (apagar tudo) —
      // edição local pendente — senão o sync ressuscitaria a description antiga e
      // (com o persist abaixo) gravaria de volta no banco compartilhado. O
      // preenchimento legítimo de nota recém-carregada não tem rascunho pendente.
      const noteEmpty = !note.content || note.content.trim() === ''
      if (_pendingDraftIds.has(note.id)) return note

      // Puxa description/priority DA task quando: (1) ela foi editada DEPOIS da nota
      // por uma margem real (clock-skew + formatos ISO diferentes — comparação por
      // epoch, não string), OU (2) a nota está VAZIA. Nota vazia não tem edição local
      // a proteger — é o caso da nota de terceiro recém-carregada com content vazio
      // enquanto a task (Ops) tem a descrição. Se a nota tem texto e a task não é
      // claramente mais nova, NÃO sobrescreve — senão apaga o que o usuário digitou.
      const taskNewer = tsMs(task.updated_at) - tsMs(note.updated_at) > SKEW_TOLERANCE_MS
      if (!taskNewer && !noteEmpty) return note

      const taskDesc = task.description ?? ''
      const taskPriority = normalizePriority(task.priority)
      // PROTEÇÃO ANTI-APAGAMENTO: uma description VAZIA da task NUNCA apaga o
      // conteúdo da nota. A task pode estar só atrasada na sincronização (ou sem
      // permissão de sync na categoria compartilhada).
      const nextContent = (taskDesc === '' && !noteEmpty) ? (note.content ?? '') : taskDesc
      if (note.content !== nextContent || note.priority !== taskPriority) {
        hasChanges = true
        // Preencheu uma nota VAZIA com a descrição da task → PERSISTE no banco.
        // Sem isto, o sync fica só na tela e o loadNotes recarrega o vazio por
        // cima (o texto "some mesmo sincronizando" — caso da categoria "Salvos").
        // Só quando posso editar a nota (evita 403 em compartilhada-VIEW).
        if (noteEmpty && nextContent !== '' && useAuthStore.getState().canEditNote(note)) {
          void notesPatch('notes', note.id, { content: nextContent }).catch(() => {})
        }
        return { ...note, content: nextContent, priority: taskPriority, updated_at: (task.updated_at ?? note.updated_at) }
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
    const authState = useAuthStore.getState()
    // Modo "Todos": não cria nada (criaria nota pra CADA task da equipe inteira).
    if (authState.viewAll) return

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

    // Impersonação: o insert direto não cria nota com creator = usuário VISUALIZADO
    // (a RLS amarra creator ao usuário logado). Então cria as notas que faltam DELE
    // via RPC SECURITY DEFINER (valida que você pode VER ele). Assim a conta que
    // você está vendo mostra até as tarefas órfãs (criadas direto no Ops).
    const viewing = authState.viewingAs
    if (viewing) {
      try {
        const { data, error } = await supabase.rpc('notas_create_missing_notes_for', { p_owner: viewing.id })
        if (error) { console.error('[notes] ensureNotes (impersonação):', error.message); return }
        if ((typeof data === 'number' ? data : 0) > 0) await get().loadNotes()
      } catch (e) {
        console.warn('[notes] ensureNotes (impersonação):', e)
      }
      return
    }

    const userId = authState.user?.id
    if (!userId) return

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

    // Impersonação: cria a nota COMO a pessoa visualizada (RPC valida no banco que
    // você pode EDITÁ-la — DONO/cargo_edit). Sem isso a nota seria criada na SUA
    // conta (some na dela) e o título/texto se perderiam na troca entre as visões.
    const viewing = useAuthStore.getState().viewingAs
    if (viewing) {
      const section = useOpsStore.getState().sections.find((s) => s.key_suffix === targetSection)
      const status = section?.key ?? buildStatusKey(viewing.id, targetSection ?? 'TODO')
      const { data, error } = await supabase.rpc('notas_create_note_for', {
        p_owner: viewing.id, p_status: status, p_title: title, p_content: '',
      })
      if (error || !data) {
        console.error('[notes] createNote (impersonação):', error?.message)
        return null
      }
      await get().loadNotes()
      const created = get().notes.find((n) => n.id === data) ?? null
      if (created) get().openTab(created.id)
      return created
    }

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
      parent_note_id: null,
      position: 0,
      category_id: categoryId ?? null,
      client_id: null,
      task_id: taskId,
      creator_id: userId,
      is_pinned: false,
      is_archived: false,
      created_at: now,
      updated_at: now,
      due_date: null,
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
        parent_note_id: optimistic.parent_note_id,
        position: optimistic.position,
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

    const created = normalizeNote(data as Note)
    set((s) => ({
      notes: s.notes.map((n) => (n.id === optimistic.id ? created : n)),
      openTabs: s.openTabs.map((id) => (id === optimistic.id ? created.id : id)),
      activeTabId: s.activeTabId === optimistic.id ? created.id : s.activeTabId,
    }))
    return created
  },

  createSubnote: async (parentNoteId, options = {}) => {
    const authState = useAuthStore.getState()
    // "Todos" é somente-leitura por design, exceto DONO (rede de segurança no store).
    if (authState.viewAll && !authState.isDono()) return null
    // Impersonação (v1): a RLS de INSERT de subnota exige creator_id = auth.uid()
    // (policy base) E user_can_edit_note(parent) (policy RESTRICTIVE). Com viewingAs,
    // creator_id seria viewingAs.id != auth.uid() → 403, e não há RPC
    // notas_create_subnote_for. Bloqueia criar subnota em conta impersonada.
    if (authState.viewingAs) return null

    const userId = authState.getEffectiveUserId()
    if (!userId) return null

    const notes = get().notes
    const parentNote = notes.find((n) => n.id === parentNoteId)
    if (!parentNote) return null

    // Nesting de 1 nível: o pai de uma subnota é sempre a nota-raiz.
    const rootNote = parentNote.parent_note_id
      ? notes.find((n) => n.id === parentNote.parent_note_id)
      : parentNote
    if (!rootNote) return null

    // Herda o contexto de permissão da raiz: só cria subnota quem pode EDITAR a raiz.
    // Espelha o WITH CHECK user_can_edit_note(parent_note_id) da RLS RESTRICTIVE.
    if (!authState.canEditNote(rootNote)) {
      console.warn('[notes] createSubnote: sem permissão de edição na raiz', rootNote.id)
      return null
    }

    const gen = _viewGeneration
    const { title = 'Nova subnota' } = options
    const prevActiveTabId = get().activeTabId
    const siblings = notes.filter((n) => n.parent_note_id === rootNote.id)
    const position = siblings.length > 0
      ? Math.max(...siblings.map((n) => n.position)) + 1
      : 0
    const now = new Date().toISOString()

    const optimistic: Note = {
      id: crypto.randomUUID(),
      title,
      content: '',
      priority: 'LOW',
      parent_note_id: rootNote.id,
      position,
      category_id: rootNote.category_id,
      client_id: rootNote.client_id,
      task_id: null,
      creator_id: userId,
      is_pinned: false,
      is_archived: false,
      created_at: now,
      updated_at: now,
      due_date: null,
    }

    set((s) => ({ notes: [...s.notes, optimistic] }))
    get().openTab(optimistic.id)

    const { data, error } = await supabase
      .from('notes')
      .insert({
        title: optimistic.title,
        content: optimistic.content,
        priority: optimistic.priority,
        parent_note_id: optimistic.parent_note_id,
        position: optimistic.position,
        category_id: optimistic.category_id,
        client_id: optimistic.client_id,
        creator_id: userId,
        is_pinned: false,
        is_archived: false,
      })
      .select()
      .single()

    const rollback = () => set((s) => ({
      notes: s.notes.filter((n) => n.id !== optimistic.id),
      openTabs: s.openTabs.filter((id) => id !== optimistic.id),
      activeTabId: s.activeTabId === optimistic.id ? prevActiveTabId : s.activeTabId,
    }))

    if (error) {
      console.error('[notes] createSubnote:', error.message)
      rollback()
      return null
    }

    // Troca de conta durante o insert invalida o resultado: descarta a subnota
    // otimista para não deixar dado da conta antiga na tela da nova.
    if (_viewGeneration !== gen) {
      rollback()
      return null
    }

    const created = normalizeNote(data as Note)
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

    // DONO tem controle total — edita tarefa de qualquer um (a RLS permite). Os
    // gates abaixo (Todos só-leitura / compartilhada sem EDIT) NÃO se aplicam a ele.
    const isDono = useAuthStore.getState().isDono()

    // Modo "Todos" é somente-leitura por design (visão geral da equipe), EXCETO pro
    // DONO. Rede de segurança no store, independente da UI.
    if (!isDono && useAuthStore.getState().viewAll) return

    // Nota compartilhada comigo sem permissão de EDIÇÃO: não persistir (evita 403).
    // O DONO não passa por aqui (edita tudo).
    if (!isDono && note?.is_shared_with_me && note.shared_permission !== 'EDIT') {
      return
    }

    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, ...updates, updated_at: new Date().toISOString() } : n,
      ),
    }))

    // Havia edição NÃO sincronizada (rascunho pendente) ANTES desta chamada? Usado
    // na limpeza abaixo: um update SÓ de título (renome) não pode descartar o
    // rascunho se já havia conteúdo pendente de sync — senão perderia o texto que
    // ainda não subiu (o patch de título não reenvia o conteúdo).
    const wasPendingBefore = _pendingDraftIds.has(id)

    // Rede de segurança local imediata: ao mudar conteúdo/título, grava um
    // rascunho local (invisível, em %AppData%). Se a nuvem falhar/estiver
    // offline, nada é perdido — restaurado silenciosamente ao reabrir.
    if (updates.content !== undefined || updates.title !== undefined) {
      const merged = get().notes.find((n) => n.id === id)
      if (merged) {
        _pendingDraftIds.add(id) // protege contra o sync da task sobrescrever
        void saveDraft(id, { content: merged.content, title: merged.title, savedAt: merged.updated_at })
      }
      void get().refreshPendingSync()
    }

    // Salva na nuvem. Se FALHAR (offline/rede), NÃO reverte a edição na tela — ela
    // continua visível e o rascunho local fica pendente, subindo sozinho quando a
    // conexão voltar (flushPendingDrafts no evento `online`/foco). A nuvem continua
    // sendo a verdade: assim que o save passa, o rascunho é descartado.
    let cloudOk = true
    try {
      await notesPatch('notes', id, updates)
    } catch (err) {
      cloudOk = false
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[notes] updateNote (notes) — mantido local, pendente de sync:', message)
    }

    if (!cloudOk) { void get().refreshPendingSync(); return } // rascunho pendente; sobe depois.

    // Save na nuvem da NOTA confirmado: descartamos o rascunho/pending SÓ quando
    // NADA ficou por sincronizar. O patch é PARCIAL e o rascunho guarda os dois
    // campos (content+title), então:
    //  - o campo PRESENTE neste patch acabou de subir e ainda casa com o atual;
    //  - o campo AUSENTE só está garantidamente sincronizado se NÃO havia pendência
    //    ANTES desta chamada (wasPendingBefore=false). Senão ele pode ter uma
    //    edição que nunca subiu (ex.: renome offline que falhou) — mantemos o
    //    rascunho e o flushPendingDrafts (que reenvia content+title juntos) sobe e
    //    limpa depois. Sem isso, ou se perdia o campo ausente, ou o id ficava preso
    //    em _pendingDraftIds matando o sync/realtime externo da nota.
    const saved = get().notes.find((n) => n.id === id)
    const contentOk = updates.content !== undefined ? saved?.content === updates.content : !wasPendingBefore
    const titleOk = updates.title !== undefined ? saved?.title === updates.title : !wasPendingBefore
    if (saved && (updates.content !== undefined || updates.title !== undefined) && contentOk && titleOk) {
      _pendingDraftIds.delete(id) // save confirmado: já não há edição local a proteger
      // Aguarda o removeDraft GRAVAR antes de o refreshPendingSync RELER o disco —
      // senão a releitura (que faz clear()+rehidrata) re-injetaria o id recém
      // removido (race de read-modify-write não atômico), deixando o id preso e o
      // realtime de entrada da nota suprimido. refreshPendingSync fica best-effort
      // (void) pra uma eventual falha dele não interromper o sync da task abaixo.
      await removeDraft(id)
      void get().refreshPendingSync()
    }

    // Sync bidirecional: se a nota tem task_id, sincronizar com a task no Mileto.
    // O sync da TASK é independente — se falhar (ex: RLS), NÃO reverte a nota,
    // que já foi salva com sucesso acima.
    const taskId = updates.task_id !== undefined ? updates.task_id : note?.task_id
    if (taskId) {
      const taskUpdates: Record<string, unknown> = {}
      if (updates.content !== undefined) taskUpdates.description = updates.content
      if (updates.title !== undefined) taskUpdates.title = updates.title
      if (updates.priority !== undefined) taskUpdates.priority = updates.priority
      if (Object.keys(taskUpdates).length > 0) {
        try {
          await notesPatch('tasks', taskId, taskUpdates)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          console.error('[notes] updateNote (task sync, nota mantida salva):', message)
        }
      }
    }
  },

  /**
   * Sobe pra nuvem os rascunhos locais pendentes (edições feitas offline). Chamado
   * quando a conexão volta (evento `online`) e no foco da janela — sem precisar
   * reabrir o app. Idempotente: sem pendências é no-op; ao salvar com sucesso, o
   * rascunho é descartado. A nuvem permanece como fonte de verdade.
   */
  flushPendingDrafts: async () => {
    let drafts: Awaited<ReturnType<typeof loadDrafts>>
    try {
      drafts = await loadDrafts()
    } catch {
      return
    }
    const ids = Object.keys(drafts)
    if (ids.length === 0) return

    const isDono = useAuthStore.getState().isDono() // DONO sobe rascunho de qualquer nota
    for (const id of ids) {
      const note = get().notes.find((n) => n.id === id)
      if (!note) continue // nota não carregada nesta sessão — pula
      if (!isDono && note.is_shared_with_me && note.shared_permission !== 'EDIT') continue
      const draft = drafts[id]
      try {
        await notesPatch('notes', id, { content: draft.content, title: draft.title })
        if (note.task_id) {
          try {
            await notesPatch('tasks', note.task_id, { description: draft.content, title: draft.title })
          } catch {
            // sync da task é best-effort
          }
        }
        // Subiu: se ainda é o conteúdo atual, descarta o rascunho.
        const cur = get().notes.find((n) => n.id === id)
        if (cur && cur.content === draft.content && cur.title === draft.title) {
          _pendingDraftIds.delete(id)
          void removeDraft(id)
        }
      } catch {
        // Ainda offline/falhou — mantém o rascunho, tenta no próximo gatilho.
      }
    }
    void get().refreshPendingSync()
  },

  /** Recalcula quantos rascunhos locais estão pendentes (pro indicador de nuvem). */
  refreshPendingSync: async () => {
    try {
      const d = await loadDrafts()
      const ids = Object.keys(d)
      // Reidrata o Set de proteção a partir da verdade local (cobre reinício do app
      // e rascunhos restaurados): garante que o sync da task respeite edições offline.
      _pendingDraftIds.clear()
      for (const id of ids) _pendingDraftIds.add(id)
      set({ pendingSync: ids.length })
    } catch {
      // silencioso — o backup local nunca pode quebrar o app
    }
  },

  /**
   * Conclui a nota: move a task vinculada para o status DONE do dono via RPC
   * `notas_complete_task` (SECURITY DEFINER, valida acesso no banco). Liberado a
   * qualquer um com acesso (dono ou destinatário). Em erro, loga sem quebrar a UI.
   */
  completeNote: async (noteId) => {
    if (useAuthStore.getState().viewAll) return // "Todos" é somente-leitura
    const note = get().notes.find((n) => n.id === noteId)
    // Subnota não tem task no Ops (task_id sempre null) — não pode ser concluída.
    if (note?.parent_note_id) return
    const taskId = note?.task_id
    if (!taskId) {
      console.warn('[notes] completeNote: nota sem task_id', noteId)
      return
    }

    const { error } = await supabase.rpc('notas_complete_task', { p_task_id: taskId })
    if (error) {
      console.error('[notes] completeNote:', error.message)
      return
    }

    // Atualização otimista local: move a task para o DONE do dono.
    const task = useOpsStore.getState().tasks.find((t) => t.id === taskId)
    const doneKey = task ? doneKeyForStatus(task.status) : null
    if (doneKey) {
      useOpsStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: doneKey } : t)),
      }))
    }
    useOpsStore.getState().scheduleOpsRefresh('task-completed')
  },

  /**
   * Alterna o estado concluída/pendente da nota (o ✓ da aba).
   * - Concluir: guarda a origem (status atual) e move a task pro DONE via RPC
   *   `completeNote` (reflete no Ops + dispara o sino). A nota passa a aparecer na
   *   categoria "Concluído"; a origem guardada serve só pro reabrir voltar pra lá.
   * - Reabrir: volta a task pro status de origem via RPC `notas_reopen_task` (valida
   *   acesso no banco). Otimista; reverte se a RPC falhar.
   */
  toggleComplete: async (noteId) => {
    if (useAuthStore.getState().viewAll) return // "Todos" é somente-leitura
    const note = get().notes.find((n) => n.id === noteId)
    if (note?.parent_note_id) return // subnota não conclui (sem task)
    const taskId = note?.task_id
    if (!taskId) return
    const task = useOpsStore.getState().tasks.find((t) => t.id === taskId)
    if (!task) return

    if (!isDoneStatus(task.status)) {
      // CONCLUIR — guarda origem e delega pro completeNote (RPC → DONE).
      const origins = { ...get().completedOrigins, [taskId]: task.status }
      persistCompletedOrigins(origins)
      set({ completedOrigins: origins })
      await get().completeNote(noteId)
      return
    }

    // DESFAZER — reabre via RPC `notas_reopen_task` (espelha o concluir; valida
    // acesso no banco e move o status de volta). Otimista; reverte se a RPC falhar.
    // O PATCH direto antigo afetava 0 linhas pro colaborador (RLS) e "mentia" sucesso.
    const cur = task.status
    const savedOrigin = get().completedOrigins[taskId] ?? null
    const optimisticTarget = savedOrigin ?? cur.slice(0, 37) + 'TODO'
    useOpsStore.setState((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: optimisticTarget } : t)),
    }))
    const origins = { ...get().completedOrigins }
    delete origins[taskId]
    persistCompletedOrigins(origins)
    set({ completedOrigins: origins })

    const { error } = await supabase.rpc('notas_reopen_task', {
      p_task_id: taskId,
      p_target_status: savedOrigin,
    })
    if (error) {
      console.error('[notes] toggleComplete (reabrir):', error.message)
      // Reverte: status volta pro DONE e a origem é restaurada (se havia).
      useOpsStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: cur } : t)),
      }))
      if (savedOrigin) {
        const restored = { ...get().completedOrigins, [taskId]: savedOrigin }
        persistCompletedOrigins(restored)
        set({ completedOrigins: restored })
      }
      return
    }
    useOpsStore.getState().scheduleOpsRefresh('task-uncompleted')
  },

  deleteNote: async (id) => {
    console.log('[notes] deleteNote: iniciado', id)
    const noteToDelete = get().notes.find((n) => n.id === id)
    if (!noteToDelete) {
      console.warn('[notes] deleteNote: nota não encontrada no state')
      return
    }
    const taskId = noteToDelete.task_id

    // Nota de OUTRA pessoa (impersonação / núcleo): apaga via RPC, que valida no
    // banco que você pode editá-la (DONO ou cargo com EDITAR). O delete direto
    // (REST com seu JWT) seria bloqueado pela RLS — só o criador apaga.
    const realUserId = useAuthStore.getState().user?.id
    if (realUserId && noteToDelete.creator_id !== realUserId) {
      _deletionInProgress = true
      try {
        const { data, error } = await supabase.rpc('notas_delete_note_for', { p_note_id: id })
        if (error || data !== true) {
          console.error('[notes] deleteNote (RPC outra pessoa):', error?.message ?? 'sem permissão')
          return
        }
        set((s) => {
          const deletedIds = collectNoteTreeIds(s.notes, id)
          const firstDeletedTabIndex = s.openTabs.findIndex((tabId) => deletedIds.has(tabId))
          const newTabs = s.openTabs.filter((tabId) => !deletedIds.has(tabId))
          let newActive = s.activeTabId
          if (s.activeTabId && deletedIds.has(s.activeTabId)) {
            newActive = newTabs[firstDeletedTabIndex] ?? newTabs[firstDeletedTabIndex - 1] ?? null
          }
          return { notes: s.notes.filter((n) => !deletedIds.has(n.id)), openTabs: newTabs, activeTabId: newActive }
        })
        console.log('[notes] deleteNote: nota de outra pessoa apagada via RPC')
      } finally {
        _deletionInProgress = false
      }
      return
    }

    _deletionInProgress = true
    try {
      // 1. Deleta a NOTA primeiro. Ordem importa: se algo falhar entre as duas,
      // sobra uma TASK órfã (ensureNotesForOrphanTasks recria a nota — estado
      // recuperável) em vez de uma NOTA órfã apontando pra task inexistente (estado
      // não recuperável que diverge do Ops). Timeout 5s via fetch direto.
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

      // 2. Deleta a task vinculada (se existir).
      if (taskId) {
        console.log('[notes] deleteNote: deletando task', taskId)
        const { count, error } = await notesDelete('tasks', taskId)
        if (error) {
          console.error('[notes] deleteNote: erro ao deletar task (nota já removida):', error)
        } else if (count === 0) {
          console.error('[notes] deleteNote: task não deletada (0 rows) — RLS/permissão (nota já removida)')
        } else {
          console.log(`[notes] deleteNote: task deletada (${count} rows)`)
        }
      }

      // 3. Atualiza UI depois que o banco confirmou
      set((s) => {
        const deletedIds = collectNoteTreeIds(s.notes, id)
        const firstDeletedTabIndex = s.openTabs.findIndex((tabId) => deletedIds.has(tabId))
        const newTabs = s.openTabs.filter((tabId) => !deletedIds.has(tabId))
        let newActive = s.activeTabId
        if (s.activeTabId && deletedIds.has(s.activeTabId)) {
          newActive = newTabs[firstDeletedTabIndex] ?? newTabs[firstDeletedTabIndex - 1] ?? null
        }
        return {
          notes: s.notes.filter((n) => !deletedIds.has(n.id)),
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
    const rootNotes = notes.filter((n) => n.parent_note_id === null)
    if (categoryId === null) return rootNotes
    return rootNotes.filter((n) => n.category_id === categoryId)
  },

  getRootNotes: () => {
    return get().notes.filter((n) => n.parent_note_id === null)
  },

  getSubnotes: (parentNoteId) => {
    return get().notes
      .filter((n) => n.parent_note_id === parentNoteId)
      .sort((a, b) => a.position - b.position || b.updated_at.localeCompare(a.updated_at))
  },

  getRootNoteFor: (noteId) => {
    const note = get().notes.find((n) => n.id === noteId)
    if (!note) return null
    if (!note.parent_note_id) return note
    return get().notes.find((n) => n.id === note.parent_note_id) ?? null
  },

  getActiveNote: () => {
    const { notes, activeTabId } = get()
    if (!activeTabId) return null
    return notes.find((n) => n.id === activeTabId) ?? null
  },

  fetchNoteById: async (noteId) => {
    // Captura a geração de visão: se a conta/visão trocar durante os awaits abaixo,
    // descartamos o resultado antes do set (não injeta dados da visão antiga na nova).
    const gen = _viewGeneration
    const existing = get().notes.find((n) => n.id === noteId)
    if (existing) {
      // Já em memória: só retorna cedo se a ÁRVORE (subnotas) também já estiver
      // carregada. Uma raiz compartilhada entra via loadNotes (shares por id) SEM as
      // subnotas — sem esta checagem, fetchNoteById(raiz) retornaria cedo e o painel
      // de subnotas ficaria vazio (contador 0) mesmo com subnotas no banco.
      const rootId = existing.parent_note_id ?? existing.id
      const hasTree = get().notes.some((n) => n.parent_note_id === rootId)
      if (hasTree) return existing
    }

    let note: Note
    if (existing) {
      note = existing
    } else {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('id', noteId)
        .single()
      if (error || !data) return null
      note = normalizeNote(data as Note)
    }
    const rootNoteId = note.parent_note_id ?? note.id

    // Carrega a árvore inteira (raiz + subnotas) de uma vez.
    const { data: relatedData } = await supabase
      .from('notes')
      .select('*')
      .or(`id.eq.${rootNoteId},parent_note_id.eq.${rootNoteId}`)
      .eq('is_archived', false)
      .order('position', { ascending: true })

    const relatedNotes = (relatedData ?? [note]).map((item) => normalizeNote(item as Note))

    // Troca de conta/visão durante os awaits acima invalida este resultado.
    if (_viewGeneration !== gen) return null

    set((state) => {
      const merged = new Map<string, Note>()
      for (const existingNote of state.notes) merged.set(existingNote.id, existingNote)
      for (const relatedNote of relatedNotes) {
        const local = merged.get(relatedNote.id)
        if (
          local &&
          (_pendingDraftIds.has(relatedNote.id) || tsNewer(local.updated_at, relatedNote.updated_at))
        ) {
          // Preserva a edição local ainda não sincronizada; aceita os metadados de
          // árvore (parent_note_id/position) e conserva as flags de compartilhamento.
          merged.set(relatedNote.id, {
            ...relatedNote,
            content: local.content,
            title: local.title,
            updated_at: local.updated_at,
            is_shared_with_me: local.is_shared_with_me,
            shared_permission: local.shared_permission,
          })
        } else {
          merged.set(
            relatedNote.id,
            local
              ? { ...relatedNote, is_shared_with_me: local.is_shared_with_me, shared_permission: local.shared_permission }
              : relatedNote,
          )
        }
      }
      const arr = Array.from(merged.values())
      // Subnotas herdam as flags de compartilhamento da raiz (permissão = da raiz).
      inheritSubnoteSharedFlags(arr)
      return { notes: arr }
    })

    return get().notes.find((n) => n.id === note.id) ?? note
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

    // Raiz da nota ativa (subnota → sua raiz; raiz → ela mesma). As SUBNOTAS a
    // observar ao vivo são as com parent_note_id = rootId.
    const activeNote = get().notes.find((n) => n.id === noteId)
    const rootId = activeNote?.parent_note_id ?? noteId

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

            // Só atualizar se o conteúdo remoto é mais recente (epoch, não string —
            // os formatos ISO das duas pontas diferem) e não há edição local pendente.
            if (_pendingDraftIds.has(updated.id)) return state
            if (!tsNewer(updated.updated_at, localNote.updated_at)) return state

            return {
              notes: state.notes.map((n) =>
                n.id === updated.id
                  ? {
                      ...n,
                      title: updated.title,
                      content: updated.content,
                      priority: normalizePriority(updated.priority),
                      parent_note_id: updated.parent_note_id ?? null,
                      position: updated.position ?? 0,
                      updated_at: updated.updated_at,
                    }
                  : n,
              ),
            }
          })
        },
      )
      // (2) Árvore de SUBNOTAS da raiz — INSERT/UPDATE/DELETE ao vivo. `notes` está na
      // publication e tem REPLICA IDENTITY FULL, então o DELETE traz a linha antiga
      // inteira (dá pra filtrar por parent_note_id). A RLS do realtime só entrega as
      // subnotas que o usuário pode ver — nada de terceiro sem acesso vaza.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `parent_note_id=eq.${rootId}` },
        (payload) => {
          const rowId = (payload.new as Note)?.id ?? (payload.old as { id?: string })?.id
          if (!rowId || rowId === noteId) return // a nota ativa é tratada pelo handler (1)

          if (payload.eventType === 'DELETE') {
            set((state) => {
              // Não remove aba aberta nem rascunho pendente (evita aba órfã/perda local).
              if (state.openTabs.includes(rowId) || _pendingDraftIds.has(rowId)) return state
              if (!state.notes.some((n) => n.id === rowId)) return state
              return { notes: state.notes.filter((n) => n.id !== rowId) }
            })
            return
          }

          const row = payload.new as Note
          set((state) => {
            const local = state.notes.find((n) => n.id === row.id)
            if (local) {
              // UPDATE de subnota: respeita edição local pendente / mais nova.
              if (_pendingDraftIds.has(row.id)) return state
              if (!tsNewer(row.updated_at, local.updated_at)) return state
              const merged = normalizeNote(row)
              merged.is_shared_with_me = local.is_shared_with_me
              merged.shared_permission = local.shared_permission
              return { notes: state.notes.map((n) => (n.id === row.id ? merged : n)) }
            }
            // INSERT de subnota nova → adiciona e herda as flags de compartilhamento da raiz.
            const arr = [...state.notes, normalizeNote(row)]
            inheritSubnoteSharedFlags(arr)
            return { notes: arr }
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
