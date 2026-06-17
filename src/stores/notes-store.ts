import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import { useSharingStore } from './sharing-store'
import type { Note, NotePermission } from '../lib/types'
import { useOpsStore } from './ops-store'
import { normalizePriority } from '../lib/note-priority'
import { doneKeyForStatus } from '../lib/sections'
import { isDoneStatus, buildStatusKey } from '../lib/status-keys'
import { saveDraft, removeDraft, loadDrafts } from '../lib/local-drafts'
import { loadCompletedOrigins, persistCompletedOrigins } from '../lib/completed-origins'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let _notesToken: string | null = null
let _deletionInProgress = false

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
  /**
   * Carrega a nota de TODA task visível (ops-store.tasks) que ainda não está na
   * tela — independente de quem CRIOU a nota. loadNotes busca por `creator_id`
   * (+ compartilhado), então não pega nota de terceiro numa task que está na MINHA
   * coluna nem nota de categoria compartilhada antes do snapshot popular as tasks.
   * A RLS de `notes` (notes_select_linked_task) só devolve o que o usuário pode ler.
   * No-op quando não há nota faltando (custo zero no polling).
   */
  loadNotesForVisibleTasks: () => Promise<void>
  /** Sobe pra nuvem os rascunhos locais pendentes (edições offline) — no `online`/foco. */
  flushPendingDrafts: () => Promise<void>
  /** Nº de rascunhos locais pendentes de subir pra nuvem (indicador de sincronização). */
  pendingSync: number
  refreshPendingSync: () => Promise<void>
  syncNotesFromTaskDescriptions: () => void
  ensureNotesForOrphanTasks: () => Promise<void>
  createNote: (options?: { title?: string; categoryId?: string | null; sectionSuffix?: string | null }) => Promise<Note | null>
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'priority' | 'category_id' | 'is_pinned' | 'is_archived' | 'client_id' | 'task_id'>>) => Promise<void>
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
          `notes?select=*&is_archived=eq.false&order=is_pinned.desc,updated_at.desc`,
        )
        const localAll = new Map(get().notes.map((n) => [n.id, n]))
        const mergedAll = all.map((note) => {
          const base: Note = { ...note, priority: normalizePriority(note.priority) }
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
        `notes?select=*&creator_id=eq.${userId}&is_archived=eq.false&order=is_pinned.desc,updated_at.desc`,
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

      const sharedNotePerm = shareState.sharedWithMeNotes
      const sharedCatKeys = Object.keys(shareState.sharedWithMeCategories)
      const sharedCatPerm = shareState.sharedWithMeCategories
      const tasks = useOpsStore.getState().tasks
      const taskStatusById = new Map(tasks.map((t) => [t.id, t.status]))

      const localById = new Map(get().notes.map((n) => [n.id, n]))
      const merged = Array.from(byId.values()).map((note) => {
        const base: Note = { ...note, priority: normalizePriority(note.priority) }
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
          }
          if (perm) {
            base.is_shared_with_me = true
            base.shared_permission = perm
          }
        }
        return base
      })

      // Identidade ainda é a mesma? (troca de conta durante os awaits acima)
      if (_viewGeneration !== gen) { set({ isLoading: false }); return }

      set({
        notes: merged,
        isLoading: false,
        hasLoadedOnce: true,
      })
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

    // Troca de conta durante os fetches acima invalida este resultado.
    if (_viewGeneration !== gen) return

    set((s) => {
      const byId = new Map(s.notes.map((n) => [n.id, n]))
      let added = 0
      for (const note of fetched) {
        if (byId.has(note.id)) continue
        const base: Note = { ...note, priority: normalizePriority(note.priority) }
        if (notImpersonating && note.creator_id !== userId) {
          let perm: NotePermission | undefined = sharedNotePerm[note.id]
          if (!perm && note.task_id) {
            const status = taskStatusById.get(note.task_id)
            if (status && sharedCatKeys.includes(status)) perm = sharedCatPerm[status]
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
      // NUNCA puxa da task — o usuário acabou de digitar e o save pode não ter subido.
      const noteEmpty = !note.content || note.content.trim() === ''
      if (_pendingDraftIds.has(note.id) && !noteEmpty) return note

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

    // Modo "Todos" é somente-leitura por design (visão geral da equipe). Rede de
    // segurança no store, independente da UI — nenhum caminho (dot de prioridade,
    // force-save, unmount) escreve em task de terceiro nesse modo.
    if (useAuthStore.getState().viewAll) return

    // Nota compartilhada comigo sem permissão de EDIÇÃO: não persistir (evita 403).
    if (note?.is_shared_with_me && note.shared_permission !== 'EDIT') {
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

    for (const id of ids) {
      const note = get().notes.find((n) => n.id === id)
      if (!note) continue // nota não carregada nesta sessão — pula
      if (note.is_shared_with_me && note.shared_permission !== 'EDIT') continue
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
   *   `completeNote` (reflete no Ops + dispara o sino). A nota CONTINUA visível
   *   na categoria de origem (o TabBar reagrupa pela origem guardada).
   * - Desfazer: volta a task pro status de origem. Patch direto na task — funciona
   *   pro dono; colaborador depende de RLS (v1: sem RPC de "desfazer").
   */
  toggleComplete: async (noteId) => {
    if (useAuthStore.getState().viewAll) return // "Todos" é somente-leitura
    const note = get().notes.find((n) => n.id === noteId)
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
          const newTabs = s.openTabs.filter((t) => t !== id)
          let newActive = s.activeTabId
          if (s.activeTabId === id) {
            const idx = s.openTabs.indexOf(id)
            newActive = newTabs[idx] ?? newTabs[idx - 1] ?? null
          }
          return { notes: s.notes.filter((n) => n.id !== id), openTabs: newTabs, activeTabId: newActive }
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

            // Só atualizar se o conteúdo remoto é mais recente (epoch, não string —
            // os formatos ISO das duas pontas diferem) e não há edição local pendente.
            if (_pendingDraftIds.has(updated.id)) return state
            if (!tsNewer(updated.updated_at, localNote.updated_at)) return state

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
